import { Controller, Get, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags, ApiParam, ApiOkResponse, ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OpenF1Service } from './openf1.service';
import { DriverSummary, LastRaceResult, RaceTelemetry, RaceAnalysis } from './openf1.interfaces';

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

  // GET /openf1/telemetry/:sessionKey/:driverNumber/analysis
  @Throttle({ default: { limit: 3, ttl: 60 } })
  @Get('telemetry/:sessionKey/:driverNumber/analysis')
  @ApiOperation({
    summary: 'Get AI-powered race analysis',
    description: 'Fetches telemetry data and sends it to the AI service for comprehensive race analysis including strategy recommendations and performance insights.',
  })
  @ApiParam({ name: 'sessionKey', type: Number, description: 'Session key of the race' })
  @ApiParam({ name: 'driverNumber', type: Number, description: 'Driver number' })
  @ApiOkResponse({
    description: 'AI-generated race analysis with strategic insights and findings',
    schema: {
      type: 'object',
      properties: {
        summary: { 
          type: 'string', 
          description: 'Brief race summary and overall performance analysis' 
        },
        key_findings: {
          type: 'array',
          description: 'Array of key findings from the race analysis',
          items: {
            type: 'object',
            properties: {
              topic: { 
                type: 'string',
                description: 'Topic of the finding (e.g., tire degradation, pit strategy)' 
              },
              description: { 
                type: 'string',
                description: 'Detailed description of the finding' 
              },
              severity: { 
                type: 'string',
                enum: ['low', 'med', 'high'],
                description: 'Severity level of the finding' 
              },
            },
            required: ['topic', 'description', 'severity'],
          },
        },
        strategic_report: {
          type: 'object',
          description: 'Strategic recommendations for future races',
          properties: {
            race_narrative: { 
              type: 'string',
              description: 'Narrative summary of how the race unfolded' 
            },
            next_race_projections: { 
              type: 'string',
              description: 'Projections and recommendations for the next race' 
            },
          },
          required: ['race_narrative', 'next_race_projections'],
        },
      },
      required: ['summary', 'key_findings', 'strategic_report'],
      example: {
        summary: 'Sólido desempeño con gestión de neumáticos eficiente. 58 vueltas completadas con 1 parada de pits.',
        key_findings: [
          {
            topic: 'Degradación de neumáticos',
            description: 'Se observó degradación progresiva en stint de MEDIUM (vueltas 1-23)',
            severity: 'med',
          },
          {
            topic: 'Consistencia en sector 2',
            description: 'Sector 2 mostró variabilidad sin patrón claro de degradación',
            severity: 'low',
          },
        ],
        strategic_report: {
          race_narrative: 'El piloto mantuvo un ritmo consistente durante las primeras 23 vueltas con compuesto MEDIUM. La parada de pits fue oportuna, cambiando a HARD para gestionar el final de la carrera.',
          next_race_projections: 'Para la próxima carrera, considerar una estrategia de parada más temprana si las condiciones de pista son similares. El HARD podría ser más competitivo desde la vuelta 15-20.',
        },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description: 'AI analysis service is temporarily unavailable',
  })
  async getRaceAnalysis(
    @Param('sessionKey', ParseIntPipe) sessionKey: number,
    @Param('driverNumber', ParseIntPipe) driverNumber: number,
  ): Promise<RaceAnalysis> {
    return this.openf1.getRaceAnalysis(sessionKey, driverNumber);
  }
}
