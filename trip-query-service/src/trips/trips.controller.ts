import { Controller, Get, Param, Query } from '@nestjs/common';
import { TripsService } from './trips.service';

@Controller('trips')
export class TripsController {
  constructor(private svc: TripsService) {}

  // TODO(ModuleA-CQRS): Query service only handles read operations
  // Write operations (POST /trips, POST /trips/:id/accept, etc.) are in trip-command-service

  @Get(':tripId')
  get(@Param('tripId') id: string) {
    return this.svc.getTripById(id);
  }

  @Get('users/:userId/trips')
  getUserTrips(
    @Param('userId') userId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.getUserTrips(userId, {
      status: status ? (status as any) : undefined,
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }
}
