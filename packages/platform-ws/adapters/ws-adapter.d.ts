import { INestApplicationContext, Logger } from '@nestjs/common';
import { AbstractWsAdapter } from '@nestjs/websockets';
import { MessageMappingProperties } from '@nestjs/websockets/gateway-metadata-explorer';
import * as http from 'http';
import { Observable } from 'rxjs';
type WsServerRegistryEntry = any[];
type WsData = string | Buffer | ArrayBuffer | Buffer[];
type WsMessageParser = (data: WsData) => {
    event: string;
    data: any;
} | void;
type WsAdapterOptions = {
    messageParser?: WsMessageParser;
};
/**
 * @publicApi
 */
export declare class WsAdapter extends AbstractWsAdapter {
    protected readonly logger: Logger;
    protected readonly httpServersRegistry: Map<number, any>;
    protected readonly wsServersRegistry: Map<number, WsServerRegistryEntry>;
    protected messageParser: WsMessageParser;
    constructor(appOrHttpServer?: INestApplicationContext | object, options?: WsAdapterOptions);
    create(port: number, options?: Record<string, any> & {
        namespace?: string;
        server?: any;
        path?: string;
    }): any;
    bindMessageHandlers(client: any, handlers: MessageMappingProperties[], transform: (data: any) => Observable<any>): void;
    bindMessageHandler(buffer: any, handlersMap: Map<string, MessageMappingProperties>, transform: (data: any) => Observable<any>): Observable<any>;
    bindErrorHandler(server: any): any;
    bindClientDisconnect(client: any, callback: Function): void;
    close(server: any): Promise<void>;
    dispose(): Promise<void>;
    setMessageParser(parser: WsMessageParser): void;
    protected ensureHttpServerExists(port: number, httpServer?: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>): http.Server<typeof http.IncomingMessage, typeof http.ServerResponse> | undefined;
    protected addWsServerToRegistry<T extends Record<'path', string> = any>(wsServer: T, port: number, path: string): void;
}
export {};
