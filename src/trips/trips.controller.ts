import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { TripsService } from './trips.service';
import { CancelDto, CreateTripDto, FinishDto, QuoteDto, RateDto } from './dto';
import { JwtGuard } from '../common/jwt.guard';

@UseGuards(JwtGuard)
@Controller('v1/trips')
export class TripsController {
  constructor(private svc: TripsService) {}

  @Post('quote') quote(@Body() dto: QuoteDto) { return this.svc.quote(dto); }

  @Post()
  create(@Req() req: any, @Body() dto: CreateTripDto) {
    const passengerId = req.user?.sub ?? 'passenger';
    return this.svc.create(passengerId, dto);
  }

  @Get(':tripId') get(@Param('tripId') id: string) { return this.svc.get(id); }

  @Post(':tripId/cancel')
  cancel(@Req() req: any, @Param('tripId') id: string, @Body() dto: CancelDto) {
    return this.svc.cancel(id, req.user?.sub ?? 'unknown', dto);
  }

  @Post(':tripId/rate')
  rate(@Req() req: any, @Param('tripId') id: string, @Body() dto: RateDto) {
    return this.svc.rate(id, req.user?.sub ?? 'unknown', dto);
  }

  @Post(':tripId/accept')  accept(@Req() req: any, @Param('tripId') id: string) {
    return this.svc.accept(id, req.user?.sub ?? 'driver');
  }
  @Post(':tripId/decline') decline(@Req() req: any, @Param('tripId') id: string) {
    return this.svc.decline(id, req.user?.sub ?? 'driver');
  }
  @Post(':tripId/arrive-pickup') arrive(@Param('tripId') id: string) { return this.svc.arrive(id); }
  @Post(':tripId/start')          start(@Param('tripId') id: string)  { return this.svc.start(id); }
  @Post(':tripId/finish')         finish(@Param('tripId') id: string, @Body() b: FinishDto) {
    return this.svc.finish(id, b);
  }
}
