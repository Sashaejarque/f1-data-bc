import { AxiosResponse } from 'axios';

// OpenF1 API DTOs (partial, focused on fields we use)
export interface DriverApiDTO {
  driver_number: number;
  full_name: string;
  team_name?: string;
  team_colour?: string;
  headshot_url?: string;
  session_key?: number;
}

export interface SessionApiDTO {
  session_key: number;
  year?: number;
  session_type?: string;
  name?: string;
  date_start: string; // ISO
  date_end: string;   // ISO
}

export interface SessionResultApiDTO {
  session_key: number;
  driver_number: number;
  position?: number | null;
  points?: number | null;
  classified_status?: string | null;
}

export interface PositionApiDTO {
  session_key: number;
  driver_number: number;
  position: number | null;
  date: string; // ISO
}

export interface LapApiDTO {
  session_key: number;
  driver_number: number;
  lap_number: number;
  date_start: string; // ISO
  lap_duration?: number | null; // seconds (preferred field name in API)
  duration?: number | null; // seconds (fallback / legacy)
  duration_sector_1?: number | null;  // seconds
  duration_sector_2?: number | null;  // seconds
  duration_sector_3?: number | null;  // seconds
  sector1?: number | null;  // seconds (fallback / legacy)
  sector2?: number | null;  // seconds (fallback / legacy)
  sector3?: number | null;  // seconds (fallback / legacy)
}

export interface StintApiDTO {
  session_key: number;
  driver_number: number;
  lap_start: number;
  lap_end: number;
  compound?: string | null;
  tyre_age_at_start?: number | null;
}

export interface PitApiDTO {
  session_key: number;
  driver_number: number;
  lap_number: number;
  date: string; // ISO
  pit_duration?: number | null; // seconds
  total_duration?: number | null; // seconds (if provided)
}

export interface WeatherApiDTO {
  session_key: number;
  date: string; // ISO
  air_temperature?: number | null; // °C
  track_temperature?: number | null; // °C
  humidity?: number | null; // %
  wind_speed?: number | null; // m/s or km/h depending on API
  rainfall?: number | null; // mm or binary depending on API
  is_raining?: boolean | null;
}

// Domain Entities we return from our service
export interface DriverSummary {
  driver_number: number;
  full_name: string;
  team_name?: string;
  team_colour?: string;
  headshot_url?: string;
}

export interface LastRaceResult {
  session_key: number;
  position: number | null;
  points: number | null;
}

export interface WeatherSnapshot {
  date: string;
  airTemperature?: number | null;
  trackTemperature?: number | null;
  humidity?: number | null;
  windSpeed?: number | null;
  isRaining?: boolean | null;
}

export interface PitStopInfo {
  lapNumber: number;
  duration?: number | null;
  totalDuration?: number | null;
}

export interface RaceTelemetryLap {
  lapNumber: number;
  lapDuration?: number | null;
  sector1?: number | null;
  sector2?: number | null;
  sector3?: number | null;
  tireCompound?: string | null;
  weather?: WeatherSnapshot | null;
}

export interface RaceTelemetry {
  raceSummary: {
    totalLaps: number;
    totalPitStops: number;
    compoundsUsed: string[];
  };
  pitStops: PitStopInfo[];
  telemetry: RaceTelemetryLap[];
}

export interface RaceAnalysis {
  summary?: string;
  key_findings?: Array<{
    topic?: string;
    description?: string;
    evidence?: string;
    impact?: string;
  }>;
  strategy_next_race?: Array<{
    area?: string;
    action?: string;
    expected_gain?: string;
  }>;
  stint_review?: Array<{
    compound?: string;
    pace_trend?: string;
    consistency?: string;
    notes?: string;
  }>;
  [key: string]: any; // Flexible para cualquier estructura de respuesta del AI
}

export type AxiosObs<T> = Promise<AxiosResponse<T>>;
