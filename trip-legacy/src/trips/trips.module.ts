import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TripsService } from './trips.service';
import { TripsController } from './trips.controller';
import { USER_PROTO, DRIVER_PROTO } from '../common/proto-path';
import { RedisModule } from '../common/redis.module';

@Module({
  imports: [
    // Dù ConfigModule global, thêm vào đây để registerAsync có context chắc chắn
    ConfigModule,
    RedisModule,
    ClientsModule.registerAsync([
      {
        name: 'USER_GRPC',
        // 👇 Quan trọng: thêm imports để factory có ConfigService
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (cfg: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'user',
            protoPath: USER_PROTO,
            url: cfg.get<string>('USER_GRPC_URL') || 'user-service:50051',
          },
        }),
      },
      {
        name: 'DRIVER_GRPC',
        // 👇 Quan trọng: thêm imports để factory có ConfigService
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (cfg: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'driver',
            protoPath: DRIVER_PROTO,
            url: cfg.get<string>('DRIVER_GRPC_URL') || 'driver-stream:50052',
          },
        }),
      },
    ]),
  ],
  controllers: [TripsController],
  providers: [TripsService],
})
export class TripsModule {}
