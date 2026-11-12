import { REGIONS, type Region } from './ife/regions.ts';

export type Units = 'metric' | 'imperial';
export type Clock = '24h' | '12h';

/** Seat letters under one passenger service unit: left side, right side, or right side of a wide-body. */
export const SEAT_GROUPS = ['ABC', 'DEF', 'HJK'] as const;
export type SeatGroup = (typeof SEAT_GROUPS)[number];
export const MAX_ROW = 99;

export interface Prefs {
  region: Region;
  units: Units;
  clock: Clock;
  ife: boolean;
  row: number;
  seats: SeatGroup;
}

export const defaultPrefs: Prefs = { region: 'europe', units: 'metric', clock: '24h', ife: true, row: 17, seats: 'ABC' };

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

const isRow = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_ROW;

/** Reads stored preferences, falling back to defaults for anything missing or invalid. */
export const parsePrefs = (raw: string | null): Prefs => {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
  } catch {
    // Corrupt storage: use defaults.
  }
  return {
    region: oneOf(data.region, REGIONS, defaultPrefs.region),
    units: oneOf(data.units, ['metric', 'imperial'] as const, defaultPrefs.units),
    clock: oneOf(data.clock, ['24h', '12h'] as const, defaultPrefs.clock),
    ife: typeof data.ife === 'boolean' ? data.ife : defaultPrefs.ife,
    row: isRow(data.row) ? data.row : defaultPrefs.row,
    seats: oneOf(data.seats, SEAT_GROUPS, defaultPrefs.seats),
  };
};
