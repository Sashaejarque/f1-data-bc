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
  RaceClassificationEntry,
  RaceResultsSummary,
  DriverStrategyEntry,
  RaceStrategySummary,
  StandingsEntry,
  ChampionshipStandings,
  WeatherSummaryDTO,
} from './openf1.interfaces';
import { CacheService } from '../cache/cache.service';

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
  constructor(
    private readonly http: HttpService,
    private readonly cache: CacheService,
  ) {}

  private async get<T>(path: string, params?: Record<string, any>, attempt = 0): Promise<T> {
    try {
      const obs = this.http.get<T>(`${BASE_URL}${path}`, { params });
      const res = await lastValueFrom(obs);
      return res.data as T;
    } catch (err: any) {
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY;

      // OpenF1 rate-limita pedidos concurrentes (429) -- getRaceTelemetry dispara laps/stints/
      // pit/weather en paralelo con Promise.all, así que es fácil pisarse. Reintentamos un par
      // de veces con backoff antes de darnos por vencidos.
      if (status === 429 && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        return this.get<T>(path, params, attempt + 1);
      }

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

  // Igual que get<T>, pero un 404 de OpenF1 (que usa para "no hay filas", no un array vacío)
  // se trata como resultado vacío en vez de propagarse como error.
  private async getOrEmpty<T extends any[]>(path: string, params?: Record<string, any>): Promise<T> {
    try {
      return await this.get<T>(path, params);
    } catch (err: any) {
      if (err instanceof HttpException && err.getStatus() === HttpStatus.NOT_FOUND) {
        return [] as unknown as T;
      }
      throw err;
    }
  }

  // Todas las sesiones de carrera que ya ocurrieron en el año dado, ordenadas de más vieja
  // a más nueva. Si el año todavía no tiene ninguna carrera corrida (ej. en enero/febrero
  // antes de la primera cita), cae al año anterior -- esto lo usan tanto "última carrera"
  // como el campeonato acumulado (necesita TODAS, no solo la última).
  private async findPastRaceSessions(year: number, nowMs: number): Promise<SessionApiDTO[]> {
    const sessions = await this.get<SessionApiDTO[]>('/sessions', { year, session_type: 'Race' });
    const past = (sessions ?? [])
      .filter((s) => {
        const t = parseISO(s.date_start);
        return t != null && t <= nowMs;
      })
      .sort((a, b) => (parseISO(a.date_start) ?? 0) - (parseISO(b.date_start) ?? 0));

    if (past.length > 0) return past;

    if (year > 2018) {
      return this.findPastRaceSessions(year - 1, nowMs);
    }

    return [];
  }

  // Busca la sesión de carrera más reciente que ya haya ocurrido.
  private async findLatestPastRaceSession(year: number, nowMs: number): Promise<SessionApiDTO> {
    const past = await this.findPastRaceSessions(year, nowMs);
    if (past.length === 0) {
      throw new HttpException({ message: 'No past race sessions found' }, HttpStatus.NOT_FOUND);
    }
    return past[past.length - 1];
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

  // CASO DE USO 2: Última Carrera del Piloto
  async getLastRaceResult(driverNumber: number): Promise<LastRaceResult> {
    // El año se calcula en vez de hardcodearse: la parrilla de /drivers (session_key=latest)
    // siempre refleja el roster vigente, así que "la última carrera" tiene que ser del mismo
    // año -- fijarlo a un año pasado dejaba a los pilotos que cambiaron de número/equipo (o
    // los rookies nuevos) sin session_result para esa sesión, y OpenF1 respondía 404.
    const now = Date.now();
    const currentYear = new Date(now).getFullYear();

    const latest = await this.findLatestPastRaceSession(currentYear, now);
    const sessionKey = latest.session_key;

    // Paso 2: obtener resultado vía /session_result
    let position: number | null = null;
    let points: number | null = null;

    // OpenF1 devuelve 404 (no un array vacío) para /session_result cuando el piloto no tiene
    // fila en esa sesión (ej. no llegó a correr esa carrera) -- lo tratamos como "sin resultado"
    // en vez de dejar que el 404 se propague crudo hasta el dashboard.
    const sessionResults = await this.getOrEmpty<SessionResultApiDTO[]>(
      '/session_result',
      { session_key: sessionKey, driver_number: driverNumber },
    );

    const sr = sessionResults?.find((r) => r.driver_number === driverNumber);
    if (sr && (sr.position != null || sr.points != null)) {
      position = sr.position ?? null;
      points = sr.points ?? null;
    } else {
      // Fallback: /position (beta)
      const positions = await this.getOrEmpty<PositionApiDTO[]>(
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
      // laps/stints/pit vía getOrEmpty: un piloto que abandonó temprano (ej. choque en vuelta 1)
      // puede no tener filas en alguno de estos -- OpenF1 responde 404 en vez de un array vacío
      // para esos casos (mismo comportamiento que en /session_result, ver getLastRaceResult).
      const [laps, stints, pits, weather] = await Promise.all([
        this.getOrEmpty<LapApiDTO[]>('/laps', { session_key: sessionKey, driver_number: driverNumber }),
        this.getOrEmpty<StintApiDTO[]>('/stints', { session_key: sessionKey, driver_number: driverNumber }),
        this.getOrEmpty<PitApiDTO[]>('/pit', { session_key: sessionKey, driver_number: driverNumber }),
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
      // err ya es el HttpException que arma get() (no un AxiosError), así que el status real
      // está en getStatus(), no en err.response.status -- eso siempre daba BAD_GATEWAY.
      const status = err instanceof HttpException ? err.getStatus() : HttpStatus.BAD_GATEWAY;
      const message = err instanceof HttpException ? err.getResponse() : (err?.message ?? 'OpenF1 telemetry merge failed');
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

    // El análisis de una carrera ya corrida es inmutable para siempre -- si ya se calculó
    // antes para este piloto+sesión, se devuelve directo sin volver a gastar cuota de Groq
    // ni pegarle de nuevo a OpenF1. Ver docs/RAG-PLAN.md.
    const cached = await this.cache.getDriverAnalysis(sessionKey, driverNumber);
    if (cached) {
      return { ...cached, cached: true };
    }

    try {
      // Obtener telemetría base
      const telemetryData = await this.getRaceTelemetry(sessionKey, driverNumber);

      // RAG-PLAN Etapas 2-3: vector de features de la carrera actual (cómputo determinístico,
      // gratis, no llama a Groq) y búsqueda del precedente más parecido entre lo ya analizado.
      // Si cualquiera de los dos pasos falla, seguimos sin precedente -- el análisis principal
      // no depende de esto, es una mejora, no un requisito.
      const currentFeatures = await this.extractFeatures(telemetryData, aiServiceUrl, aiServiceSecret);
      const precedent = currentFeatures
        ? await this.findPrecedent(sessionKey, driverNumber, currentFeatures)
        : null;

      const requestBody = precedent ? { ...telemetryData, precedent } : telemetryData;

      // Enviar al servicio de IA con header de autenticación
      const obs = this.http.post<RaceAnalysis>(`${aiServiceUrl}/analyze`, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': aiServiceSecret,
        },
      });
      const response = await lastValueFrom(obs);

      const circuitShortName = await this.resolveCircuitShortName(sessionKey);
      const toStore = { ...response.data, circuitShortName };
      await this.cache.saveDriverAnalysis(sessionKey, driverNumber, toStore);
      return { ...toStore, cached: false };
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

  // CASO DE USO 5: Clasificación completa de la última carrera (dashboard)
  // Una sola consulta a /session_result sin filtrar por piloto trae los ~22 a la vez --
  // ver docs/DASHBOARD-PLAN.md, "truco clave". Nada de esto pega a la IA.
  async getLatestRaceResults(): Promise<RaceResultsSummary> {
    const now = Date.now();
    const currentYear = new Date(now).getFullYear();
    const latest = await this.findLatestPastRaceSession(currentYear, now);
    return this.buildRaceResultsSummary(latest, currentYear);
  }

  private async buildRaceResultsSummary(session: SessionApiDTO, year: number): Promise<RaceResultsSummary> {
    const sessionKey = session.session_key;

    const [results, drivers] = await Promise.all([
      this.getOrEmpty<SessionResultApiDTO[]>('/session_result', { session_key: sessionKey }),
      this.getActiveDrivers(),
    ]);

    const driverByNumber = new Map(drivers.map((d) => [d.driver_number, d]));

    const classification: RaceClassificationEntry[] = results
      .map((r) => {
        const info = driverByNumber.get(r.driver_number);
        return {
          driverNumber: r.driver_number,
          fullName: info?.full_name ?? `#${r.driver_number}`,
          teamName: info?.team_name,
          teamColour: info?.team_colour,
          position: r.position ?? null,
          points: r.points ?? 0,
          dnf: r.dnf ?? false,
          gapToLeader: r.gap_to_leader ?? null,
        };
      })
      .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));

    return {
      sessionKey,
      circuitShortName: session.circuit_short_name ?? null,
      year,
      classification,
    };
  }

  // CASO DE USO 6: Estrategia de gomas del campo completo (dashboard)
  // Mismo truco: /stints y /pit sin filtrar por piloto traen el campo entero en una llamada.
  async getLatestRaceStrategy(): Promise<RaceStrategySummary> {
    const now = Date.now();
    const currentYear = new Date(now).getFullYear();
    const latest = await this.findLatestPastRaceSession(currentYear, now);
    return this.buildRaceStrategySummary(latest.session_key);
  }

  private async buildRaceStrategySummary(sessionKey: number): Promise<RaceStrategySummary> {
    const [stints, pits] = await Promise.all([
      this.getOrEmpty<StintApiDTO[]>('/stints', { session_key: sessionKey }),
      this.getOrEmpty<PitApiDTO[]>('/pit', { session_key: sessionKey }),
    ]);

    const pitCountByDriver = new Map<number, number>();
    for (const p of pits) {
      pitCountByDriver.set(p.driver_number, (pitCountByDriver.get(p.driver_number) ?? 0) + 1);
    }

    const stintsByDriver = new Map<number, StintApiDTO[]>();
    for (const s of stints) {
      const arr = stintsByDriver.get(s.driver_number) ?? [];
      arr.push(s);
      stintsByDriver.set(s.driver_number, arr);
    }

    const strategies: DriverStrategyEntry[] = Array.from(stintsByDriver.entries()).map(
      ([driverNumber, driverStints]) => ({
        driverNumber,
        pitStopCount: pitCountByDriver.get(driverNumber) ?? 0,
        compoundSequence: [...driverStints]
          .sort((a, b) => a.lap_start - b.lap_start)
          .map((s) => s.compound ?? 'UNKNOWN'),
      }),
    );

    return { sessionKey, strategies };
  }

  // CASO DE USO 7: Campeonato acumulado (dashboard)
  // Costoso solo la primera vez que se pide un año (una llamada a /session_result por cada
  // carrera ya corrida, en secuencia para no pisar el rate limit de OpenF1). Después queda
  // en Mongo y los pedidos siguientes solo suman las carreras nuevas desde el último snapshot.
  async getChampionshipStandings(year: number): Promise<ChampionshipStandings> {
    const now = Date.now();
    const pastSessions = await this.findPastRaceSessions(year, now);

    if (pastSessions.length === 0) {
      throw new HttpException({ message: `No hay carreras corridas todavía en ${year}` }, HttpStatus.NOT_FOUND);
    }

    const latestSessionKey = pastSessions[pastSessions.length - 1].session_key;
    const cached = await this.cache.getStandingsSnapshot(year);
    if (cached && cached.computedThroughSessionKey === latestSessionKey) {
      return cached;
    }

    let pointsByDriver = new Map<number, number>();
    let sessionsToProcess = pastSessions;

    if (cached) {
      const idx = pastSessions.findIndex((s) => s.session_key === cached.computedThroughSessionKey);
      if (idx >= 0) {
        // Incremental: solo procesar las carreras nuevas desde el último snapshot guardado.
        sessionsToProcess = pastSessions.slice(idx + 1);
        pointsByDriver = new Map(cached.standings.map((s) => [s.driverNumber, s.points]));
      }
    }

    for (const session of sessionsToProcess) {
      const results = await this.getOrEmpty<SessionResultApiDTO[]>('/session_result', {
        session_key: session.session_key,
      });
      for (const r of results) {
        const prev = pointsByDriver.get(r.driver_number) ?? 0;
        pointsByDriver.set(r.driver_number, prev + (r.points ?? 0));
      }
    }

    const drivers = await this.getActiveDrivers();
    const driverByNumber = new Map(drivers.map((d) => [d.driver_number, d]));

    const standings: StandingsEntry[] = Array.from(pointsByDriver.entries())
      .map(([driverNumber, points]) => {
        const info = driverByNumber.get(driverNumber);
        return {
          driverNumber,
          fullName: info?.full_name ?? `#${driverNumber}`,
          teamName: info?.team_name,
          teamColour: info?.team_colour,
          points,
        };
      })
      .sort((a, b) => b.points - a.points);

    const snapshot: ChampionshipStandings = {
      year,
      computedThroughSessionKey: latestSessionKey,
      standings,
      updatedAt: new Date().toISOString(),
    };

    await this.cache.saveStandingsSnapshot(year, snapshot);
    return snapshot;
  }

  // CASO DE USO 8: Análisis de IA de la carrera completa (dashboard)
  // Una sola llamada a Groq por carrera (no 22) -- arma un resumen agregado del campo
  // (clasificación + estrategias + clima) y se lo manda a /analyze-race en f1-ia-engineer.
  // Cacheado igual que el análisis por piloto (ver docs/DASHBOARD-PLAN.md Etapa 4).
  async getLatestRaceOverview(): Promise<RaceAnalysis> {
    const now = Date.now();
    const currentYear = new Date(now).getFullYear();
    const latest = await this.findLatestPastRaceSession(currentYear, now);
    const sessionKey = latest.session_key;

    const cached = await this.cache.getRaceOverview(sessionKey);
    if (cached) {
      return { ...cached, cached: true };
    }

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
      const [resultsSummary, strategySummary, weather] = await Promise.all([
        this.buildRaceResultsSummary(latest, currentYear),
        this.buildRaceStrategySummary(sessionKey),
        this.getOrEmpty<WeatherApiDTO[]>('/weather', { session_key: sessionKey }),
      ]);

      const payload = {
        sessionKey,
        circuitShortName: latest.circuit_short_name ?? null,
        year: currentYear,
        classification: resultsSummary.classification,
        strategies: strategySummary.strategies,
        weather: this.buildWeatherSummary(weather),
      };

      const obs = this.http.post<RaceAnalysis>(`${aiServiceUrl}/analyze-race`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': aiServiceSecret,
        },
      });
      const response = await lastValueFrom(obs);

      await this.cache.saveRaceOverview(sessionKey, response.data);
      return { ...response.data, cached: false };
    } catch (err: any) {
      if (err instanceof HttpException) {
        throw err;
      }

      const status = err?.response?.status ?? HttpStatus.SERVICE_UNAVAILABLE;
      const message = err?.response?.data ?? err?.message ?? 'AI race overview service failed';

      throw new HttpException(
        {
          message: 'AI race overview service temporarily unavailable',
          details: message,
          sessionKey,
        },
        status === HttpStatus.NOT_FOUND ? HttpStatus.SERVICE_UNAVAILABLE : status,
      );
    }
  }

  // RAG-PLAN Etapa 2: le pide a f1-ia-engineer el vector de features de esta telemetría --
  // es un cómputo determinístico (paradas, gomas, degradación), no pasa por Groq, así que
  // no cuesta cuota. Si falla, no bloquea el análisis principal, solo no hay retrieval.
  private async extractFeatures(
    telemetryData: RaceTelemetry,
    aiServiceUrl: string,
    aiServiceSecret: string,
  ): Promise<Record<string, any> | null> {
    try {
      const obs = this.http.post(`${aiServiceUrl}/extract-features`, telemetryData, {
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': aiServiceSecret,
        },
      });
      const response = await lastValueFrom(obs);
      return response.data as Record<string, any>;
    } catch {
      return null;
    }
  }

  // RAG-PLAN Etapa 3: busca, entre lo ya analizado y cacheado, la carrera más parecida a
  // la actual por similitud coseno sobre el vector de features + solapamiento de gomas.
  // Heurística simple a propósito: el corpus recién empieza a crecer con el uso real, no
  // hace falta (ni se justifica) un motor de vector search para esto.
  private async findPrecedent(
    excludeSessionKey: number,
    excludeDriverNumber: number,
    currentFeatures: Record<string, any>,
  ): Promise<{ circuitShortName: string | null; similarity: number; pitStopCount: number; compoundSequence: string[]; summary: string } | null> {
    const candidates = await this.cache.getAllDriverAnalysesWithFeatures();
    if (candidates.length === 0) return null;

    const currentVec = this.featuresToVector(currentFeatures);
    let best: { score: number; candidate: (typeof candidates)[number] } | null = null;

    for (const candidate of candidates) {
      if (candidate.sessionKey === excludeSessionKey && candidate.driverNumber === excludeDriverNumber) continue;
      if (!candidate.features) continue;

      const numericScore = this.cosineSimilarity(currentVec, this.featuresToVector(candidate.features));
      const overlapScore = this.compoundOverlap(currentFeatures.compoundSequence, candidate.features.compoundSequence);
      const score = numericScore * 0.7 + overlapScore * 0.3;

      if (!best || score > best.score) {
        best = { score, candidate };
      }
    }

    // Umbral bajo a propósito -- el corpus todavía es chico, mejor un precedente mediocre
    // con su similarity real visible en el prompt (el LLM puede ponderarlo) que ninguno.
    if (!best || best.score < 0.3) return null;

    return {
      circuitShortName: best.candidate.circuitShortName ?? null,
      similarity: Math.round(best.score * 100) / 100,
      pitStopCount: best.candidate.features.pitStopCount ?? 0,
      compoundSequence: best.candidate.features.compoundSequence ?? [],
      summary: (best.candidate.summary ?? '').slice(0, 300),
    };
  }

  private featuresToVector(f: Record<string, any>): number[] {
    return [
      f.pitStopCount ?? 0,
      f.firstPitLap ?? 0,
      f.trackTempDelta ?? 0,
      (f.avgDegradationSlope ?? 0) * 10, // escalado para pesar comparable a los otros ejes
    ];
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private compoundOverlap(a: string[] = [], b: string[] = []): number {
    if (!a?.length || !b?.length) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    let intersection = 0;
    for (const c of setA) {
      if (setB.has(c)) intersection++;
    }
    return intersection / Math.max(setA.size, setB.size);
  }

  private async resolveCircuitShortName(sessionKey: number): Promise<string | null> {
    try {
      const sessions = await this.getOrEmpty<SessionApiDTO[]>('/sessions', { session_key: sessionKey });
      return sessions[0]?.circuit_short_name ?? null;
    } catch {
      return null;
    }
  }

  private buildWeatherSummary(weather: WeatherApiDTO[]): WeatherSummaryDTO | null {
    if (!weather || weather.length === 0) return null;

    const sorted = [...weather].sort((a, b) => (parseISO(a.date) ?? 0) - (parseISO(b.date) ?? 0));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const rained = weather.some((w) => w.is_raining === true || (w.rainfall != null && w.rainfall > 0));

    return {
      airTempStart: first.air_temperature ?? null,
      airTempEnd: last.air_temperature ?? null,
      trackTempStart: first.track_temperature ?? null,
      trackTempEnd: last.track_temperature ?? null,
      rained,
    };
  }
}
