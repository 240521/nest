import { Controller } from '@nestjs/common/interfaces/controllers/controller.interface';
import { NestContainer } from '@nestjs/core/injector/container';
import { Injector } from '@nestjs/core/injector/injector';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { Module } from '@nestjs/core/injector/module';
import { GraphInspector } from '@nestjs/core/inspector/graph-inspector';
import { Observable, ObservedValueOf } from 'rxjs';
import { IClientProxyFactory } from './client/client-proxy-factory';
import { ClientsContainer } from './container';
import { ExceptionFiltersContext } from './context/exception-filters-context';
import { RpcContextCreator } from './context/rpc-context-creator';
import { Transport } from './enums';
import { MessageHandler, PatternMetadata } from './interfaces';
import { EventOrMessageListenerDefinition } from './listener-metadata-explorer';
import { Server } from './server/server';
export declare class ListenersController {
    private readonly clientsContainer;
    private readonly contextCreator;
    private readonly container;
    private readonly injector;
    private readonly clientFactory;
    private readonly exceptionFiltersContext;
    private readonly graphInspector;
    private readonly metadataExplorer;
    private readonly exceptionFiltersCache;
    constructor(clientsContainer: ClientsContainer, contextCreator: RpcContextCreator, container: NestContainer, injector: Injector, clientFactory: IClientProxyFactory, exceptionFiltersContext: ExceptionFiltersContext, graphInspector: GraphInspector);
    registerPatternHandlers(instanceWrapper: InstanceWrapper<Controller>, serverInstance: Server, moduleKey: string): void;
    insertEntrypointDefinition(instanceWrapper: InstanceWrapper, definition: EventOrMessageListenerDefinition, transportId: Transport | symbol): void;
    forkJoinHandlersIfAttached(currentReturnValue: Promise<unknown> | Observable<unknown>, originalArgs: unknown[], handlerRef: MessageHandler): Observable<unknown> | Promise<unknown>;
    assignClientsToProperties(instance: Controller): void;
    assignClientToInstance<T = any>(instance: Controller, property: string, client: T): void;
    createRequestScopedHandler(wrapper: InstanceWrapper, pattern: PatternMetadata, moduleRef: Module, moduleKey: string, methodKey: string, defaultCallMetadata?: Record<string, any>, isEventHandler?: boolean): MessageHandler<any, any, any>;
    private getContextId;
    transformToObservable<T>(resultOrDeferred: Observable<T> | Promise<T>): Observable<T>;
    transformToObservable<T>(resultOrDeferred: T): never extends Observable<ObservedValueOf<T>> ? Observable<T> : Observable<ObservedValueOf<T>>;
}
