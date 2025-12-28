import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OpenF1Service } from './openf1.service';
import { OpenF1Controller } from './openf1.controller';

@Module({
  imports: [HttpModule],
  controllers: [OpenF1Controller],
  providers: [OpenF1Service],
  exports: [OpenF1Service],
})
export class OpenF1Module {}
