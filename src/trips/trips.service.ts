import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client'
import { ConfigService } from '@nestjs/config';
import { Http } from '../common/http';
import { CancelDto, CreateTripDto, FinishDto, QuoteDto, RateDto } from './dto';
import { emitEvent } from './sse.controller';

enum TripStatus {
  REQUESTED = 'REQUESTED',
  DRIVER_SEARCHING = 'DRIVER_SEARCHING',
  DRIVER_ASSIGNED = 'DRIVER_ASSIGNED',
  EN_ROUTE_TO_PICKUP = 'EN_ROUTE_TO_PICKUP',
  ARRIVED = 'ARRIVED',
  IN_TRIP = 'IN_TRIP',
  COMPLETED = 'COMPLETED',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED'
}


@Injectable()
export class TripsService {
  prisma = new PrismaClient();
  constructor(private cfg: ConfigService) {}

  async quote(dto: QuoteDto) {
    const km = this.haversine(dto.origin, dto.destination);
    const duration = Math.ceil((km / 30) * 60);
    const fare = 10000 + Math.ceil(km * 7000) + duration * 500;
    return {
      distanceKm: +km.toFixed(2),
      durationMin: duration,
      etaPickupMin: 5,
      fare: { base: 10000, distance: Math.ceil(km * 7000), time: duration * 500, total: fare },
    };
  }

  async create(passengerId: string, dto: CreateTripDto) {
    const q = await this.quote({ origin: dto.origin, destination: dto.destination });
    const trip = await this.prisma.trip.create({
      data: {
        passengerId,
        originLat: dto.origin.lat,
        originLng: dto.origin.lng,
        destLat: dto.destination.lat,
        destLng: dto.destination.lng,
        note: dto.note ?? null,
        status: TripStatus.DRIVER_SEARCHING,
        quoteDistanceKm: q.distanceKm,
        quoteDurationMin: q.durationMin,
        quoteFareTotal: q.fare.total,
      },
    });
    emitEvent(trip.id, 'TRIP_CREATED', { id: trip.id, status: trip.status });

    const DS = this.cfg.get<string>('DRIVER_STREAM_BASE')!;
    try {
      const near = await Http.get(`${DS}/drivers/nearby`, {
        params: { lat: dto.origin.lat, lng: dto.origin.lng, radius: 3000, limit: 20 },
      });
      const candidates = (near.data?.drivers ?? []).map((d: any) => d.driverId);
      await Http.post(`${DS}/assign/prepare`, { tripId: trip.id, candidates, ttlSeconds: 15 });
      await this.prisma.tripAssignment.createMany({
        data: candidates.map((c: string) => ({
          tripId: trip.id,
          driverId: c,
          state: 'INVITED',
          ttlSec: 15,
        })),
        skipDuplicates: true,
      });
      await this.prisma.tripEvent.create({
        data: { tripId: trip.id, type: 'DriverSearchStarted', payload: { candidates } },
      });
    } catch {
    }

    return { ...trip, tracking: { sse: `/v1/trips/${trip.id}/events` } };
  }

  async get(tripId: string) {
    const t = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!t) throw new NotFoundException();
    return t;
  }

  async cancel(tripId: string, by: string, reason: CancelDto) {
    const t = await this.get(tripId);
    if ([TripStatus.COMPLETED, TripStatus.CANCELED].includes(t.status))
      throw new BadRequestException('INVALID_STATE');

    const up = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.CANCELED, canceledAt: new Date(), cancelReasonCode: reason.reasonCode },
    });
    emitEvent(tripId, 'STATUS_CHANGED', { status: up.status });
    await this.prisma.tripEvent.create({
      data: { tripId, type: 'Canceled', payload: { by, ...reason } },
    });
    await Http.delete(`${this.cfg.get('DRIVER_STREAM_BASE')}/assign/${tripId}`).catch(() => {});
    return { success: true };
  }

  async rate(tripId: string, raterId: string, body: RateDto) {
    const t = await this.get(tripId);
    if (t.status !== TripStatus.COMPLETED) throw new BadRequestException('NOT_COMPLETED');
    await this.prisma.tripRating.upsert({
      where: { tripId },
      create: { tripId, raterId, driverId: t.driverId ?? '', stars: body.stars, comment: body.comment ?? null },
      update: { stars: body.stars, comment: body.comment ?? null },
    });
    await this.prisma.tripEvent.create({
      data: { tripId, type: 'Rated', payload: { stars: body.stars } },
    });
    return { ok: true };
  }

  async accept(tripId: string, driverId: string) {
    const t = await this.get(tripId);
    if (![TripStatus.DRIVER_SEARCHING, TripStatus.DRIVER_ASSIGNED].includes(t.status))
      throw new BadRequestException('INVALID_STATE');

    await this.prisma.tripAssignment.updateMany({
      where: { tripId, driverId },
      data: { state: 'CLAIMED', respondedAt: new Date() },
    });

    const up = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.EN_ROUTE_TO_PICKUP, driverId },
    });
    emitEvent(tripId, 'STATUS_CHANGED', { status: up.status, driverId });
    await this.prisma.tripEvent.create({
      data: { tripId, type: 'DriverAccepted', payload: { driverId } },
    });
    return { ok: true };
  }

  async decline(tripId: string, driverId: string) {
    await this.get(tripId);
    await this.prisma.tripAssignment.updateMany({
      where: { tripId, driverId },
      data: { state: 'DECLINED', respondedAt: new Date() },
    });
    await this.prisma.tripEvent.create({
      data: { tripId, type: 'DriverDeclined', payload: { driverId } },
    });
    return { ok: true };
  }

  async arrive(tripId: string) { return this.bump(tripId, TripStatus.ARRIVED, 'Arrived'); }
  async start(tripId: string)  { return this.bump(tripId, TripStatus.IN_TRIP, 'Started'); }

  async finish(tripId: string, body: FinishDto) {
    const t = await this.get(tripId);
    if (t.status !== TripStatus.IN_TRIP) throw new BadRequestException('INVALID_STATE');

    const final = Math.max(10000, (t.quoteFareTotal ?? 0)); // MVP: giữ bằng quote
    const up = await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        status: TripStatus.COMPLETED,
        actualDistanceKm: body.actualDistanceKm,
        actualDurationMin: body.actualDurationMin,
        finalFareTotal: final,
      },
    });
    emitEvent(tripId, 'STATUS_CHANGED', { status: up.status, finalFareTotal: final });
    await this.prisma.tripEvent.create({ data: { tripId, type: 'Completed', payload: body } });
    return { finalFareTotal: final, ok: true };
  }

  private async bump(tripId: string, st: TripStatus, evt: string) {
    await this.get(tripId);
    const up = await this.prisma.trip.update({ where: { id: tripId }, data: { status: st } });
    emitEvent(tripId, 'STATUS_CHANGED', { status: up.status });
    await this.prisma.tripEvent.create({ data: { tripId, type: evt, payload: {} } });
    return { ok: true };
  }

  private haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const toRad = (x: number) => (x * Math.PI) / 180, R = 6371;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(s));
  }
}
