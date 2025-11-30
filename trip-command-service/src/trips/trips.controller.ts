import { Body, Controller, Get, Param, Post, Req, ForbiddenException } from '@nestjs/common';
import { TripsService } from './trips.service';
import { CancelDto, CreateTripDto, FinishDto, QuoteDto, RateDto } from './dto';

@Controller('trips')
export class TripsController {
  constructor(private svc: TripsService) {}

  @Post('quote')
  quote(@Body() dto: QuoteDto) {
    return this.svc.quote(dto);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateTripDto) {
    // userId do gateway set từ JWT
    const passengerId =
      (req.headers['x-user-id'] as string) || 'u_pass_dev'; // fallback dev
    const userRole = (req.headers['x-user-role'] as string) || '';

    return this.svc.create(passengerId, userRole, dto);
  }

  // TODO(ModuleA-CQRS): Read operations moved to trip-query-service
  // @Get(':tripId') removed - use trip-query-service instead

  @Post(':tripId/cancel')
  cancel(@Req() req: any, @Param('tripId') id: string, @Body() dto: CancelDto) {
    const userId = (req.headers['x-user-id'] as string) || 'unknown';
    return this.svc.cancel(id, userId, dto);
  }

  @Post(':tripId/rate')
  rate(@Req() req: any, @Param('tripId') id: string, @Body() dto: RateDto) {
    const userId = (req.headers['x-user-id'] as string) || 'unknown';
    return this.svc.rate(id, userId, dto);
  }

  @Post(':tripId/accept')
  async accept(@Req() req: any, @Param('tripId') id: string) {
    const driverId = (req.headers['x-user-id'] as string) || 'driver_dev';
    const role = (req.headers['x-user-role'] as string) || '';
    
    // Handle non-driver role gracefully (return 200 with reason, not 403)
    if (role !== 'DRIVER') {
      return {
        success: false,
        reason: 'NOT_DRIVER',
        message: 'Only drivers can accept trips',
      };
    }
    
    return this.svc.accept(id, driverId);
  }

  @Post(':tripId/decline')
  decline(@Req() req: any, @Param('tripId') id: string) {
    const driverId = (req.headers['x-user-id'] as string) || 'driver_dev';
    return this.svc.decline(id, driverId);
  }

  @Post(':tripId/arrive-pickup')
  arrive(@Param('tripId') id: string) {
    return this.svc.arrive(id);
  }

  @Post(':tripId/start')
  start(@Param('tripId') id: string) {
    return this.svc.start(id);
  }

  @Post(':tripId/finish')
  finish(@Param('tripId') id: string, @Body() b: FinishDto) {
    return this.svc.finish(id, b);
  }
}
