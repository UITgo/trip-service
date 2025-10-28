import { Module } from '@nestjs/common';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { TripsSSEController } from './sse.controller';

@Module({
  controllers: [TripsController, TripsSSEController],
  providers: [TripsService],
})
export class TripsModule {}
