import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Inject,
  OnModuleInit,
  InternalServerErrorException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { CancelDto, CreateTripDto, FinishDto, QuoteDto, RateDto } from './dto';
import { emitEvent } from './sse.controller';
// TODO(ModuleA-CQRS): Redis removed from command service (cache handled by query service)

import { Observable, of, firstValueFrom } from 'rxjs';
import { catchError } from 'rxjs/operators';

// Prisma enum alias (type-only)
type TripStatus =
  | 'REQUESTED'
  | 'DRIVER_SEARCHING'
  | 'DRIVER_ASSIGNED'
  | 'EN_ROUTE_TO_PICKUP'
  | 'ARRIVED'
  | 'IN_TRIP'
  | 'COMPLETED'
  | 'CANCELED'
  | 'EXPIRED';

// ----- gRPC service types (Observable!) -----
type UserGrpc = {
  GetProfile(data: { user_id: string }): Observable<{
    exists: boolean;
    user_id: string;
    name: string;
    avatar_url: string;
    role: 'PASSENGER' | 'DRIVER' | '';  // hoặc string nếu bạn muốn thoải mái hơn
  }>;
};


type DriverGrpc = {
  GetNearbyDrivers(data: {
    location: { lat: number; lng: number };
    radius?: number;
    limit?: number;
  }): Observable<{ drivers: { driver_id: string }[] }>;

  PrepareAssign(data: {
    trip_id: string;
    candidate_ids: string[];
    ttl_seconds: number;
  }): Observable<{ queued: boolean }>;

  ClaimTrip(data: {
    trip_id: string;
    driver_id: string;
  }): Observable<{ status: string }>;
};

@Injectable()
export class TripsService implements OnModuleInit {
  private readonly logger = new Logger(TripsService.name);
  prisma: PrismaClient;
  

  private user!: UserGrpc;
  private driver!: DriverGrpc;

  constructor(
    private cfg: ConfigService,
    @Inject('USER_GRPC') private readonly userClient: ClientGrpc,
    @Inject('DRIVER_GRPC') private readonly driverClient: ClientGrpc,
    // TODO(ModuleA-CQRS): Redis removed - cache invalidation handled by query service
  ) {
    // TODO(ModuleA-CQRS): Use PRIMARY_DB_URL for writes
    const primaryDbUrl = this.cfg.get<string>('PRIMARY_DB_URL') || this.cfg.get<string>('DATABASE_URL') || 'postgresql://uitgo:uitgo@postgres:5432/tripdb?schema=public';
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: primaryDbUrl,
        },
      },
    });
  }

  onModuleInit() {
    this.user = this.userClient.getService<UserGrpc>('UserService');
    this.driver = this.driverClient.getService<DriverGrpc>('DriverService'); // đổi tên này nếu proto bạn là 'DriverStream'
  }

  // ---------------- Quote ----------------
  async quote(dto: QuoteDto) {
    if (!dto?.origin || !dto?.destination) {
      throw new BadRequestException('origin & destination are required');
    }
    const km = this.haversine(dto.origin, dto.destination);
    const duration = Math.ceil((km / 30) * 60);
    const fare = 10000 + Math.ceil(km * 7000) + duration * 500;
    return {
      distanceKm: +km.toFixed(2),
      durationMin: duration,
      etaPickupMin: 5,
      fare: {
        base: 10000,
        distance: Math.ceil(km * 7000),
        time: duration * 500,
        total: fare,
      },
    };
  }

  // ---------------- Create ----------------
  async create(passengerId: string, dto: CreateTripDto) {
    if (!dto?.origin || !dto?.destination) {
      throw new BadRequestException('origin & destination are required');
    }

    // 1) gọi gRPC UserService.GetProfile để kiểm tra user & role
    const prof = await firstValueFrom(
      this.user
        .GetProfile({ user_id: passengerId })
        .pipe(
          catchError((err) => {
            this.logger.warn(
              `UserService.GetProfile error for ${passengerId}: ${err?.message || err}`,
            );
            return of({
              exists: false,
              user_id: passengerId,
              name: '',
              avatar_url: '',
              role: '' as const,
            });
          }),
        ),
    );

    if (!prof.exists) {
      throw new BadRequestException('User not found');
    }
    if (prof.role !== 'PASSENGER') {
      throw new ForbiddenException('Only passengers can create trips');
    }

    // 2) tính quote
    const q = await this.quote({
      origin: dto.origin,
      destination: dto.destination,
      serviceType: 'bike',
    });

    // 3) tạo trip
    let trip;
    try {
      trip = await this.prisma.trip.create({
        data: {
          passengerId,
          originLat: dto.origin.lat,
          originLng: dto.origin.lng,
          destLat: dto.destination.lat,
          destLng: dto.destination.lng,
          note: dto.note ?? null,
          status: 'DRIVER_SEARCHING' as TripStatus,
          quoteDistanceKm: q.distanceKm,
          quoteDurationMin: q.durationMin,
          quoteFareTotal: q.fare.total,
        },
      });
    } catch (e) {
      this.logger.error('Prisma create trip failed', e as any);
      throw new InternalServerErrorException('cannot create trip');
    }

    // ... phần còn lại giữ nguyên


    emitEvent(trip.id, 'TRIP_CREATED', { id: trip.id, status: trip.status });

    // 4) hỏi danh sách tài xế gần & prepare assign qua gRPC
    try {
      this.logger.log(`Finding nearby drivers for trip ${trip.id} at (${dto.origin.lat}, ${dto.origin.lng})`);
      
      const nearby = await firstValueFrom(
        this.driver
          .GetNearbyDrivers({
            location: { lat: dto.origin.lat, lng: dto.origin.lng },
            radius: 3000,
            limit: 20,
          })
          .pipe(
            catchError((err) => {
              this.logger.warn(`Driver GetNearbyDrivers failed: ${err?.message || err}`);
              return of({ drivers: [] });
            }),
          ),
      );

      const candidates = (nearby?.drivers ?? []).map((d) => d.driver_id);
      this.logger.log(`Found ${candidates.length} nearby drivers for trip ${trip.id}`);
      
      if (candidates.length) {
        await firstValueFrom(
          this.driver
            .PrepareAssign({
              trip_id: trip.id,
              candidate_ids: candidates,
              ttl_seconds: 15,
            })
            .pipe(
              catchError((err) => {
                this.logger.warn(`Driver PrepareAssign failed: ${err?.message || err}`);
                return of({ queued: false });
              }),
            ),
        );

        await this.prisma.tripAssignment.createMany({
          data: candidates.map((c) => ({
            tripId: trip.id,
            driverId: c,
            state: 'INVITED',
            ttlSec: 15,
          })),
          skipDuplicates: true,
        });

        await this.prisma.tripEvent.create({
          data: {
            tripId: trip.id,
            type: 'DriverSearchStarted',
            payload: ({ candidates } as any),
          },
        });
      } else {
        this.logger.warn(`No nearby drivers found for trip ${trip.id}`);
      }
    } catch (e) {
      this.logger.error(`Driver search error for trip ${trip.id}:`, e);
      await this.prisma.tripEvent.create({
        data: {
          tripId: trip.id,
          type: 'DriverSearchError',
          payload: ({ message: 'driver-stream unavailable' } as any),
        },
      });
    }

    return { ...trip, tracking: { sse: `/v1/trips/${trip.id}/events` } };
  }

  // TODO(ModuleA-CQRS): Get operation moved to trip-query-service
  // This method is kept for internal use (e.g., accept() needs to read trip)
  async get(tripId: string) {
    // Direct DB query without cache (command service doesn't need cache)
    const t = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!t) throw new NotFoundException();
    return t;
  }

  // TODO(ModuleA-CQRS): Cache invalidation moved to query service
  // In production, could publish event to invalidate cache in query service
  private async invalidateCache(tripId: string) {
    // No-op: Query service will handle cache invalidation via TTL or events
    this.logger.debug(`Cache invalidation for trip ${tripId} delegated to query service`);
  }

  // ---------------- Cancel ----------------
  async cancel(tripId: string, by: string, reason: CancelDto) {
    const t = await this.get(tripId);
    const TERMINAL: TripStatus[] = ['COMPLETED', 'CANCELED'];
    if (TERMINAL.includes(t.status)) throw new BadRequestException('INVALID_STATE');

    const up = await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        status: 'CANCELED' as TripStatus,
        canceledAt: new Date(),
        cancelReasonCode: reason.reasonCode,
      },
    });

    emitEvent(tripId, 'STATUS_CHANGED', { status: up.status });

    await this.prisma.tripEvent.create({
      data: {
        tripId,
        type: 'Canceled',
        payload: ({ by, ...reason } as any),
      },
    });

    // Invalidate cache after update
    await this.invalidateCache(tripId);

    return { success: true };
  }

  // ---------------- Rate ----------------
  async rate(tripId: string, raterId: string, body: RateDto) {
    const t = await this.get(tripId);
    if (t.status !== 'COMPLETED') throw new BadRequestException('NOT_COMPLETED');

    await this.prisma.tripRating.upsert({
      where: { tripId },
      create: {
        tripId,
        raterId,
        driverId: t.driverId ?? '',
        stars: body.stars,
        comment: body.comment ?? null,
      },
      update: { stars: body.stars, comment: body.comment ?? null },
    });

    await this.prisma.tripEvent.create({
      data: {
        tripId,
        type: 'Rated',
        payload: ({ stars: body.stars } as any),
      },
    });
    return { ok: true };
  }

  // ---------------- Accept / Decline ----------------
  async accept(tripId: string, driverId: string) {
    const t = await this.get(tripId);
    const CAN_ACCEPT: TripStatus[] = ['DRIVER_SEARCHING', 'DRIVER_ASSIGNED'];
    if (!CAN_ACCEPT.includes(t.status)) throw new BadRequestException('INVALID_STATE');

    this.logger.log(`Driver ${driverId} attempting to claim trip ${tripId}`);
    
    const res = await firstValueFrom(
      this.driver.ClaimTrip({ trip_id: tripId, driver_id: driverId }).pipe(
        catchError((err) => {
          this.logger.warn(`Driver ClaimTrip failed: ${err?.message || err}`);
          return of({ status: 'DECLINED' });
        }),
      ),
    );

    if (res.status !== 'ACCEPTED') {
      this.logger.warn(`Trip ${tripId} claim rejected: ${res.status}`);
      await this.prisma.tripAssignment.updateMany({
        where: { tripId, driverId },
        data: { state: 'DECLINED', respondedAt: new Date() },
      });
      await this.prisma.tripEvent.create({
        data: {
          tripId,
          type: 'DriverDeclined',
          payload: ({ driverId, reason: res.status } as any),
        },
      });
      return { ok: false, reason: res.status || 'CLAIM_REJECTED' };
    }

    this.logger.log(`Trip ${tripId} successfully claimed by driver ${driverId}`);
    
    await this.prisma.tripAssignment.updateMany({
      where: { tripId, driverId },
      data: { state: 'CLAIMED', respondedAt: new Date() },
    });

    const up = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: 'EN_ROUTE_TO_PICKUP' as TripStatus, driverId },
    });

    emitEvent(tripId, 'STATUS_CHANGED', { status: up.status, driverId });

    await this.prisma.tripEvent.create({
      data: {
        tripId,
        type: 'DriverAccepted',
        payload: ({ driverId } as any),
      },
    });

    // Invalidate cache after update
    await this.invalidateCache(tripId);

    return { ok: true };
  }

  async decline(tripId: string, driverId: string) {
    await this.get(tripId);

    await this.prisma.tripAssignment.updateMany({
      where: { tripId, driverId },
      data: { state: 'DECLINED', respondedAt: new Date() },
    });

    await this.prisma.tripEvent.create({
      data: {
        tripId,
        type: 'DriverDeclined',
        payload: ({ driverId } as any),
      },
    });

    return { ok: true };
  }

  // ---------------- Status bumps ----------------
  async arrive(tripId: string) {
    return this.bump(tripId, 'ARRIVED' as TripStatus, 'Arrived');
  }

  async start(tripId: string) {
    return this.bump(tripId, 'IN_TRIP' as TripStatus, 'Started');
  }

  async finish(tripId: string, body: FinishDto) {
    const t = await this.get(tripId);
    if (t.status !== 'IN_TRIP') throw new BadRequestException('INVALID_STATE');

    const final = Math.max(10000, t.quoteFareTotal ?? 0);
    const up = await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        status: 'COMPLETED' as TripStatus,
        actualDistanceKm: body.actualDistanceKm,
        actualDurationMin: body.actualDurationMin,
        finalFareTotal: final,
      },
    });

    emitEvent(tripId, 'STATUS_CHANGED', { status: up.status, finalFareTotal: final });

    await this.prisma.tripEvent.create({
      data: { tripId, type: 'Completed', payload: ({ ...body } as any) },
    });

    // Invalidate cache after completion
    await this.invalidateCache(tripId);

    return { finalFareTotal: final, ok: true };
  }

  private async bump(tripId: string, st: TripStatus, evt: string) {
    await this.get(tripId);

    const up = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: st },
    });

    emitEvent(tripId, 'STATUS_CHANGED', { status: up.status });

    await this.prisma.tripEvent.create({
      data: { tripId, type: evt, payload: ({} as any) },
    });

    // Invalidate cache after status update
    await this.invalidateCache(tripId);

    return { ok: true };
  }

  // ---------------- Util ----------------
  private haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const toRad = (x: number) => (x * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(s));
  }
}
