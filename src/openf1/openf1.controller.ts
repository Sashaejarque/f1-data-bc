import { Controller, Get, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags, ApiParam, ApiOkResponse } from '@nestjs/swagger';
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
  @ApiOkResponse({
    description: 'Race telemetry response. Note: keys with null values are omitted.',
    schema: {
      type: 'object',
      properties: {
        raceSummary: {
          type: 'object',
          properties: {
            totalLaps: { type: 'number' },
            totalPitStops: { type: 'number' },
            compoundsUsed: { type: 'array', items: { type: 'string' } },
          },
          required: ['totalLaps', 'totalPitStops', 'compoundsUsed'],
        },
        pitStops: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              lapNumber: { type: 'number' },
              duration: { type: 'number', nullable: true },
              totalDuration: { type: 'number', nullable: true },
            },
            required: ['lapNumber'],
          },
        },
        telemetry: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              lapNumber: { type: 'number' },
              lapDuration: { type: 'number', nullable: true },
              sector1: { type: 'number', nullable: true },
              sector2: { type: 'number', nullable: true },
              sector3: { type: 'number', nullable: true },
              tireCompound: { type: 'string', nullable: true },
              weather: {
                type: 'object',
                nullable: true,
                properties: {
                  date: { type: 'string', format: 'date-time' },
                  airTemperature: { type: 'number', nullable: true },
                  trackTemperature: { type: 'number', nullable: true },
                  humidity: { type: 'number', nullable: true },
                  windSpeed: { type: 'number', nullable: true },
                  isRaining: { type: 'boolean', nullable: true },
                },
                required: ['date'],
              },
            },
            required: ['lapNumber'],
          },
        },
      },
      required: ['raceSummary', 'pitStops', 'telemetry'],
      example: {
        raceSummary: { totalLaps: 58, totalPitStops: 1, compoundsUsed: ['MEDIUM', 'HARD'] },
        pitStops: [{ lapNumber: 23, duration: 21.7 }],
        telemetry: [
          { lapNumber: 1, sector2: 38.489, sector3: 32.363, tireCompound: 'MEDIUM' },
          {
            lapNumber: 2,
            lapDuration: 89.117,
            sector1: 18.085,
            sector2: 38.383,
            sector3: 32.649,
            tireCompound: 'MEDIUM',
            weather: {
              date: '2025-12-07T13:05:07.487Z',
              airTemperature: 26.8,
              trackTemperature: 31.4,
              humidity: 60,
              windSpeed: 2.3,
              isRaining: false,
            },
          },
        ],
      },
    },
  })
  async getRaceTelemetry(
    @Query('sessionKey', ParseIntPipe) sessionKey: number,
    @Query('driverNumber', ParseIntPipe) driverNumber: number,
  ): Promise<RaceTelemetry> {
    return this.openf1.getRaceTelemetry(sessionKey, driverNumber);
  }
}
