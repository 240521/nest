"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerRMQ = void 0;
/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
const shared_utils_1 = require("@nestjs/common/utils/shared.utils");
const constants_1 = require("../constants");
const ctx_host_1 = require("../ctx-host");
const enums_1 = require("../enums");
const rmq_record_serializer_1 = require("../serializers/rmq-record.serializer");
const server_1 = require("./server");
let rmqPackage = {}; // as typeof import('amqp-connection-manager');
const INFINITE_CONNECTION_ATTEMPTS = -1;
/**
 * @publicApi
 */
class ServerRMQ extends server_1.Server {
    constructor(options) {
        super();
        this.options = options;
        this.transportId = enums_1.Transport.RMQ;
        this.server = null;
        this.channel = null;
        this.connectionAttempts = 0;
        this.wildcardHandlers = new Map();
        this.pendingEventListeners = [];
        this.urls = this.getOptionsProp(this.options, 'urls') || [constants_1.RQM_DEFAULT_URL];
        this.queue =
            this.getOptionsProp(this.options, 'queue') || constants_1.RQM_DEFAULT_QUEUE;
        this.noAck = this.getOptionsProp(this.options, 'noAck', constants_1.RQM_DEFAULT_NOACK);
        this.queueOptions =
            this.getOptionsProp(this.options, 'queueOptions') ||
                constants_1.RQM_DEFAULT_QUEUE_OPTIONS;
        this.loadPackage('amqplib', ServerRMQ.name, () => require('amqplib'));
        rmqPackage = this.loadPackage('amqp-connection-manager', ServerRMQ.name, () => require('amqp-connection-manager'));
        this.initializeSerializer(options);
        this.initializeDeserializer(options);
    }
    async listen(callback) {
        try {
            await this.start(callback);
        }
        catch (err) {
            callback(err);
        }
    }
    async close() {
        this.channel && (await this.channel.close());
        this.server && (await this.server.close());
        this.pendingEventListeners = [];
    }
    async start(callback) {
        this.server = this.createClient();
        this.server.once("connect" /* RmqEventsMap.CONNECT */, () => {
            if (this.channel) {
                return;
            }
            this._status$.next("connected" /* RmqStatus.CONNECTED */);
            this.channel = this.server.createChannel({
                json: false,
                setup: (channel) => this.setupChannel(channel, callback),
            });
        });
        const maxConnectionAttempts = this.getOptionsProp(this.options, 'maxConnectionAttempts', INFINITE_CONNECTION_ATTEMPTS);
        this.registerConnectListener();
        this.registerDisconnectListener();
        this.pendingEventListeners.forEach(({ event, callback }) => this.server.on(event, callback));
        this.pendingEventListeners = [];
        const connectFailedEvent = 'connectFailed';
        this.server.once(connectFailedEvent, async (error) => {
            this._status$.next("disconnected" /* RmqStatus.DISCONNECTED */);
            this.logger.error(constants_1.CONNECTION_FAILED_MESSAGE);
            if (error?.err) {
                this.logger.error(error.err);
            }
            const isReconnecting = !!this.channel;
            if (maxConnectionAttempts === INFINITE_CONNECTION_ATTEMPTS ||
                isReconnecting) {
                return;
            }
            if (++this.connectionAttempts === maxConnectionAttempts) {
                await this.close();
                callback?.(error.err ?? new Error(constants_1.CONNECTION_FAILED_MESSAGE));
            }
        });
    }
    createClient() {
        const socketOptions = this.getOptionsProp(this.options, 'socketOptions');
        return rmqPackage.connect(this.urls, {
            connectionOptions: socketOptions?.connectionOptions,
            heartbeatIntervalInSeconds: socketOptions?.heartbeatIntervalInSeconds,
            reconnectTimeInSeconds: socketOptions?.reconnectTimeInSeconds,
        });
    }
    registerConnectListener() {
        this.server.on("connect" /* RmqEventsMap.CONNECT */, (err) => {
            this._status$.next("connected" /* RmqStatus.CONNECTED */);
        });
    }
    registerDisconnectListener() {
        this.server.on("disconnect" /* RmqEventsMap.DISCONNECT */, (err) => {
            this._status$.next("disconnected" /* RmqStatus.DISCONNECTED */);
            this.logger.error(constants_1.DISCONNECTED_RMQ_MESSAGE);
            this.logger.error(err);
        });
    }
    async setupChannel(channel, callback) {
        const noAssert = this.getOptionsProp(this.options, 'noAssert') ??
            this.queueOptions.noAssert ??
            constants_1.RQM_DEFAULT_NO_ASSERT;
        if (!noAssert) {
            await channel.assertQueue(this.queue, this.queueOptions);
        }
        const isGlobalPrefetchCount = this.getOptionsProp(this.options, 'isGlobalPrefetchCount', constants_1.RQM_DEFAULT_IS_GLOBAL_PREFETCH_COUNT);
        const prefetchCount = this.getOptionsProp(this.options, 'prefetchCount', constants_1.RQM_DEFAULT_PREFETCH_COUNT);
        if (this.options.exchange || this.options.wildcards) {
            // Use queue name as exchange name if exchange is not provided and "wildcards" is set to true
            const exchange = this.getOptionsProp(this.options, 'exchange', this.options.queue);
            const exchangeType = this.getOptionsProp(this.options, 'exchangeType', 'topic');
            await channel.assertExchange(exchange, exchangeType, {
                durable: true,
                arguments: this.getOptionsProp(this.options, 'exchangeArguments', {}),
            });
            if (this.options.routingKey) {
                await channel.bindQueue(this.queue, exchange, this.options.routingKey);
            }
            if (this.options.wildcards) {
                const routingKeys = Array.from(this.getHandlers().keys());
                await Promise.all(routingKeys.map(routingKey => channel.bindQueue(this.queue, exchange, routingKey)));
                // When "wildcards" is set to true,  we need to initialize wildcard handlers
                // otherwise we would not be able to associate the incoming messages with the handlers
                this.initializeWildcardHandlersIfExist();
            }
        }
        await channel.prefetch(prefetchCount, isGlobalPrefetchCount);
        channel.consume(this.queue, (msg) => this.handleMessage(msg, channel), {
            noAck: this.noAck,
            consumerTag: this.getOptionsProp(this.options, 'consumerTag', undefined),
        });
        callback();
    }
    async handleMessage(message, channel) {
        if ((0, shared_utils_1.isNil)(message)) {
            return;
        }
        const { content, properties } = message;
        const rawMessage = this.parseMessageContent(content);
        const packet = await this.deserializer.deserialize(rawMessage, properties);
        const pattern = (0, shared_utils_1.isString)(packet.pattern)
            ? packet.pattern
            : JSON.stringify(packet.pattern);
        const rmqContext = new ctx_host_1.RmqContext([message, channel, pattern]);
        if ((0, shared_utils_1.isUndefined)(packet.id)) {
            return this.handleEvent(pattern, packet, rmqContext);
        }
        const handler = this.getHandlerByPattern(pattern);
        if (!handler) {
            if (!this.noAck) {
                this.logger.warn((0, constants_1.RQM_NO_MESSAGE_HANDLER) `${pattern}`);
                this.channel.nack(rmqContext.getMessage(), false, false);
            }
            const status = 'error';
            const noHandlerPacket = {
                id: packet.id,
                err: constants_1.NO_MESSAGE_HANDLER,
                status,
            };
            return this.sendMessage(noHandlerPacket, properties.replyTo, properties.correlationId);
        }
        const response$ = this.transformToObservable(await handler(packet.data, rmqContext));
        const publish = (data) => this.sendMessage(data, properties.replyTo, properties.correlationId);
        response$ && this.send(response$, publish);
    }
    async handleEvent(pattern, packet, context) {
        const handler = this.getHandlerByPattern(pattern);
        if (!handler && !this.noAck) {
            this.channel.nack(context.getMessage(), false, false);
            return this.logger.warn((0, constants_1.RQM_NO_EVENT_HANDLER) `${pattern}`);
        }
        return super.handleEvent(pattern, packet, context);
    }
    sendMessage(message, replyTo, correlationId) {
        const outgoingResponse = this.serializer.serialize(message);
        const options = outgoingResponse.options;
        delete outgoingResponse.options;
        const buffer = Buffer.from(JSON.stringify(outgoingResponse));
        const sendOptions = { correlationId, ...options };
        this.channel.sendToQueue(replyTo, buffer, sendOptions);
    }
    unwrap() {
        if (!this.server) {
            throw new Error('Not initialized. Please call the "listen"/"startAllMicroservices" method before accessing the server.');
        }
        return this.server;
    }
    on(event, callback) {
        if (this.server) {
            this.server.addListener(event, callback);
        }
        else {
            this.pendingEventListeners.push({ event, callback });
        }
    }
    getHandlerByPattern(pattern) {
        if (!this.options.wildcards) {
            return super.getHandlerByPattern(pattern);
        }
        // Search for non-wildcard handler first
        const handler = super.getHandlerByPattern(pattern);
        if (handler) {
            return handler;
        }
        // Search for wildcard handler
        if (this.wildcardHandlers.size === 0) {
            return null;
        }
        for (const [regex, handler] of this.wildcardHandlers) {
            if (regex.test(pattern)) {
                return handler;
            }
        }
        return null;
    }
    initializeSerializer(options) {
        this.serializer = options?.serializer ?? new rmq_record_serializer_1.RmqRecordSerializer();
    }
    parseMessageContent(content) {
        try {
            return JSON.parse(content.toString());
        }
        catch {
            return content.toString();
        }
    }
    initializeWildcardHandlersIfExist() {
        if (this.wildcardHandlers.size !== 0) {
            return;
        }
        const handlers = this.getHandlers();
        handlers.forEach((handler, pattern) => {
            const regex = this.convertRoutingKeyToRegex(pattern);
            if (regex) {
                this.wildcardHandlers.set(regex, handler);
            }
        });
    }
    convertRoutingKeyToRegex(routingKey) {
        if (!routingKey.includes('#') && !routingKey.includes('*')) {
            return;
        }
        let regexPattern = routingKey.replace(/\\/g, '\\\\').replace(/\./g, '\\.');
        regexPattern = regexPattern.replace(/\*/g, '[^.]+');
        regexPattern = regexPattern.replace(/#/g, '.*');
        return new RegExp(`^${regexPattern}$`);
    }
}
exports.ServerRMQ = ServerRMQ;
