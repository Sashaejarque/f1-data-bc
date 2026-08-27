import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MongoClient, Db } from 'mongodb';
import { ChampionshipStandings, RaceAnalysis } from '../openf1/openf1.interfaces';

const RACE_ANALYSES = 'race_analyses';
const RACE_OVERVIEWS = 'race_overviews';
const STANDINGS_SNAPSHOTS = 'standings_snapshots';

// Cache persistente de todo lo que ya se calculó una vez (análisis de IA por piloto,
// análisis de IA de carrera completa, standings acumulados) para no recalcular en cada
// visita -- ver docs/RAG-PLAN.md y docs/DASHBOARD-PLAN.md.
//
// Si MONGODB_URI no está configurada (todavía no se armó el cluster de Atlas), el
// servicio arranca igual: cada método de lectura devuelve null (cache miss) y los de
// escritura no hacen nada -- el resto del código sigue funcionando exactamente como
// antes de sumar Mongo, solo que sin cachear.
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: MongoClient | null = null;
  private db: Db | null = null;

  async onModuleInit(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      this.logger.warn('MONGODB_URI no configurada -- cache persistente desactivado, se recalcula todo en cada pedido.');
      return;
    }

    try {
      this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
      await this.client.connect();
      this.db = this.client.db();

      await Promise.all([
        this.db.collection(RACE_ANALYSES).createIndex({ sessionKey: 1, driverNumber: 1 }, { unique: true }),
        this.db.collection(RACE_OVERVIEWS).createIndex({ sessionKey: 1 }, { unique: true }),
        this.db.collection(STANDINGS_SNAPSHOTS).createIndex({ year: 1 }, { unique: true }),
      ]);

      this.logger.log('Conectado a MongoDB -- cache persistente activo.');
    } catch (err: any) {
      this.logger.error(`No se pudo conectar a MongoDB, cache desactivado: ${err?.message ?? err}`);
      this.client = null;
      this.db = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }

  private get enabled(): boolean {
    return this.db !== null;
  }

  // --- Análisis de IA por piloto (RAG-PLAN Etapa 1) ---

  async getDriverAnalysis(sessionKey: number, driverNumber: number): Promise<RaceAnalysis | null> {
    if (!this.enabled) return null;
    const doc = await this.db!.collection(RACE_ANALYSES).findOne(
      { sessionKey, driverNumber },
      { projection: { _id: 0 } },
    );
    return (doc as unknown as RaceAnalysis) ?? null;
  }

  async saveDriverAnalysis(sessionKey: number, driverNumber: number, analysis: RaceAnalysis): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.db!.collection(RACE_ANALYSES).updateOne(
        { sessionKey, driverNumber },
        {
          $set: {
            sessionKey,
            driverNumber,
            ...analysis,
            model: 'openai/gpt-oss-20b',
            computedAt: new Date().toISOString(),
          },
        },
        { upsert: true },
      );
    } catch (err: any) {
      this.logger.warn(`No se pudo guardar el análisis por piloto en cache: ${err?.message ?? err}`);
    }
  }

  // --- Análisis de IA de la carrera completa (DASHBOARD-PLAN Etapa 4) ---

  async getRaceOverview(sessionKey: number): Promise<RaceAnalysis | null> {
    if (!this.enabled) return null;
    const doc = await this.db!.collection(RACE_OVERVIEWS).findOne(
      { sessionKey },
      { projection: { _id: 0 } },
    );
    return (doc as unknown as RaceAnalysis) ?? null;
  }

  async saveRaceOverview(sessionKey: number, analysis: RaceAnalysis): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.db!.collection(RACE_OVERVIEWS).updateOne(
        { sessionKey },
        {
          $set: {
            sessionKey,
            ...analysis,
            model: 'openai/gpt-oss-20b',
            computedAt: new Date().toISOString(),
          },
        },
        { upsert: true },
      );
    } catch (err: any) {
      this.logger.warn(`No se pudo guardar el análisis de carrera en cache: ${err?.message ?? err}`);
    }
  }

  // --- Campeonato acumulado (DASHBOARD-PLAN Etapa 2) ---

  async getStandingsSnapshot(year: number): Promise<ChampionshipStandings | null> {
    if (!this.enabled) return null;
    const doc = await this.db!.collection(STANDINGS_SNAPSHOTS).findOne(
      { year },
      { projection: { _id: 0 } },
    );
    return (doc as unknown as ChampionshipStandings) ?? null;
  }

  async saveStandingsSnapshot(year: number, snapshot: ChampionshipStandings): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.db!.collection(STANDINGS_SNAPSHOTS).updateOne(
        { year },
        { $set: snapshot },
        { upsert: true },
      );
    } catch (err: any) {
      this.logger.warn(`No se pudo guardar el snapshot de standings en cache: ${err?.message ?? err}`);
    }
  }
}
