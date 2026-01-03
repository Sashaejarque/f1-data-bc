import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import type { AxiosResponse } from 'axios';
import {
  DriverApiDTO,
  DriverSummary,
  SessionApiDTO,
  SessionResultApiDTO,
  PositionApiDTO,
  LapApiDTO,
  StintApiDTO,
  PitApiDTO,
  WeatherApiDTO,
  LastRaceResult,
  RaceTelemetry,
  RaceTelemetryLap,
  WeatherSnapshot,
  PitStopInfo,
  RaceAnalysis,
} from './openf1.interfaces';

const BASE_URL = 'https://api.openf1.org/v1';

function parseISO(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  return Number.isNaN(t) ? null : t;
}

function closestWeatherSnapshotMs(lapTs: number | null, weather: WeatherApiDTO[]): WeatherSnapshot | null {
  if (lapTs == null || weather.length === 0) return null;
  let best: WeatherApiDTO | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const w of weather) {
    const wt = parseISO(w.date);
    if (wt == null) continue;
    const diff = Math.abs(wt - lapTs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = w;
    }
  }
  if (!best) return null;
  return {
    date: best.date,
    airTemperature: best.air_temperature ?? null,
    trackTemperature: best.track_temperature ?? null,
    humidity: best.humidity ?? null,
    windSpeed: best.wind_speed ?? null,
    isRaining: (best.is_raining ?? null) ?? (best.rainfall != null ? best.rainfall > 0 : null),
  };
}

// Deeply remove properties with value === null from objects/arrays
function omitNullsDeep<T>(value: T): T {
  if (value === null) {
    // Callers should decide whether to keep parent key; returning undefined helps when spreading
    return value;
  }
  if (Array.isArray(value)) {
    return (value.map((v) => omitNullsDeep(v)) as unknown) as T;
  }
  if (typeof value === 'object') {
    const input = value as Record<string, any>;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v === null) continue; // omit nulls
      const cleaned = omitNullsDeep(v);
      // Always keep values that are not null after cleaning (including false/0/empty string/empty object)
      if (cleaned !== null) {
        out[k] = cleaned;
      }
    }
    return (out as unknown) as T;
  }
  return value;
}

@Injectable()
export class OpenF1Service {
  constructor(private readonly http: HttpService) {}

  private async get<T>(path: string, params?: Record<string, any>): Promise<T> {
    try {
      const obs = this.http.get<T>(`${BASE_URL}${path}`, { params });
      const res = await lastValueFrom(obs);
      return res.data as T;
    } catch (err: any) {
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY;
      const message = err?.response?.data ?? err?.message ?? 'OpenF1 request failed';
      throw new HttpException(
        {
          message: 'OpenF1 API error',
          details: message,
          path,
          params,
        },
        status,
      );
    }
  }

  // CASO DE USO 1: Maestro de Pilotos
  async getActiveDrivers(): Promise<DriverSummary[]> {
    const drivers = await this.get<DriverApiDTO[]>('/drivers', { session_key: 'latest' });

    const dedup = new Map<number, DriverApiDTO>();
    for (const d of drivers) {
      if (!dedup.has(d.driver_number)) {
        dedup.set(d.driver_number, d);
      }
    }

    return Array.from(dedup.values()).map((d) => ({
      driver_number: d.driver_number,
      full_name: d.full_name,
      team_name: d.team_name,
      team_colour: d.team_colour,
      headshot_url: d.headshot_url,
    }));
  }

  // CASO DE USO 2: Última Carrera del Piloto (hardcoded 2025)
  async getLastRaceResult(driverNumber: number): Promise<LastRaceResult> {
    const year = 2025; // hardcoded per requirement

    // Paso 1: obtener la sesión de carrera más reciente según el array devuelto
    const sessions = await this.get<SessionApiDTO[]>(
      '/sessions',
      { year, session_type: 'Race' },
    );

    if (!sessions || sessions.length === 0) {
      throw new HttpException(
        { message: `No race sessions found for ${year}` },
        HttpStatus.NOT_FOUND,
      );
    }

    // Se asume que la última posición del array es la carrera más reciente
    const latest = sessions[sessions.length - 1];
    const sessionKey = latest.session_key;

    // Paso 2: obtener resultado vía /session_result
    let position: number | null = null;
    let points: number | null = null;

    const sessionResults = await this.get<SessionResultApiDTO[]>(
      '/session_result',
      { session_key: sessionKey, driver_number: driverNumber },
    );

    const sr = sessionResults?.find((r) => r.driver_number === driverNumber);
    if (sr && (sr.position != null || sr.points != null)) {
      position = sr.position ?? null;
      points = sr.points ?? null;
    } else {
      // Fallback: /position (beta)
      const positions = await this.get<PositionApiDTO[]>(
        '/position',
        { session_key: sessionKey, driver_number: driverNumber },
      );
      if (positions && positions.length > 0) {
        const last = [...positions].sort((a, b) => {
          const aTs = parseISO(a.date) ?? 0;
          const bTs = parseISO(b.date) ?? 0;
          return aTs - bTs;
        }).at(-1)!;
        position = last.position ?? null;
        points = null; // points not available via /position
      }
    }

    return { session_key: sessionKey, position, points };
  }

  // CASO DE USO 3: Telemetría para Análisis (Data Merging)
  async getRaceTelemetry(sessionKey: number, driverNumber: number): Promise<RaceTelemetry> {
    try {
      const [laps, stints, pits, weather] = await Promise.all([
        this.get<LapApiDTO[]>('/laps', { session_key: sessionKey, driver_number: driverNumber }),
        this.get<StintApiDTO[]>('/stints', { session_key: sessionKey, driver_number: driverNumber }),
        this.get<PitApiDTO[]>('/pit', { session_key: sessionKey, driver_number: driverNumber }),
        this.get<WeatherApiDTO[]>('/weather', { session_key: sessionKey }),
      ]);

      const pitByLap = new Map<number, PitApiDTO>();
      for (const p of (pits ?? [])) {
        pitByLap.set(p.lap_number, p);
      }
      const pitStops = (pits ?? []).map((p): PitStopInfo => ({
        lapNumber: p.lap_number,
        duration: p.pit_duration ?? null,
        totalDuration: p.total_duration ?? null,
      }));

      const compounds = new Set<string>();
      let lastStartMs: number | null = null;

      const telemetry: RaceTelemetryLap[] = (laps ?? []).map((lap) => {
        const lapNo = lap.lap_number;
        // Match stint by lap number within [lap_start, lap_end]
        const stint = (stints ?? []).find((s) => lapNo >= s.lap_start && lapNo <= s.lap_end) ?? null;
        const compound = stint?.compound ?? null;
        if (compound) compounds.add(compound);

        const lapDuration = lap.lap_duration ?? lap.duration ?? null;
        const sector1 = lap.duration_sector_1 ?? lap.sector1 ?? null;
        const sector2 = lap.duration_sector_2 ?? lap.sector2 ?? null;
        const sector3 = lap.duration_sector_3 ?? lap.sector3 ?? null;

        const startMsFromApi = parseISO(lap.date_start);
        const inferredStartMs = startMsFromApi != null
          ? startMsFromApi
          : (lastStartMs != null && lapDuration != null ? lastStartMs + lapDuration * 1000 : null);

        if (inferredStartMs != null) {
          lastStartMs = inferredStartMs;
        }

        const weatherSnapshot = closestWeatherSnapshotMs(inferredStartMs, weather ?? []);

        return {
          lapNumber: lapNo,
          lapDuration,
          sector1,
          sector2,
          sector3,
          tireCompound: compound,
          weather: weatherSnapshot,
        };
      });

      const raceSummary = {
        totalLaps: telemetry.length,
        totalPitStops: (pits ?? []).length,
        compoundsUsed: Array.from(compounds.values()),
      };

      // Return without any null-valued keys to avoid confusing downstream AI
      const result = { raceSummary, pitStops, telemetry };
      return omitNullsDeep(result) as RaceTelemetry;
    } catch (err: any) {
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY;
      const message = err?.response?.data ?? err?.message ?? 'OpenF1 telemetry merge failed';
      throw new HttpException(
        { message: 'OpenF1 telemetry error', details: message, sessionKey, driverNumber },
        status,
      );
    }
  }

  // CASO DE USO 4: Análisis de Carrera con IA
  async getRaceAnalysis(sessionKey: number, driverNumber: number): Promise<RaceAnalysis> {
    const aiServiceUrl = process.env.AI_SERVICE_URL;
    const aiServiceSecret = process.env.AI_SERVICE_SECRET;

    if (!aiServiceUrl) {
      throw new HttpException(
        { message: 'AI_SERVICE_URL not configured in environment variables' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    if (!aiServiceSecret) {
      throw new HttpException(
        { message: 'AI_SERVICE_SECRET not configured in environment variables' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      // Obtener telemetría base
      const telemetryData = await this.getRaceTelemetry(sessionKey, driverNumber);

      // Enviar al servicio de IA con header de autenticación
      const obs = this.http.post<RaceAnalysis>(`${aiServiceUrl}/analyze`, telemetryData, {
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': aiServiceSecret,
        },
      });
      const response = await lastValueFrom(obs);

      return response.data;
    } catch (err: any) {
      // Si es un error de telemetría, propagar
      if (err instanceof HttpException) {
        throw err;
      }

      // Error del servicio de IA
      const status = err?.response?.status ?? HttpStatus.SERVICE_UNAVAILABLE;
      const message = err?.response?.data ?? err?.message ?? 'AI analysis service failed';
      
      throw new HttpException(
        {
          message: 'AI analysis service temporarily unavailable',
          details: message,
          sessionKey,
          driverNumber,
        },
        status === HttpStatus.NOT_FOUND ? HttpStatus.SERVICE_UNAVAILABLE : status,
      );
    }
  }
}
