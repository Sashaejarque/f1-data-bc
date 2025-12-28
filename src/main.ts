import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { OpenF1Module } from './openf1/openf1.module';

async function bootstrap() {
  const app = await NestFactory.create(OpenF1Module);
  app.setGlobalPrefix('api');

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
}

bootstrap();
