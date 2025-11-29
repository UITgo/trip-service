"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TripsModule = void 0;
const common_1 = require("@nestjs/common");
const microservices_1 = require("@nestjs/microservices");
const config_1 = require("@nestjs/config");
const trips_service_1 = require("./trips.service");
const trips_controller_1 = require("./trips.controller");
const proto_path_1 = require("../common/proto-path");
let TripsModule = class TripsModule {
};
exports.TripsModule = TripsModule;
exports.TripsModule = TripsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule,
            microservices_1.ClientsModule.registerAsync([
                {
                    name: 'USER_GRPC',
                    imports: [config_1.ConfigModule],
                    inject: [config_1.ConfigService],
                    useFactory: (cfg) => ({
                        transport: microservices_1.Transport.GRPC,
                        options: {
                            package: 'user',
                            protoPath: proto_path_1.USER_PROTO,
                            url: cfg.get('USER_GRPC_URL') || 'user-service:50051',
                        },
                    }),
                },
                {
                    name: 'DRIVER_GRPC',
                    imports: [config_1.ConfigModule],
                    inject: [config_1.ConfigService],
                    useFactory: (cfg) => ({
                        transport: microservices_1.Transport.GRPC,
                        options: {
                            package: 'driver',
                            protoPath: proto_path_1.DRIVER_PROTO,
                            url: cfg.get('DRIVER_GRPC_URL') || 'driver-stream:50052',
                        },
                    }),
                },
            ]),
        ],
        controllers: [trips_controller_1.TripsController],
        providers: [trips_service_1.TripsService],
    })
], TripsModule);
//# sourceMappingURL=trips.module.js.map