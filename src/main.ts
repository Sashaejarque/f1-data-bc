import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { OpenF1Module } from './openf1/openf1.module';

async function bootstrap() {
  const app = await NestFactory.create(OpenF1Module);
  app.setGlobalPrefix('api');
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`OpenF1 service running at http://localhost:${port}/api/openf1`);
}

bootstrap();
