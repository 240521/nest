"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerTCP = void 0;
const shared_utils_1 = require("@nestjs/common/utils/shared.utils");
const net = require("net");
const tls_1 = require("tls");
const constants_1 = require("../constants");
const tcp_context_1 = require("../ctx-host/tcp.context");
const enums_1 = require("../enums");
const helpers_1 = require("../helpers");
const server_1 = require("./server");
/**
 * @publicApi
 */
class ServerTCP extends server_1.Server {
    constructor(options) {
        super();
        this.options = options;
        this.transportId = enums_1.Transport.TCP;
        this.isManuallyTerminated = false;
        this.retryAttemptsCount = 0;
        this.pendingEventListeners = [];
        this.port = this.getOptionsProp(options, 'port', constants_1.TCP_DEFAULT_PORT);
        this.host = this.getOptionsProp(options, 'host', constants_1.TCP_DEFAULT_HOST);
        this.socketClass = this.getOptionsProp(options, 'socketClass', helpers_1.JsonSocket);
        this.tlsOptions = this.getOptionsProp(options, 'tlsOptions');
        this.init();
        this.initializeSerializer(options);
        this.initializeDeserializer(options);
    }
    listen(callback) {
        this.server.once("error" /* TcpEventsMap.ERROR */, (err) => {
            if (err?.code === constants_1.EADDRINUSE || err?.code === constants_1.ECONNREFUSED) {
                this._status$.next("disconnected" /* TcpStatus.DISCONNECTED */);
                return callback(err);
            }
        });
        this.server.listen(this.port, this.host, callback);
    }
    close() {
        this.isManuallyTerminated = true;
        this.server.close();
        this.pendingEventListeners = [];
    }
    bindHandler(socket) {
        const readSocket = this.getSocketInstance(socket);
        readSocket.on('message', async (msg) => this.handleMessage(readSocket, msg));
        readSocket.on("error" /* TcpEventsMap.ERROR */, this.handleError.bind(this));
    }
    async handleMessage(socket, rawMessage) {
        const packet = await this.deserializer.deserialize(rawMessage);
        const pattern = !(0, shared_utils_1.isString)(packet.pattern)
            ? JSON.stringify(packet.pattern)
            : packet.pattern;
        const tcpContext = new tcp_context_1.TcpContext([socket, pattern]);
        if ((0, shared_utils_1.isUndefined)(packet.id)) {
            return this.handleEvent(pattern, packet, tcpContext);
        }
        const handler = this.getHandlerByPattern(pattern);
        if (!handler) {
            const status = 'error';
            const noHandlerPacket = this.serializer.serialize({
                id: packet.id,
                status,
                err: constants_1.NO_MESSAGE_HANDLER,
            });
            return socket.sendMessage(noHandlerPacket);
        }
        const response$ = this.transformToObservable(await handler(packet.data, tcpContext));
        response$ &&
            this.send(response$, data => {
                Object.assign(data, { id: packet.id });
                const outgoingResponse = this.serializer.serialize(data);
                socket.sendMessage(outgoingResponse);
            });
    }
    handleClose() {
        if (this.isManuallyTerminated ||
            !this.getOptionsProp(this.options, 'retryAttempts') ||
            this.retryAttemptsCount >=
                this.getOptionsProp(this.options, 'retryAttempts', 0)) {
            return undefined;
        }
        ++this.retryAttemptsCount;
        return setTimeout(() => this.server.listen(this.port, this.host), this.getOptionsProp(this.options, 'retryDelay', 0));
    }
    unwrap() {
        if (!this.server) {
            throw new Error('Not initialized. Please call the "listen"/"startAllMicroservices" method before accessing the server.');
        }
        return this.server;
    }
    on(event, callback) {
        if (this.server) {
            this.server.on(event, callback);
        }
        else {
            this.pendingEventListeners.push({ event, callback });
        }
    }
    init() {
        if (this.tlsOptions) {
            // TLS enabled, use tls server
            this.server = (0, tls_1.createServer)(this.tlsOptions, this.bindHandler.bind(this));
        }
        else {
            // TLS disabled, use net server
            this.server = net.createServer(this.bindHandler.bind(this));
        }
        this.registerListeningListener(this.server);
        this.registerErrorListener(this.server);
        this.registerCloseListener(this.server);
        this.pendingEventListeners.forEach(({ event, callback }) => this.server.on(event, callback));
        this.pendingEventListeners = [];
    }
    registerListeningListener(socket) {
        socket.on("listening" /* TcpEventsMap.LISTENING */, () => {
            this._status$.next("connected" /* TcpStatus.CONNECTED */);
        });
    }
    registerErrorListener(socket) {
        socket.on("error" /* TcpEventsMap.ERROR */, err => {
            if ('code' in err && err.code === constants_1.ECONNREFUSED) {
                this._status$.next("disconnected" /* TcpStatus.DISCONNECTED */);
            }
            this.handleError(err);
        });
    }
    registerCloseListener(socket) {
        socket.on("close" /* TcpEventsMap.CLOSE */, () => {
            this._status$.next("disconnected" /* TcpStatus.DISCONNECTED */);
            this.handleClose();
        });
    }
    getSocketInstance(socket) {
        return new this.socketClass(socket);
    }
}
exports.ServerTCP = ServerTCP;
