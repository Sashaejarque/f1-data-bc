import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { OpenF1Service } from './openf1.service';
import { OpenF1Controller } from './openf1.controller';

@Module({
  imports: [
    HttpModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
  ],
  controllers: [OpenF1Controller],
  providers: [OpenF1Service],
  exports: [OpenF1Service],
})
export class OpenF1Module {}
