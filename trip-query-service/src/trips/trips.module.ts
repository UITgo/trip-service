import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TripsService } from './trips.service';
import { TripsController } from './trips.controller';
import { RedisModule } from '../common/redis.module';

// TODO(ModuleA-CQRS): Query service doesn't need gRPC clients (no write operations)
@Module({
  imports: [
    ConfigModule,
    RedisModule, // Keep Redis for cache
  ],
  controllers: [TripsController],
  providers: [TripsService],
})
export class TripsModule {}
