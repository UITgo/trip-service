# UITGo Trip Query Service

Service xử lý các thao tác **read** (đọc) cho Trip domain, áp dụng pattern **CQRS** (Command Query Responsibility Segregation) với **Redis caching** để tối ưu performance.

## Tổng quan

Trip Query Service chịu trách nhiệm:
- **Trip Retrieval**: Lấy trip details và trip history
- **Redis Caching**: Cache trip data để giảm database load
- **Read Optimization**: Optimize cho read-heavy scenarios

## Kiến trúc CQRS

Trip service được tách thành 2 services:

1. **trip-command-service** (Write side):
   - Xử lý tất cả write operations (POST, PUT, DELETE)
   - Sử dụng `PRIMARY_DB_URL`

2. **trip-query-service** (Read side):
   - Xử lý tất cả read operations (GET)
   - Sử dụng `READ_DB_URL` (read replica trong production)
   - Có Redis cache cho read-heavy paths

## Endpoints

- `GET /trips/:tripId` - Lấy trip details
  - Returns: Trip object
  - **Cache Strategy**:
    1. Check Redis cache với key `trip:{tripId}`
    2. Nếu cache hit, return cached data
    3. Nếu cache miss, query PostgreSQL
    4. Store trong cache với TTL 60s
    5. Return trip data

- `GET /trips/users/:userId/trips` - Lấy trip history của user
  - Query params:
    - `status?`: Filter theo status (REQUESTED, ACCEPTED, IN_PROGRESS, COMPLETED, CANCELLED)
    - `limit?`: Số lượng trips (default: 20)
    - `offset?`: Pagination offset (default: 0)
  - Returns: Array of trips
  - **Note**: Trip history không được cache (do thay đổi thường xuyên)

## Redis Cache Strategy

### Cache Key Format

- **Trip Details**: `trip:{tripId}`
  - TTL: 60 seconds
  - Value: JSON string của trip object

### Cache Flow

```
Request → Check Redis → Cache Hit? → Return cached data
                    ↓
                Cache Miss
                    ↓
            Query PostgreSQL
                    ↓
            Store in Redis (TTL 60s)
                    ↓
            Return trip data
```

### Cache Invalidation

Hiện tại cache tự động expire sau 60s. Trong tương lai có thể implement cache invalidation:
- Khi trip được update (từ trip-command-service), publish event lên Kafka
- trip-query-service consume event và invalidate cache

## Database Schema

Trip model (Prisma) - giống với trip-command-service:
```prisma
model Trip {
  id          String     @id @default(uuid())
  passengerId String
  driverId    String?
  originLat    Float
  originLng   Float
  destLat      Float
  destLng     Float
  note         String?
  cityCode     String?
  status       TripStatus
  fare         Float?
  rating       Int?
  comment      String?
  createdAt    DateTime
  updatedAt    DateTime
}
```

## Environment Variables

```bash
PORT=3003
NODE_ENV=production

# Database (READ replica for reads)
READ_DB_URL=postgresql://uitgo:uitgo@postgres:5432/tripdb?schema=public
DATABASE_URL=postgresql://uitgo:uitgo@postgres:5432/tripdb?schema=public  # Fallback

# Redis (for caching)
REDIS_URL=redis://redis:6379/0
```

## Development

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run migrations (if needed)
npx prisma migrate dev

# Run in development mode
npm run start:dev

# Build
npm run build

# Run in production mode
npm run start:prod
```

## Docker

```bash
# Build image
docker build -t uitgo-trip-query .

# Run container
docker run -p 3003:3003 \
  -e READ_DB_URL=postgresql://uitgo:uitgo@postgres:5432/tripdb \
  -e REDIS_URL=redis://redis:6379/0 \
  uitgo-trip-query
```

## Health Check

- `GET /healthz` - Health check endpoint
  - Returns: `{ status: "ok" }`
  - Checks: PostgreSQL connection, Redis connection

## Cache Performance

### Before Cache (k6 test results)
- p95 latency: ~200ms
- Database queries: High load

### After Cache (k6 test results)
- p95 latency: ~50ms (4x improvement)
- Database queries: Reduced by ~80%
- Cache hit rate: ~70-80% (depends on TTL and access patterns)

## Error Handling

- **404 Not Found**: Trip không tồn tại
- **500 Internal Server Error**: Database error, Redis error

## CQRS Benefits

1. **Independent Scaling**: Read operations có thể scale độc lập với write operations
2. **Read Replica**: Có thể sử dụng read replica database để offload reads từ primary
3. **Cache Strategy**: Có thể cache aggressively mà không ảnh hưởng write consistency
4. **Performance**: Read-heavy operations được optimize riêng

## Future Improvements

1. **Cache Warming**: Pre-load popular trips vào cache
2. **Cache Invalidation**: Implement event-driven cache invalidation
3. **Read Replica**: Tách read replica database cho production
4. **Cache Metrics**: Monitor cache hit rate, latency improvements
5. **Multi-level Cache**: Có thể thêm in-memory cache (L1) + Redis (L2)

## Monitoring

Cần monitor:
- **Cache Hit Rate**: Tỷ lệ cache hit vs miss
- **Latency**: p50, p95, p99 latency cho read operations
- **Database Load**: Query count, connection pool usage
- **Redis Usage**: Memory usage, connection count

## Xem thêm

- **Kiến trúc tổng thể**: Xem [`../../architecture/README.md`](../../architecture/README.md) để hiểu toàn bộ hệ thống UITGo
- **ARCHITECTURE.md**: [`../../architecture/ARCHITECTURE.md`](../../architecture/ARCHITECTURE.md) - Kiến trúc chi tiết
- **REPORT.md**: [`../../architecture/REPORT.md`](../../architecture/REPORT.md) - Báo cáo Module A
