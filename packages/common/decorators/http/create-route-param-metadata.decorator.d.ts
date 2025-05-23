import { PipeTransform } from '../../index';
import { Type } from '../../interfaces';
import { CustomParamFactory } from '../../interfaces/features/custom-route-param-factory.interface';
export type ParamDecoratorEnhancer = ParameterDecorator;
/**
 * Defines HTTP route param decorator
 *
 * @param factory
 * @param enhancers
 *
 * @publicApi
 */
export declare function createParamDecorator<FactoryData = any, FactoryOutput = any>(factory: CustomParamFactory<FactoryData, FactoryOutput>, enhancers?: ParamDecoratorEnhancer[]): (...dataOrPipes: (Type<PipeTransform> | PipeTransform | FactoryData)[]) => ParameterDecorator;
