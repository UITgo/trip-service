import { OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { CancelDto, CreateTripDto, FinishDto, QuoteDto, RateDto } from './dto';
export declare class TripsService implements OnModuleInit {
    private cfg;
    private readonly userClient;
    private readonly driverClient;
    private readonly logger;
    prisma: PrismaClient;
    private user;
    private driver;
    constructor(cfg: ConfigService, userClient: ClientGrpc, driverClient: ClientGrpc);
    onModuleInit(): void;
    quote(dto: QuoteDto): Promise<{
        distanceKm: number;
        durationMin: number;
        etaPickupMin: number;
        fare: {
            base: number;
            distance: number;
            time: number;
            total: number;
        };
    }>;
    create(passengerId: string, dto: CreateTripDto): Promise<any>;
    get(tripId: string): Promise<{
        id: string;
        passengerId: string;
        driverId: string | null;
        originLat: number;
        originLng: number;
        destLat: number;
        destLng: number;
        note: string | null;
        status: import("@prisma/client").$Enums.TripStatus;
        quoteDistanceKm: number | null;
        quoteDurationMin: number | null;
        quoteFareTotal: number | null;
        actualDistanceKm: number | null;
        actualDurationMin: number | null;
        finalFareTotal: number | null;
        canceledAt: Date | null;
        cancelReasonCode: string | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    private invalidateCache;
    cancel(tripId: string, by: string, reason: CancelDto): Promise<{
        success: boolean;
    }>;
    rate(tripId: string, raterId: string, body: RateDto): Promise<{
        ok: boolean;
    }>;
    accept(tripId: string, driverId: string): Promise<{
        ok: boolean;
        reason: string;
    } | {
        ok: boolean;
        reason?: undefined;
    }>;
    decline(tripId: string, driverId: string): Promise<{
        ok: boolean;
    }>;
    arrive(tripId: string): Promise<{
        ok: boolean;
    }>;
    start(tripId: string): Promise<{
        ok: boolean;
    }>;
    finish(tripId: string, body: FinishDto): Promise<{
        finalFareTotal: number;
        ok: boolean;
    }>;
    private bump;
    private haversine;
}
