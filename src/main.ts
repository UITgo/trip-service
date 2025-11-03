import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  const cfg = app.get(ConfigService);
  const port = cfg.get('PORT') ?? 3003;
  await app.listen(port);
  console.log(`[trip-service] listening on :${port}`);
  
}
bootstrap();

