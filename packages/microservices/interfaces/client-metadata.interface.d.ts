import { Type } from '@nestjs/common';
import { ConnectionOptions } from 'tls';
import { ClientProxy } from '../client';
import { Transport } from '../enums/transport.enum';
import { TcpSocket } from '../helpers';
import { Deserializer } from './deserializer.interface';
import { GrpcOptions, KafkaOptions, MqttOptions, NatsOptions, RedisOptions, RmqOptions } from './microservice-configuration.interface';
import { Serializer } from './serializer.interface';
export type ClientOptions = RedisOptions | NatsOptions | MqttOptions | GrpcOptions | KafkaOptions | TcpClientOptions | RmqOptions;
/**
 * @publicApi
 */
export interface CustomClientOptions {
    customClass: Type<ClientProxy>;
    options?: Record<string, any>;
}
/**
 * @publicApi
 */
export interface TcpClientOptions {
    transport: Transport.TCP;
    options?: {
        host?: string;
        port?: number;
        serializer?: Serializer;
        deserializer?: Deserializer;
        tlsOptions?: ConnectionOptions;
        socketClass?: Type<TcpSocket>;
    };
}
