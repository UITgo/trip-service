import { Controller, Get } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

@Controller('v1/health')
export class HealthController {
  @Get() async ok() {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, service: 'trip-service' };
  }
}
