import {
  Injectable,
  NotFoundException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../common/redis.service';

// TODO(ModuleA-CQRS): Query service only handles read operations
// Write operations are in trip-command-service

@Injectable()
export class TripsService implements OnModuleInit {
  private readonly logger = new Logger(TripsService.name);
  prisma: PrismaClient;

  constructor(
    private cfg: ConfigService,
    private redis: RedisService,
  ) {
    // TODO(ModuleA-CQRS): Use READ_DB_URL for reads (read replica in production)
    const readDbUrl = this.cfg.get<string>('READ_DB_URL') || this.cfg.get<string>('DATABASE_URL') || 'postgresql://uitgo:uitgo@postgres:5432/tripdb?schema=public';
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: readDbUrl,
        },
      },
    });
  }

  onModuleInit() {
    // Query service doesn't need gRPC clients
  }

  // ---------------- Get Trip by ID (with Redis cache) ----------------
  async getTripById(tripId: string) {
    const cacheKey = `trip:${tripId}`;
    
    // 1. Check Redis cache
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for trip ${tripId}`);
        return JSON.parse(cached);
      }
    } catch (err) {
      this.logger.warn(`Redis get error for ${cacheKey}:`, err);
      // Continue to DB query on cache error
    }

    // 2. Cache miss - query Postgres (read replica)
    const t = await this.prisma.trip.findUnique({ 
      where: { id: tripId },
      include: {
        rating: true,
        events: {
          orderBy: { at: 'desc' },
          take: 10, // Last 10 events
        },
      },
    });
    if (!t) throw new NotFoundException();

    // 3. Set cache with TTL 60 seconds
    try {
      await this.redis.set(cacheKey, JSON.stringify(t), 60);
      this.logger.debug(`Cache set for trip ${tripId}`);
    } catch (err) {
      this.logger.warn(`Redis set error for ${cacheKey}:`, err);
      // Don't fail the request if cache fails
    }

    return t;
  }

  // ---------------- Get User Trips ----------------
  async getUserTrips(
    userId: string,
    options: {
      status?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const { status, limit = 20, offset = 0 } = options;
    
    // TODO(ModuleA-CQRS): Could add cache for user trips list (e.g., user:${userId}:trips:${status})
    // For now, query directly from DB
    
    const where: any = {
      OR: [
        { passengerId: userId },
        { driverId: userId },
      ],
    };
    
    if (status) {
      where.status = status;
    }

    const [trips, total] = await Promise.all([
      this.prisma.trip.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          rating: true,
        },
      }),
      this.prisma.trip.count({ where }),
    ]);

    return {
      trips,
      total,
      limit,
      offset,
      hasMore: offset + trips.length < total,
    };
  }
}
