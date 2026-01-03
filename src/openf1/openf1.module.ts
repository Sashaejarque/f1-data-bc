import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { OpenF1Service } from './openf1.service';
import { OpenF1Controller } from './openf1.controller';

@Module({
  imports: [
    HttpModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl: Number(configService.get('THROTTLE_TTL') ?? 60),
          limit: Number(configService.get('THROTTLE_LIMIT') ?? 10),
        },
      ],
    }),
  ],
  controllers: [OpenF1Controller],
  providers: [
    OpenF1Service,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
  exports: [OpenF1Service],
})
export class OpenF1Module {}
