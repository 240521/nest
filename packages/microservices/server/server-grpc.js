"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerGrpc = void 0;
const shared_utils_1 = require("@nestjs/common/utils/shared.utils");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const constants_1 = require("../constants");
const decorators_1 = require("../decorators");
const enums_1 = require("../enums");
const invalid_grpc_package_exception_1 = require("../errors/invalid-grpc-package.exception");
const invalid_proto_definition_exception_1 = require("../errors/invalid-proto-definition.exception");
const helpers_1 = require("../helpers");
const server_1 = require("./server");
const CANCELLED_EVENT = 'cancelled';
let grpcPackage = {};
let grpcProtoLoaderPackage = {};
/**
 * @publicApi
 */
class ServerGrpc extends server_1.Server {
    get status() {
        throw new Error('The "status" attribute is not supported by the gRPC transport');
    }
    constructor(options) {
        super();
        this.options = options;
        this.transportId = enums_1.Transport.GRPC;
        this.url = this.getOptionsProp(options, 'url') || constants_1.GRPC_DEFAULT_URL;
        const protoLoader = this.getOptionsProp(options, 'protoLoader') || constants_1.GRPC_DEFAULT_PROTO_LOADER;
        grpcPackage = this.loadPackage('@grpc/grpc-js', ServerGrpc.name, () => require('@grpc/grpc-js'));
        grpcProtoLoaderPackage = this.loadPackage(protoLoader, ServerGrpc.name, () => protoLoader === constants_1.GRPC_DEFAULT_PROTO_LOADER
            ? require('@grpc/proto-loader')
            : require(protoLoader));
    }
    async listen(callback) {
        try {
            this.grpcClient = await this.createClient();
            await this.start(callback);
        }
        catch (err) {
            callback(err);
        }
    }
    async start(callback) {
        await this.bindEvents();
        callback?.();
    }
    async bindEvents() {
        const grpcContext = this.loadProto();
        const packageOption = this.getOptionsProp(this.options, 'package');
        const packageNames = Array.isArray(packageOption)
            ? packageOption
            : [packageOption];
        for (const packageName of packageNames) {
            const grpcPkg = this.lookupPackage(grpcContext, packageName);
            await this.createServices(grpcPkg, packageName);
        }
    }
    /**
     * Will return all of the services along with their fully namespaced
     * names as an array of objects.
     * This method initiates recursive scan of grpcPkg object
     */
    getServiceNames(grpcPkg) {
        // Define accumulator to collect all of the services available to load
        const services = [];
        // Initiate recursive services collector starting with empty name
        this.collectDeepServices('', grpcPkg, services);
        return services;
    }
    /**
     * Will create service mapping from gRPC generated Object to handlers
     * defined with @GrpcMethod or @GrpcStreamMethod annotations
     *
     * @param grpcService
     * @param name
     */
    async createService(grpcService, name) {
        const service = {};
        for (const methodName in grpcService.prototype) {
            let methodHandler = null;
            let streamingType = decorators_1.GrpcMethodStreamingType.NO_STREAMING;
            const methodFunction = grpcService.prototype[methodName];
            const methodReqStreaming = methodFunction.requestStream;
            if (!(0, shared_utils_1.isUndefined)(methodReqStreaming) && methodReqStreaming) {
                // Try first pattern to be presented, RX streaming pattern would be
                // a preferable pattern to select among a few defined
                methodHandler = this.getMessageHandler(name, methodName, decorators_1.GrpcMethodStreamingType.RX_STREAMING, methodFunction);
                streamingType = decorators_1.GrpcMethodStreamingType.RX_STREAMING;
                // If first pattern didn't match to any of handlers then try
                // pass-through handler to be presented
                if (!methodHandler) {
                    methodHandler = this.getMessageHandler(name, methodName, decorators_1.GrpcMethodStreamingType.PT_STREAMING, methodFunction);
                    streamingType = decorators_1.GrpcMethodStreamingType.PT_STREAMING;
                }
            }
            else {
                // Select handler if any presented for No-Streaming pattern
                methodHandler = this.getMessageHandler(name, methodName, decorators_1.GrpcMethodStreamingType.NO_STREAMING, methodFunction);
                streamingType = decorators_1.GrpcMethodStreamingType.NO_STREAMING;
            }
            if (!methodHandler) {
                continue;
            }
            service[methodName] = this.createServiceMethod(methodHandler, grpcService.prototype[methodName], streamingType);
        }
        return service;
    }
    getMessageHandler(serviceName, methodName, streaming, grpcMethod) {
        let pattern = this.createPattern(serviceName, methodName, streaming);
        let methodHandler = this.messageHandlers.get(pattern);
        if (!methodHandler) {
            const packageServiceName = grpcMethod.path?.split?.('/')[1];
            pattern = this.createPattern(packageServiceName, methodName, streaming);
            methodHandler = this.messageHandlers.get(pattern);
        }
        return methodHandler;
    }
    /**
     * Will create a string of a JSON serialized format
     *
     * @param service name of the service which should be a match to gRPC service definition name
     * @param methodName name of the method which is coming after rpc keyword
     * @param streaming GrpcMethodStreamingType parameter which should correspond to
     * stream keyword in gRPC service request part
     */
    createPattern(service, methodName, streaming) {
        return JSON.stringify({
            service,
            rpc: methodName,
            streaming,
        });
    }
    /**
     * Will return async function which will handle gRPC call
     * with Rx streams or as a direct call passthrough
     *
     * @param methodHandler
     * @param protoNativeHandler
     * @param streamType
     */
    createServiceMethod(methodHandler, protoNativeHandler, streamType) {
        // If proto handler has request stream as "true" then we expect it to have
        // streaming from the side of requester
        if (protoNativeHandler.requestStream) {
            // If any handlers were defined with GrpcStreamMethod annotation use RX
            if (streamType === decorators_1.GrpcMethodStreamingType.RX_STREAMING) {
                return this.createRequestStreamMethod(methodHandler, protoNativeHandler.responseStream);
            }
            // If any handlers were defined with GrpcStreamCall annotation
            else if (streamType === decorators_1.GrpcMethodStreamingType.PT_STREAMING) {
                return this.createStreamCallMethod(methodHandler, protoNativeHandler.responseStream);
            }
        }
        return protoNativeHandler.responseStream
            ? this.createStreamServiceMethod(methodHandler)
            : this.createUnaryServiceMethod(methodHandler);
    }
    createUnaryServiceMethod(methodHandler) {
        return async (call, callback) => {
            const handler = methodHandler(call.request, call.metadata, call);
            this.transformToObservable(await handler).subscribe({
                next: async (data) => callback(null, await data),
                error: (err) => callback(err),
            });
        };
    }
    createStreamServiceMethod(methodHandler) {
        return async (call, callback) => {
            const handler = methodHandler(call.request, call.metadata, call);
            const result$ = this.transformToObservable(await handler);
            await this.writeObservableToGrpc(result$, call);
        };
    }
    unwrap() {
        throw new Error('Method is not supported for gRPC transport');
    }
    on(event, callback) {
        throw new Error('Method is not supported in gRPC mode.');
    }
    /**
     * Writes an observable to a GRPC call.
     *
     * This function will ensure that backpressure is managed while writing values
     * that come from an observable to a GRPC call.
     *
     * @param source The observable we want to write out to the GRPC call.
     * @param call The GRPC call we want to write to.
     * @returns A promise that resolves when we're done writing to the call.
     */
    writeObservableToGrpc(source, call) {
        // This promise should **not** reject, as we're handling errors in the observable for the Call
        // the promise is only needed to signal when writing/draining has been completed
        return new Promise((resolve, _doNotUse) => {
            const valuesWaitingToBeDrained = [];
            let shouldErrorAfterDraining = false;
            let error;
            let shouldResolveAfterDraining = false;
            let writing = true;
            // Used to manage finalization
            const subscription = new rxjs_1.Subscription();
            // If the call is cancelled, unsubscribe from the source
            const cancelHandler = () => {
                subscription.unsubscribe();
                // Calls that are cancelled by the client should be successfully resolved here
                resolve();
            };
            call.on(CANCELLED_EVENT, cancelHandler);
            subscription.add(() => call.off(CANCELLED_EVENT, cancelHandler));
            // In all cases, when we finalize, end the writable stream
            // being careful that errors and writes must be emitted _before_ this call is ended
            subscription.add(() => call.end());
            const drain = () => {
                writing = true;
                while (valuesWaitingToBeDrained.length > 0) {
                    const value = valuesWaitingToBeDrained.shift();
                    if (writing) {
                        // The first time `call.write` returns false, we need to stop.
                        // It wrote the value, but it won't write anything else.
                        writing = call.write(value);
                        if (!writing) {
                            // We can't write anymore so we need to wait for the drain event
                            return;
                        }
                    }
                }
                if (shouldResolveAfterDraining) {
                    subscription.unsubscribe();
                    resolve();
                }
                else if (shouldErrorAfterDraining) {
                    call.emit('error', error);
                    subscription.unsubscribe();
                    resolve();
                }
            };
            call.on('drain', drain);
            subscription.add(() => call.off('drain', drain));
            subscription.add(source.subscribe({
                next(value) {
                    if (writing) {
                        writing = call.write(value);
                    }
                    else {
                        // If we can't write, that's because we need to
                        // wait for the drain event before we can write again
                        // buffer the value and wait for the drain event
                        valuesWaitingToBeDrained.push(value);
                    }
                },
                error(err) {
                    if (valuesWaitingToBeDrained.length === 0) {
                        // We're not waiting for a drain event, so we can just
                        // reject and teardown.
                        call.emit('error', err);
                        subscription.unsubscribe();
                        resolve();
                    }
                    else {
                        // We're waiting for a drain event, record the
                        // error so it can be handled after everything is drained.
                        shouldErrorAfterDraining = true;
                        error = err;
                    }
                },
                complete() {
                    if (valuesWaitingToBeDrained.length === 0) {
                        // We're not waiting for a drain event, so we can just
                        // resolve and teardown.
                        subscription.unsubscribe();
                        resolve();
                    }
                    else {
                        shouldResolveAfterDraining = true;
                    }
                },
            }));
        });
    }
    createRequestStreamMethod(methodHandler, isResponseStream) {
        return async (call, callback) => {
            // Needs to be a Proxy in order to buffer messages that come before handler is executed
            // This could happen if handler has any async guards or interceptors registered that would delay
            // the execution.
            const { subject, next, error, complete, cleanup } = this.bufferUntilDrained();
            call.on('data', (m) => next(m));
            call.on('error', (e) => {
                // Check if error means that stream ended on other end
                const isCancelledError = String(e).toLowerCase().indexOf('cancelled');
                if (isCancelledError) {
                    call.end();
                    return;
                }
                // If another error then just pass it along
                error(e);
            });
            call.on('end', () => {
                complete();
                cleanup();
            });
            const handler = methodHandler(subject.asObservable(), call.metadata, call);
            const res = this.transformToObservable(await handler);
            if (isResponseStream) {
                await this.writeObservableToGrpc(res, call);
            }
            else {
                const response = await (0, rxjs_1.lastValueFrom)(res.pipe((0, operators_1.takeUntil)((0, rxjs_1.fromEvent)(call, CANCELLED_EVENT)), (0, operators_1.catchError)(err => {
                    callback(err, null);
                    return rxjs_1.EMPTY;
                }), (0, rxjs_1.defaultIfEmpty)(undefined)));
                if (!(0, shared_utils_1.isUndefined)(response)) {
                    callback(null, response);
                }
            }
        };
    }
    createStreamCallMethod(methodHandler, isResponseStream) {
        return async (call, callback) => {
            let handlerStream;
            if (isResponseStream) {
                handlerStream = this.transformToObservable(await methodHandler(call));
            }
            else {
                handlerStream = this.transformToObservable(await methodHandler(call, callback));
            }
            await (0, rxjs_1.lastValueFrom)(handlerStream);
        };
    }
    async close() {
        if (this.grpcClient) {
            const graceful = this.getOptionsProp(this.options, 'gracefulShutdown');
            if (graceful) {
                await new Promise((resolve, reject) => {
                    this.grpcClient.tryShutdown((error) => {
                        if (error)
                            reject(error);
                        else
                            resolve();
                    });
                });
            }
            else {
                this.grpcClient.forceShutdown();
            }
        }
        this.grpcClient = null;
    }
    deserialize(obj) {
        try {
            return JSON.parse(obj);
        }
        catch (e) {
            return obj;
        }
    }
    addHandler(pattern, callback, isEventHandler = false) {
        const route = (0, shared_utils_1.isString)(pattern) ? pattern : JSON.stringify(pattern);
        callback.isEventHandler = isEventHandler;
        this.messageHandlers.set(route, callback);
    }
    async createClient() {
        const channelOptions = this.options && this.options.channelOptions
            ? this.options.channelOptions
            : {};
        if (this.options && this.options.maxSendMessageLength) {
            channelOptions['grpc.max_send_message_length'] =
                this.options.maxSendMessageLength;
        }
        if (this.options && this.options.maxReceiveMessageLength) {
            channelOptions['grpc.max_receive_message_length'] =
                this.options.maxReceiveMessageLength;
        }
        if (this.options && this.options.maxMetadataSize) {
            channelOptions['grpc.max_metadata_size'] = this.options.maxMetadataSize;
        }
        const server = new grpcPackage.Server(channelOptions);
        const credentials = this.getOptionsProp(this.options, 'credentials');
        await new Promise((resolve, reject) => {
            server.bindAsync(this.url, credentials || grpcPackage.ServerCredentials.createInsecure(), (error, port) => error ? reject(error) : resolve(port));
        });
        return server;
    }
    lookupPackage(root, packageName) {
        /** Reference: https://github.com/kondi/rxjs-grpc */
        let pkg = root;
        for (const name of packageName.split(/\./)) {
            pkg = pkg[name];
        }
        return pkg;
    }
    loadProto() {
        try {
            const packageDefinition = (0, helpers_1.getGrpcPackageDefinition)(this.options, grpcProtoLoaderPackage);
            if (this.options.onLoadPackageDefinition) {
                this.options.onLoadPackageDefinition(packageDefinition, this.grpcClient);
            }
            return grpcPackage.loadPackageDefinition(packageDefinition);
        }
        catch (err) {
            const invalidProtoError = new invalid_proto_definition_exception_1.InvalidProtoDefinitionException(err.path);
            const message = err && err.message ? err.message : invalidProtoError.message;
            this.logger.error(message, invalidProtoError.stack);
            throw invalidProtoError;
        }
    }
    /**
     * Recursively fetch all of the service methods available on loaded
     * protobuf descriptor object, and collect those as an objects with
     * dot-syntax full-path names.
     *
     * Example:
     *  for proto package Bundle.FirstService with service Events { rpc...
     *  will be resolved to object of (while loaded for Bundle package):
     *    {
     *      name: "FirstService.Events",
     *      service: {Object}
     *    }
     */
    collectDeepServices(name, grpcDefinition, accumulator) {
        if (!(0, shared_utils_1.isObject)(grpcDefinition)) {
            return;
        }
        const keysToTraverse = Object.keys(grpcDefinition);
        // Traverse definitions or namespace extensions
        for (const key of keysToTraverse) {
            const nameExtended = this.parseDeepServiceName(name, key);
            const deepDefinition = grpcDefinition[key];
            const isServiceDefined = deepDefinition && !(0, shared_utils_1.isUndefined)(deepDefinition.service);
            const isServiceBoolean = isServiceDefined
                ? deepDefinition.service !== false
                : false;
            // grpc namespace object does not have 'format' or 'service' properties defined
            const isFormatDefined = deepDefinition && !(0, shared_utils_1.isUndefined)(deepDefinition.format);
            if (isServiceDefined && isServiceBoolean) {
                accumulator.push({
                    name: nameExtended,
                    service: deepDefinition,
                });
            }
            else if (isFormatDefined) {
                // Do nothing
            }
            else {
                // Continue recursion for namespace object until objects end or service definition found
                this.collectDeepServices(nameExtended, deepDefinition, accumulator);
            }
        }
    }
    parseDeepServiceName(name, key) {
        // If depth is zero then just return key
        if (name.length === 0) {
            return key;
        }
        // Otherwise add next through dot syntax
        return name + '.' + key;
    }
    async createServices(grpcPkg, packageName) {
        if (!grpcPkg) {
            const invalidPackageError = new invalid_grpc_package_exception_1.InvalidGrpcPackageException(packageName);
            this.logger.error(invalidPackageError);
            throw invalidPackageError;
        }
        // Take all of the services defined in grpcPkg and assign them to
        // method handlers defined in Controllers
        for (const definition of this.getServiceNames(grpcPkg)) {
            this.grpcClient.addService(
            // First parameter requires exact service definition from proto
            definition.service.service, 
            // Here full proto definition required along with namespaced pattern name
            await this.createService(definition.service, definition.name));
        }
    }
    bufferUntilDrained() {
        const subject = new rxjs_1.Subject();
        let replayBuffer = new rxjs_1.ReplaySubject();
        let hasDrained = false;
        function drainBuffer() {
            if (hasDrained || !replayBuffer) {
                return;
            }
            hasDrained = true;
            // Replay buffered values to the new subscriber
            setImmediate(() => {
                const subcription = replayBuffer.subscribe(subject);
                subcription.unsubscribe();
                replayBuffer = null;
            });
        }
        return {
            subject: new Proxy(subject, {
                get(target, prop, receiver) {
                    if (prop === 'asObservable') {
                        return () => {
                            const stream = subject.asObservable();
                            // "drainBuffer" will be called before the evaluation of the handler
                            // but after any enhancers have been applied (e.g., `interceptors`)
                            Object.defineProperty(stream, drainBuffer.name, {
                                value: drainBuffer,
                            });
                            return stream;
                        };
                    }
                    if (hasDrained) {
                        return Reflect.get(target, prop, receiver);
                    }
                    return Reflect.get(replayBuffer, prop, receiver);
                },
            }),
            next: (value) => {
                if (!hasDrained) {
                    replayBuffer.next(value);
                }
                subject.next(value);
            },
            error: (err) => {
                if (!hasDrained) {
                    replayBuffer.error(err);
                }
                subject.error(err);
            },
            complete: () => {
                if (!hasDrained) {
                    replayBuffer.complete();
                    // Replay buffer is no longer needed
                    // Return early to allow subject to complete later, after the replay buffer
                    // has been drained
                    return;
                }
                subject.complete();
            },
            cleanup: () => {
                if (hasDrained) {
                    return;
                }
                replayBuffer = null;
            },
        };
    }
}
exports.ServerGrpc = ServerGrpc;
