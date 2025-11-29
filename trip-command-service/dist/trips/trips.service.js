"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var TripsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TripsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const config_1 = require("@nestjs/config");
const sse_controller_1 = require("./sse.controller");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
let TripsService = TripsService_1 = class TripsService {
    cfg;
    userClient;
    driverClient;
    logger = new common_1.Logger(TripsService_1.name);
    prisma;
    user;
    driver;
    constructor(cfg, userClient, driverClient) {
        this.cfg = cfg;
        this.userClient = userClient;
        this.driverClient = driverClient;
        const primaryDbUrl = this.cfg.get('PRIMARY_DB_URL') || this.cfg.get('DATABASE_URL') || 'postgresql://uitgo:uitgo@postgres:5432/tripdb?schema=public';
        this.prisma = new client_1.PrismaClient({
            datasources: {
                db: {
                    url: primaryDbUrl,
                },
            },
        });
    }
    onModuleInit() {
        this.user = this.userClient.getService('UserService');
        this.driver = this.driverClient.getService('DriverService');
    }
    async quote(dto) {
        if (!dto?.origin || !dto?.destination) {
            throw new common_1.BadRequestException('origin & destination are required');
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
    async create(passengerId, dto) {
        if (!dto?.origin || !dto?.destination) {
            throw new common_1.BadRequestException('origin & destination are required');
        }
        const prof = await (0, rxjs_1.firstValueFrom)(this.user
            .GetProfile({ user_id: passengerId })
            .pipe((0, operators_1.catchError)((err) => {
            this.logger.warn(`UserService.GetProfile error for ${passengerId}: ${err?.message || err}`);
            return (0, rxjs_1.of)({
                exists: false,
                user_id: passengerId,
                name: '',
                avatar_url: '',
                role: '',
            });
        })));
        if (!prof.exists) {
            throw new common_1.BadRequestException('User not found');
        }
        if (prof.role !== 'PASSENGER') {
            throw new common_1.ForbiddenException('Only passengers can create trips');
        }
        const q = await this.quote({
            origin: dto.origin,
            destination: dto.destination,
            serviceType: 'bike',
        });
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
                    status: 'DRIVER_SEARCHING',
                    quoteDistanceKm: q.distanceKm,
                    quoteDurationMin: q.durationMin,
                    quoteFareTotal: q.fare.total,
                },
            });
        }
        catch (e) {
            this.logger.error('Prisma create trip failed', e);
            throw new common_1.InternalServerErrorException('cannot create trip');
        }
        (0, sse_controller_1.emitEvent)(trip.id, 'TRIP_CREATED', { id: trip.id, status: trip.status });
        try {
            this.logger.log(`Finding nearby drivers for trip ${trip.id} at (${dto.origin.lat}, ${dto.origin.lng})`);
            const nearby = await (0, rxjs_1.firstValueFrom)(this.driver
                .GetNearbyDrivers({
                location: { lat: dto.origin.lat, lng: dto.origin.lng },
                radius: 3000,
                limit: 20,
            })
                .pipe((0, operators_1.catchError)((err) => {
                this.logger.warn(`Driver GetNearbyDrivers failed: ${err?.message || err}`);
                return (0, rxjs_1.of)({ drivers: [] });
            })));
            const candidates = (nearby?.drivers ?? []).map((d) => d.driver_id);
            this.logger.log(`Found ${candidates.length} nearby drivers for trip ${trip.id}`);
            if (candidates.length) {
                await (0, rxjs_1.firstValueFrom)(this.driver
                    .PrepareAssign({
                    trip_id: trip.id,
                    candidate_ids: candidates,
                    ttl_seconds: 15,
                })
                    .pipe((0, operators_1.catchError)((err) => {
                    this.logger.warn(`Driver PrepareAssign failed: ${err?.message || err}`);
                    return (0, rxjs_1.of)({ queued: false });
                })));
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
                        payload: { candidates },
                    },
                });
            }
            else {
                this.logger.warn(`No nearby drivers found for trip ${trip.id}`);
            }
        }
        catch (e) {
            this.logger.error(`Driver search error for trip ${trip.id}:`, e);
            await this.prisma.tripEvent.create({
                data: {
                    tripId: trip.id,
                    type: 'DriverSearchError',
                    payload: { message: 'driver-stream unavailable' },
                },
            });
        }
        return { ...trip, tracking: { sse: `/v1/trips/${trip.id}/events` } };
    }
    async get(tripId) {
        const t = await this.prisma.trip.findUnique({ where: { id: tripId } });
        if (!t)
            throw new common_1.NotFoundException();
        return t;
    }
    async invalidateCache(tripId) {
        this.logger.debug(`Cache invalidation for trip ${tripId} delegated to query service`);
    }
    async cancel(tripId, by, reason) {
        const t = await this.get(tripId);
        const TERMINAL = ['COMPLETED', 'CANCELED'];
        if (TERMINAL.includes(t.status))
            throw new common_1.BadRequestException('INVALID_STATE');
        const up = await this.prisma.trip.update({
            where: { id: tripId },
            data: {
                status: 'CANCELED',
                canceledAt: new Date(),
                cancelReasonCode: reason.reasonCode,
            },
        });
        (0, sse_controller_1.emitEvent)(tripId, 'STATUS_CHANGED', { status: up.status });
        await this.prisma.tripEvent.create({
            data: {
                tripId,
                type: 'Canceled',
                payload: { by, ...reason },
            },
        });
        await this.invalidateCache(tripId);
        return { success: true };
    }
    async rate(tripId, raterId, body) {
        const t = await this.get(tripId);
        if (t.status !== 'COMPLETED')
            throw new common_1.BadRequestException('NOT_COMPLETED');
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
                payload: { stars: body.stars },
            },
        });
        return { ok: true };
    }
    async accept(tripId, driverId) {
        const t = await this.get(tripId);
        const CAN_ACCEPT = ['DRIVER_SEARCHING', 'DRIVER_ASSIGNED'];
        if (!CAN_ACCEPT.includes(t.status))
            throw new common_1.BadRequestException('INVALID_STATE');
        this.logger.log(`Driver ${driverId} attempting to claim trip ${tripId}`);
        const res = await (0, rxjs_1.firstValueFrom)(this.driver.ClaimTrip({ trip_id: tripId, driver_id: driverId }).pipe((0, operators_1.catchError)((err) => {
            this.logger.warn(`Driver ClaimTrip failed: ${err?.message || err}`);
            return (0, rxjs_1.of)({ status: 'DECLINED' });
        })));
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
                    payload: { driverId, reason: res.status },
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
            data: { status: 'EN_ROUTE_TO_PICKUP', driverId },
        });
        (0, sse_controller_1.emitEvent)(tripId, 'STATUS_CHANGED', { status: up.status, driverId });
        await this.prisma.tripEvent.create({
            data: {
                tripId,
                type: 'DriverAccepted',
                payload: { driverId },
            },
        });
        await this.invalidateCache(tripId);
        return { ok: true };
    }
    async decline(tripId, driverId) {
        await this.get(tripId);
        await this.prisma.tripAssignment.updateMany({
            where: { tripId, driverId },
            data: { state: 'DECLINED', respondedAt: new Date() },
        });
        await this.prisma.tripEvent.create({
            data: {
                tripId,
                type: 'DriverDeclined',
                payload: { driverId },
            },
        });
        return { ok: true };
    }
    async arrive(tripId) {
        return this.bump(tripId, 'ARRIVED', 'Arrived');
    }
    async start(tripId) {
        return this.bump(tripId, 'IN_TRIP', 'Started');
    }
    async finish(tripId, body) {
        const t = await this.get(tripId);
        if (t.status !== 'IN_TRIP')
            throw new common_1.BadRequestException('INVALID_STATE');
        const final = Math.max(10000, t.quoteFareTotal ?? 0);
        const up = await this.prisma.trip.update({
            where: { id: tripId },
            data: {
                status: 'COMPLETED',
                actualDistanceKm: body.actualDistanceKm,
                actualDurationMin: body.actualDurationMin,
                finalFareTotal: final,
            },
        });
        (0, sse_controller_1.emitEvent)(tripId, 'STATUS_CHANGED', { status: up.status, finalFareTotal: final });
        await this.prisma.tripEvent.create({
            data: { tripId, type: 'Completed', payload: { ...body } },
        });
        await this.invalidateCache(tripId);
        return { finalFareTotal: final, ok: true };
    }
    async bump(tripId, st, evt) {
        await this.get(tripId);
        const up = await this.prisma.trip.update({
            where: { id: tripId },
            data: { status: st },
        });
        (0, sse_controller_1.emitEvent)(tripId, 'STATUS_CHANGED', { status: up.status });
        await this.prisma.tripEvent.create({
            data: { tripId, type: evt, payload: {} },
        });
        await this.invalidateCache(tripId);
        return { ok: true };
    }
    haversine(a, b) {
        const toRad = (x) => (x * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(b.lat - a.lat);
        const dLng = toRad(b.lng - a.lng);
        const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.asin(Math.sqrt(s));
    }
};
exports.TripsService = TripsService;
exports.TripsService = TripsService = TripsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)('USER_GRPC')),
    __param(2, (0, common_1.Inject)('DRIVER_GRPC')),
    __metadata("design:paramtypes", [config_1.ConfigService, Object, Object])
], TripsService);
//# sourceMappingURL=trips.service.js.map