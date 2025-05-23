"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGrpcPackageDefinition = getGrpcPackageDefinition;
const invalid_grpc_package_definition_missing_package_definition_exception_1 = require("../errors/invalid-grpc-package-definition-missing-package-definition.exception");
const invalid_grpc_package_definition_mutex_exception_1 = require("../errors/invalid-grpc-package-definition-mutex.exception");
function getGrpcPackageDefinition(options, grpcProtoLoaderPackage) {
    const file = options['protoPath'];
    const packageDefinition = options['packageDefinition'];
    if (file && packageDefinition) {
        throw new invalid_grpc_package_definition_mutex_exception_1.InvalidGrpcPackageDefinitionMutexException();
    }
    if (!file && !packageDefinition) {
        throw new invalid_grpc_package_definition_missing_package_definition_exception_1.InvalidGrpcPackageDefinitionMissingPackageDefinitionException();
    }
    return (packageDefinition ||
        grpcProtoLoaderPackage.loadSync(file, options['loader']));
}
