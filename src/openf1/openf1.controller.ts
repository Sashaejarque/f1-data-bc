import { Controller, Get, Param, Query, ParseIntPipe } from '@nestjs/common';
import { OpenF1Service } from './openf1.service';
import { DriverSummary, LastRaceResult, RaceTelemetry } from './openf1.interfaces';

@Controller('openf1')
export class OpenF1Controller {
  constructor(private readonly openf1: OpenF1Service) {}

  // GET /openf1/drivers
  @Get('drivers')
  async getActiveDrivers(): Promise<DriverSummary[]> {
    return this.openf1.getActiveDrivers();
  }

  // GET /openf1/drivers/:driverNumber/last-race
  @Get('drivers/:driverNumber/last-race')
  async getLastRaceResult(
    @Param('driverNumber', ParseIntPipe) driverNumber: number,
  ): Promise<LastRaceResult> {
    return this.openf1.getLastRaceResult(driverNumber);
  }

  // GET /openf1/telemetry?sessionKey=###&driverNumber=###
  @Get('telemetry')
  async getRaceTelemetry(
    @Query('sessionKey', ParseIntPipe) sessionKey: number,
    @Query('driverNumber', ParseIntPipe) driverNumber: number,
  ): Promise<RaceTelemetry> {
    return this.openf1.getRaceTelemetry(sessionKey, driverNumber);
  }
}
