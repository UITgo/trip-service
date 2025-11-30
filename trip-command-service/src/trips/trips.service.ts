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
import { getDriverStreamUrl } from '../config/region-shard.config';
import { Http } from '../common/http';

import { Observable, of, firstValueFrom } from 'rxjs';
import { catchError } from 'rxjs/operators';

// Prisma enum alias (type-only)
type TripStatus =
  | 'REQUESTED'
  | 'DRIVER_SEARCHING'
  | 'NO_DRIVER_AVAILABLE'
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
  async create(passengerId: string, userRole: string, dto: CreateTripDto) {
    if (!dto?.origin || !dto?.destination) {
      throw new BadRequestException('origin & destination are required');
    }

    // 1) Try to get user profile from user-service, but gracefully fallback to JWT claims
    let userProfile: {
      exists: boolean;
      user_id: string;
      name: string;
      avatar_url: string;
      role: 'PASSENGER' | 'DRIVER' | '';
    } | null = null;

    try {
      userProfile = await firstValueFrom(
        this.user.GetProfile({ user_id: passengerId }).pipe(
          catchError((err) => {
            this.logger.warn(
              `[TripsService] UserService.GetProfile error for ${passengerId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            // Return null to indicate fallback needed
            return of(null);
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `[TripsService] UserService.GetProfile exception for ${passengerId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Continue with JWT claims fallback
    }

    // 2) Validate role: use user-service response if available, otherwise fallback to JWT claims
    let validatedRole: 'PASSENGER' | 'DRIVER' | '' = '';
    
    if (userProfile && userProfile.exists) {
      // User-service responded successfully
      validatedRole = userProfile.role;
      this.logger.debug(
        `[TripsService] User profile from user-service: role=${validatedRole} for ${passengerId}`,
      );
    } else {
      // Fallback to JWT claims (from gateway)
      validatedRole = (userRole as 'PASSENGER' | 'DRIVER' | '') || '';
      this.logger.warn(
        `[TripsService] Using JWT role claim as fallback: role=${validatedRole} for ${passengerId}`,
      );
    }

    // 3) Authorization check: only fail if role is explicitly not allowed
    if (validatedRole === 'DRIVER') {
      throw new ForbiddenException('Only passengers can create trips');
    }
    
    // If role is empty/missing and user-service is unreachable, we trust the gateway JWT
    // (gateway already verified the JWT, so if it reached here, user is authenticated)
    if (!validatedRole && !passengerId) {
      // This should not happen if gateway is working correctly, but be defensive
      throw new BadRequestException('User ID is required');
    }

    // 2) tính quote
    const q = await this.quote({
      origin: dto.origin,
      destination: dto.destination,
      serviceType: 'bike',
    });

    // TODO(ModuleA-Shard): Determine city_code from request or infer from lat/lng
    // For MVP: use city_code from request body, or default to "HCM" for demo
    const cityCode = dto.cityCode || 'HCM'; // Default to HCM for local demo

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
          cityCode, // TODO(ModuleA-Shard): Store city_code for sharding
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

    // 4) TODO(ModuleA-Shard): Find nearby drivers via HTTP to region-specific driver-stream shard
    try {
      // Get driver-stream base URL for this city/region
      const driverStreamBaseUrl = getDriverStreamUrl(trip.cityCode);
      this.logger.log(
        `Finding nearby drivers for trip ${trip.id} at (${dto.origin.lat}, ${dto.origin.lng}) via shard ${trip.cityCode} (${driverStreamBaseUrl})`,
      );

      // Call GetNearbyDrivers via HTTP
      const nearbyResponse = await Http.get(
        `${driverStreamBaseUrl}/v1/drivers/nearby`,
        {
          params: {
            lat: dto.origin.lat,
            lng: dto.origin.lng,
            radius: 3000,
            limit: 20,
          },
        },
      ).catch((err) => {
        this.logger.warn(
          `Driver GetNearbyDrivers HTTP failed for shard ${trip.cityCode}: ${err?.message || err}`,
        );
        return { data: { drivers: [] } };
      });

      const drivers = nearbyResponse.data?.drivers || [];
      const candidates = drivers.map((d: any) => d.driverId || d.driver_id);
      this.logger.log(
        `Found ${candidates.length} nearby drivers for trip ${trip.id} from shard ${trip.cityCode}`,
      );

      if (candidates.length) {
        // Call PrepareAssign via HTTP
        await Http.post(`${driverStreamBaseUrl}/v1/assign/prepare`, {
          tripId: trip.id,
          candidates: candidates,
          ttlSeconds: 15,
        }).catch((err) => {
          this.logger.warn(
            `Driver PrepareAssign HTTP failed for shard ${trip.cityCode}: ${err?.message || err}`,
          );
        });

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
        // No nearby drivers found - update trip status to NO_DRIVER_AVAILABLE
        this.logger.warn(
          `No nearby drivers found for trip ${trip.id} from shard ${trip.cityCode}`,
        );
        
        // Update trip status to NO_DRIVER_AVAILABLE (business case, not an error)
        trip = await this.prisma.trip.update({
          where: { id: trip.id },
          data: { status: 'NO_DRIVER_AVAILABLE' as TripStatus },
        });

        await this.prisma.tripEvent.create({
          data: {
            tripId: trip.id,
            type: 'NoDriverAvailable',
            payload: ({ message: 'No nearby drivers found at trip creation' } as any),
          },
        });
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

    return {
      ...trip,
      cityCode: trip.cityCode, // TODO(ModuleA-Shard): Include city_code in response for debugging
      tracking: { sse: `/v1/trips/${trip.id}/events` },
    };
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
  async accept(tripId: string, driverId: string): Promise<{
    success: boolean;
    reason?: string;
    tripId?: string;
    status?: string;
    message?: string;
  }> {
    try {
      // 1) Find trip - handle not found gracefully
      let t;
      try {
        t = await this.get(tripId);
      } catch (err: any) {
        if (err?.status === 404 || err?.name === 'NotFoundException') {
          this.logger.warn(`DriverAccept: trip ${tripId} not found (driverId: ${driverId})`);
          return {
            success: false,
            reason: 'TRIP_NOT_FOUND',
            message: `Trip ${tripId} not found`,
          };
        }
        // Re-throw unexpected errors to be caught by outer try/catch
        throw err;
      }

      // 2) Validate trip state - handle invalid state gracefully
      const CAN_ACCEPT: TripStatus[] = ['DRIVER_SEARCHING', 'DRIVER_ASSIGNED'];
      if (!CAN_ACCEPT.includes(t.status)) {
        this.logger.warn(
          `DriverAccept: trip ${tripId} in invalid state ${t.status} (driverId: ${driverId}, oldStatus: ${t.status})`,
        );
        return {
          success: false,
          reason: 'INVALID_STATE',
          message: `Trip ${tripId} is in state ${t.status}, cannot be accepted`,
          tripId: tripId,
          status: t.status,
        };
      }

      this.logger.log(
        `DriverAccept: driver ${driverId} attempting to claim trip ${tripId} (currentStatus: ${t.status})`,
      );

      // 3) Call driver-stream to claim trip
      const driverStreamBaseUrl = getDriverStreamUrl(t.cityCode || 'HCM');
      this.logger.debug(
        `DriverAccept: claim trip ${tripId} via shard ${t.cityCode} (${driverStreamBaseUrl})`,
      );

      let claimStatus: string;
      try {
        const claimResponse = await Http.post(
          `${driverStreamBaseUrl}/v1/assign/claim`,
          {
            tripId: tripId,
            driverId: driverId,
          },
        );
        claimStatus = claimResponse.data?.status || 'ACCEPTED';
      } catch (err: any) {
        this.logger.warn(
          `DriverAccept: ClaimTrip HTTP failed for trip ${tripId} (shard ${t.cityCode}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        claimStatus = 'CLAIM_FAILED';
      }

      // 4) Handle claim rejection
      if (claimStatus !== 'ACCEPTED') {
        this.logger.warn(
          `DriverAccept: trip ${tripId} claim rejected by driver-stream (status: ${claimStatus}, driverId: ${driverId})`,
        );
        
        try {
          await this.prisma.tripAssignment.updateMany({
            where: { tripId, driverId },
            data: { state: 'DECLINED', respondedAt: new Date() },
          });
          await this.prisma.tripEvent.create({
            data: {
              tripId,
              type: 'DriverDeclined',
              payload: ({ driverId, reason: claimStatus } as any),
            },
          });
        } catch (dbErr: any) {
          this.logger.error(
            `DriverAccept: failed to update assignment/event for declined claim (tripId: ${tripId}): ${
              dbErr instanceof Error ? dbErr.message : String(dbErr)
            }`,
          );
        }

        return {
          success: false,
          reason: 'CLAIM_REJECTED',
          message: `Trip claim rejected: ${claimStatus}`,
          tripId: tripId,
        };
      }

      // 5) Happy path - successfully accept trip
      this.logger.log(
        `DriverAccept: trip ${tripId} successfully claimed by driver ${driverId} (oldStatus: ${t.status} -> newStatus: EN_ROUTE_TO_PICKUP)`,
      );

      try {
        // Update assignment
        await this.prisma.tripAssignment.updateMany({
          where: { tripId, driverId },
          data: { state: 'CLAIMED', respondedAt: new Date() },
        });

        // Update trip status
        const updatedTrip = await this.prisma.trip.update({
          where: { id: tripId },
          data: { status: 'EN_ROUTE_TO_PICKUP' as TripStatus, driverId },
        });

        // Emit SSE event
        emitEvent(tripId, 'STATUS_CHANGED', { status: updatedTrip.status, driverId });

        // Create event
        await this.prisma.tripEvent.create({
          data: {
            tripId,
            type: 'DriverAccepted',
            payload: ({ driverId } as any),
          },
        });

        // Invalidate cache (no-op but kept for consistency)
        await this.invalidateCache(tripId);

        return {
          success: true,
          tripId: tripId,
          status: updatedTrip.status,
        };
      } catch (dbErr: any) {
        this.logger.error(
          `DriverAccept: database error while accepting trip ${tripId} (driverId: ${driverId}): ${
            dbErr instanceof Error ? dbErr.message : String(dbErr)
          }`,
        );
        return {
          success: false,
          reason: 'INTERNAL_ERROR',
          message: 'Failed to update trip in database',
          tripId: tripId,
        };
      }
    } catch (err: any) {
      // Catch any unexpected errors and return graceful response
      this.logger.error(
        `DriverAccept: unexpected error for trip ${tripId} (driverId: ${driverId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      return {
        success: false,
        reason: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred while accepting trip',
        tripId: tripId,
      };
    }
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
