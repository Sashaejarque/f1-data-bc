import { Controller, Get, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags, ApiParam } from '@nestjs/swagger';
import { OpenF1Service } from './openf1.service';
import { DriverSummary, LastRaceResult, RaceTelemetry } from './openf1.interfaces';

@Controller('openf1')
@ApiTags('openf1')
export class OpenF1Controller {
  constructor(private readonly openf1: OpenF1Service) {}

  // GET /openf1/drivers
  @Get('drivers')
  @ApiOperation({ summary: 'List active drivers (latest session)', description: 'Returns deduplicated drivers from OpenF1 /drivers?session_key=latest.' })
  async getActiveDrivers(): Promise<DriverSummary[]> {
    return this.openf1.getActiveDrivers();
  }

  // GET /openf1/drivers/:driverNumber/last-race
  @Get('drivers/:driverNumber/last-race')
  @ApiOperation({ summary: 'Get last race result for driver (2025)', description: 'Fetches latest 2025 race session and returns position/points using session_result with position fallback.' })
  @ApiParam({ name: 'driverNumber', type: Number, description: 'Driver number (e.g., 1 = Max Verstappen)' })
  async getLastRaceResult(
    @Param('driverNumber', ParseIntPipe) driverNumber: number,
  ): Promise<LastRaceResult> {
    return this.openf1.getLastRaceResult(driverNumber);
  }

  // GET /openf1/telemetry?sessionKey=###&driverNumber=###
  @Get('telemetry')
  @ApiOperation({ summary: 'Merged telemetry for a race session', description: 'Parallel fetch of laps, stints, pits, weather, merged per lap with compound, pit stop, and nearest weather.' })
  @ApiQuery({ name: 'sessionKey', type: Number, required: true })
  @ApiQuery({ name: 'driverNumber', type: Number, required: true })
  async getRaceTelemetry(
    @Query('sessionKey', ParseIntPipe) sessionKey: number,
    @Query('driverNumber', ParseIntPipe) driverNumber: number,
  ): Promise<RaceTelemetry> {
    return this.openf1.getRaceTelemetry(sessionKey, driverNumber);
  }
}
