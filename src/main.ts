import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { OpenF1Module } from './openf1/openf1.module';

async function bootstrap() {
  const app = await NestFactory.create(OpenF1Module);
  app.setGlobalPrefix('api');

  // Configure CORS
  const frontendUrl = process.env.FRONTEND_URL;
  const corsOptions = {
    origin: frontendUrl || '*', // Allow all in dev if not specified, restrict to FRONTEND_URL in prod
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
  app.enableCors(corsOptions);

  const config = new DocumentBuilder()
    .setTitle('OpenF1 Service')
    .setDescription('API proxy/orchestrator for OpenF1 public data')
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`OpenF1 service running at http://localhost:${port}/api/openf1`);
  console.log(`Swagger docs available at http://localhost:${port}/api/docs`);
  if (frontendUrl) {
    // eslint-disable-next-line no-console
    console.log(`CORS restricted to: ${frontendUrl}`);
  }
}

bootstrap();
