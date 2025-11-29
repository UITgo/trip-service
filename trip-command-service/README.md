# UITGo Trip Command Service

Service xử lý các thao tác **write** (ghi) cho Trip domain, áp dụng pattern **CQRS** (Command Query Responsibility Segregation).

## Tổng quan

Trip Command Service chịu trách nhiệm:
- **Trip Creation**: Tạo trip mới, tính fare, tìm tài xế gần nhất
- **Trip State Management**: Accept, decline, cancel, start, finish trips
- **Driver Assignment**: Tích hợp với `driver-stream` để assign drivers
- **Region Sharding**: Route requests đến đúng `driver-stream` shard dựa trên `cityCode`

## Kiến trúc CQRS

Trip service được tách thành 2 services:

1. **trip-command-service** (Write side):
   - Xử lý tất cả write operations (POST, PUT, DELETE)
   - Sử dụng `PRIMARY_DB_URL` (PostgreSQL primary database)
   - Không có cache (write operations cần consistency)

2. **trip-query-service** (Read side):
   - Xử lý tất cả read operations (GET)
   - Sử dụng `READ_DB_URL` (PostgreSQL read replica)
   - Có Redis cache cho read-heavy paths

## Endpoints

### Trip Operations

- `POST /trips/quote` - Tính fare cho trip
  - Body: `{ origin: { lat, lng }, destination: { lat, lng } }`
  - Returns: `{ fare: number, distance: number, duration: number }`
  - Uses: OSRM để tính distance/duration

- `POST /trips` - Tạo trip mới
  - Headers: `X-User-Id` (passenger ID từ gateway)
  - Body: 
    ```json
    {
      "origin": { "lat": 10.762622, "lng": 106.660172 },
      "destination": { "lat": 10.7769, "lng": 106.7009 },
      "note": "Optional note",
      "cityCode": "HCM"  // Optional, defaults to "HCM"
    }
    ```
  - Returns: Trip object với status `DRIVER_SEARCHING`
  - Flow:
    1. Verify user role (PASSENGER) qua gRPC `GetProfile`
    2. Calculate fare với OSRM
    3. Create trip trong PostgreSQL với `cityCode`
    4. Find nearby drivers qua `driver-stream` (shard theo `cityCode`)
    5. Prepare assignment với candidates
    6. Return trip

- `POST /trips/:tripId/accept` - Driver accept trip
  - Headers: `X-User-Id` (driver ID), `X-User-Role` (must be DRIVER)
  - Returns: Trip với status `ACCEPTED`
  - Flow:
    1. Verify driver role
    2. Get trip từ database
    3. Claim trip qua `driver-stream` (shard theo trip's `cityCode`)
    4. Update trip status to `ACCEPTED`
    5. Return trip

- `POST /trips/:tripId/decline` - Driver decline trip
  - Headers: `X-User-Id` (driver ID)
  - Returns: `{ status: "DECLINED" }`
  - Flow: Update assignment state trong `driver-stream`

- `POST /trips/:tripId/cancel` - Cancel trip
  - Headers: `X-User-Id` (user ID)
  - Body: `{ reason?: string }`
  - Returns: Trip với status `CANCELLED`

- `POST /trips/:tripId/rate` - Rate trip
  - Headers: `X-User-Id` (user ID)
  - Body: `{ rating: number, comment?: string }`
  - Returns: Updated trip

- `POST /trips/:tripId/arrive-pickup` - Driver arrived at pickup
  - Returns: Trip với status `DRIVER_ARRIVED`

- `POST /trips/:tripId/start` - Start trip
  - Returns: Trip với status `IN_PROGRESS`

- `POST /trips/:tripId/finish` - Finish trip
  - Body: `{ finalFare?: number }`
  - Returns: Trip với status `COMPLETED`

## Region Sharding

Trip Command Service route requests đến đúng `driver-stream` shard dựa trên `cityCode`:

- **HCM** → `driver-stream-hcm:8080`
- **HN** → `driver-stream-hn:8080`
- **Default** → `driver-stream-hcm:8080` (nếu `cityCode` không được specify)

### Configuration

File: `src/config/region-shard.config.ts`

```typescript
export const REGION_SHARD_CONFIG = {
  HCM: {
    driverStreamBaseUrl: process.env.DRIVER_STREAM_HCM_URL || 'http://driver-stream-hcm:8080',
  },
  HN: {
    driverStreamBaseUrl: process.env.DRIVER_STREAM_HN_URL || 'http://driver-stream-hn:8080',
  },
};
```

### Usage

```typescript
// In create() method
const cityCode = dto.cityCode || 'HCM';
const driverStreamBaseUrl = getDriverStreamUrl(cityCode);

// Call driver-stream shard
const nearbyResponse = await Http.get(
  `${driverStreamBaseUrl}/v1/drivers/nearby`,
  { params: { lat, lng, radius: 3000, limit: 20 } }
);
```

## Database Schema

Trip model (Prisma):
```prisma
model Trip {
  id          String     @id @default(uuid())
  passengerId String
  driverId    String?
  originLat    Float
  originLng   Float
  destLat      Float
  destLng      Float
  note         String?
  cityCode     String?   // For sharding (HCM, HN, etc.)
  status       TripStatus @default(REQUESTED)
  fare         Float?
  rating       Int?
  comment      String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  
  @@index([cityCode, status])
}
```

## Environment Variables

```bash
PORT=3002
NODE_ENV=production

# Database (PRIMARY for writes)
PRIMARY_DB_URL=postgresql://uitgo:uitgo@postgres:5432/tripdb?schema=public
DATABASE_URL=postgresql://uitgo:uitgo@postgres:5432/tripdb?schema=public  # Fallback

# Driver Stream (Region Sharding)
DRIVER_STREAM_HCM_URL=http://driver-stream-hcm:8080
DRIVER_STREAM_HN_URL=http://driver-stream-hn:8080
DRIVER_STREAM_URL=driver-stream-hcm:50052  # Legacy gRPC, keep for compatibility

# gRPC Services
USER_GRPC_URL=user-service:50051

# OSRM
OSRM_BASE_URL=http://osrm:5000

# Kafka (for future event publishing)
KAFKA_BROKERS=kafka:9092
```

## Development

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run migrations
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
docker build -t uitgo-trip-command .

# Run container
docker run -p 3002:3002 \
  -e PRIMARY_DB_URL=postgresql://uitgo:uitgo@postgres:5432/tripdb \
  -e DRIVER_STREAM_HCM_URL=http://driver-stream-hcm:8080 \
  -e DRIVER_STREAM_HN_URL=http://driver-stream-hn:8080 \
  -e USER_GRPC_URL=user-service:50051 \
  -e OSRM_BASE_URL=http://osrm:5000 \
  -v $(pwd)/../proto:/app/proto:ro \
  uitgo-trip-command
```

## Health Check

- `GET /healthz` - Health check endpoint
  - Returns: `{ status: "ok" }`
  - Checks: PostgreSQL connection

## gRPC Integration

Trip Command Service sử dụng gRPC để gọi:
- **user-service**: `GetProfile` để verify user role

### Proto Definition

```protobuf
service UserService {
  rpc GetProfile(GetProfileRequest) returns (GetProfileResponse);
}
```

## Error Handling

- **400 Bad Request**: Invalid input, missing required fields
- **403 Forbidden**: User không có quyền (ví dụ: non-DRIVER gọi accept)
- **404 Not Found**: Trip không tồn tại
- **500 Internal Server Error**: Database error, service error

## Logging

Service logs các operations quan trọng:
- Trip creation với shard info: `Finding nearby drivers for trip ${tripId} via shard ${cityCode}`
- Trip acceptance với shard info: `Claim trip ${tripId} via shard ${cityCode}`

## CQRS Benefits

1. **Independent Scaling**: Read và write operations có thể scale độc lập
2. **Optimized Databases**: Read replica có thể optimize cho queries, primary optimize cho writes
3. **Cache Strategy**: Read side có thể cache aggressively, write side không cần cache
4. **Performance**: Read-heavy operations không ảnh hưởng write performance

## Future Improvements

1. **Event Publishing**: Publish trip events (created, accepted, completed) lên Kafka
2. **Saga Pattern**: Implement distributed transaction cho complex flows
3. **Idempotency**: Add idempotency keys để handle duplicate requests
4. **Read Replica**: Tách read replica database cho production

## Xem thêm

- **Kiến trúc tổng thể**: Xem [`../../architecture/README.md`](../../architecture/README.md) để hiểu toàn bộ hệ thống UITGo
- **ARCHITECTURE.md**: [`../../architecture/ARCHITECTURE.md`](../../architecture/ARCHITECTURE.md) - Kiến trúc chi tiết
- **REPORT.md**: [`../../architecture/REPORT.md`](../../architecture/REPORT.md) - Báo cáo Module A
