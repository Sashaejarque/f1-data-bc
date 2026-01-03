import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { OpenF1Module } from './openf1/openf1.module';
import express from 'express';

const expressApp = express();

let app: any;

const bootstrap = async () => {
  if (!app) {
    app = await NestFactory.create(OpenF1Module, new ExpressAdapter(expressApp));
    app.setGlobalPrefix('api');

    // Configure CORS (same as main.ts)
    const frontendUrl = process.env.FRONTEND_URL;
    const corsOptions = {
      origin: frontendUrl,
      methods: ['GET', 'POST'],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization'],
    };
    app.enableCors(corsOptions);

    // Setup Swagger documentation
    const config = new DocumentBuilder()
      .setTitle('OpenF1 Service')
      .setDescription('API proxy/orchestrator for OpenF1 public data')
      .setVersion('1.0.0')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);

    await app.init();
  }
  return app;
};

export default async function handler(req: any, res: any) {
  await bootstrap();
  expressApp(req, res);
}
