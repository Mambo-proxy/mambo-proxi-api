// Outils communs du seed : client Prisma, lecture des données, dates relatives, journal.
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import type { DateSpec, Json } from './types.js';

/** Client Prisma du seed (même adaptateur `pg` que l'API, schéma lu dans `DATABASE_URL`). */
export function createSeedClient(): PrismaClient {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL est absente : impossible de se connecter à la base.');
  const schema = new URL(connectionString).searchParams.get('schema') ?? undefined;
  return new PrismaClient({
    adapter: new PrismaPg(
      { connectionString, connectionTimeoutMillis: 10_000 },
      schema ? { schema } : undefined,
    ),
  });
}

/** Transaction interactive d'un domaine (délai allongé : plusieurs centaines d'écritures). */
export type Tx = Prisma.TransactionClient;
export const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 120_000 } as const;

/** Lit un fichier de données (`prisma/seed/data/<nom>.json`), généré à partir des mocks du site. */
export function readSeedData<T>(name: string): T {
  const text = readFileSync(new URL(`./data/${name}.json`, import.meta.url), 'utf8');
  return JSON.parse(text) as T;
}

/** Colonne JSON facultative : `null` devient le NULL SQL (Prisma refuse `null` brut pour un champ `Json?`). */
export function nullableJson(value: Json | null | undefined): Json | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : value;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Décalage de `Africa/Douala` (UTC+1 toute l'année, sans heure d'été). */
const DOUALA_OFFSET = 60 * MINUTE;

/**
 * Horloge des données de démonstration. Les mocks du site datent leurs données par rapport au moment présent
 * (« il y a 2 h », « hier à 9 h », « jeudi de cette semaine à 10 h ») : le seed fait de même, pour que les listes
 * « 30 derniers jours », les retards et l'agenda de la semaine aient du contenu quel que soit le jour du lancement.
 */
export class SeedClock {
  readonly now: Date;
  private readonly dayStart: number;
  private readonly weekStart: number;

  constructor(now: Date = new Date()) {
    this.now = now;
    const local = now.getTime() + DOUALA_OFFSET;
    this.dayStart = Math.floor(local / DAY) * DAY - DOUALA_OFFSET;
    const weekday = (new Date(this.dayStart + DOUALA_OFFSET).getUTCDay() + 6) % 7; // 0 = lundi
    this.weekStart = this.dayStart - weekday * DAY;
  }

  /** Année des références `MP-AAAA-NNNN` des demandes de démonstration. */
  get year(): number {
    return new Date(this.now.getTime() + DOUALA_OFFSET).getUTCFullYear();
  }

  date(spec: DateSpec): Date {
    const match = /^rel:(now|day|week):(-?\d+)$/.exec(spec);
    if (!match) {
      const fixed = new Date(spec);
      if (Number.isNaN(fixed.getTime()))
        throw new Error(`Date invalide dans les données du seed : « ${spec} ».`);
      return fixed;
    }
    const offset = Number(match[2]);
    const anchor =
      match[1] === 'now' ? this.now.getTime() : match[1] === 'day' ? this.dayStart : this.weekStart;
    return new Date(anchor + offset);
  }

  optionalDate(spec: DateSpec | null | undefined): Date | null {
    return spec === null || spec === undefined ? null : this.date(spec);
  }

  /** Référence lisible d'une demande ou d'un rendez-vous de démonstration. */
  reference(sequence: number): string {
    return `MP-${this.year}-${String(sequence).padStart(4, '0')}`;
  }

  /** Remplace l'année des références citées dans un libellé des mocks (`MP-2026-0142`). */
  relabel(text: string): string {
    return text.replace(/MP-\d{4}-(\d{4})/g, (_, sequence: string) => `MP-${this.year}-${sequence}`);
  }
}

/** Condensat SHA-256 hexadécimal (jetons de démonstration inutilisables : seul le condensat est stocké). */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Ligne du journal du seed (« Rubriques : 5 »). */
export function logCount(label: string, count: number): void {
  console.log(`  ${label} : ${count}`);
}

/** Correspondance identifiant des mocks → identifiant en base (utilisateurs). */
export type IdMap = ReadonlyMap<string, string>;

export function mapId(map: IdMap, id: string | null | undefined): string | null {
  return id === null || id === undefined ? null : (map.get(id) ?? null);
}
