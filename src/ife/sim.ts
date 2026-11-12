import { bearingDeg, distanceKm, interpolate, type LatLon } from './geo.ts';
import type { Airport, FlightInfo } from './types.ts';

const KT_TO_KMH = 1.852;
const MIN = 60_000;
const CLIMB_MS = 22 * MIN;
const DESCENT_MS = 28 * MIN;
const START_KT = 160;
const END_KT = 140;

export type Phase = 'climb' | 'cruise' | 'descent' | 'arrived';

export interface FlightStatus {
  position: LatLon;
  headingDeg: number;
  altFt: number;
  speedKt: number;
  /** Vertical speed in ft/min. */
  climbFpm: number;
  totalKm: number;
  flownKm: number;
  leftKm: number;
  progress: number;
  elapsedMs: number;
  remainingMs: number;
  durationMs: number;
  phase: Phase;
}

export interface Plan {
  totalKm: number;
  cruiseKt: number;
  cruiseAltFt: number;
  climbMs: number;
  cruiseMs: number;
  descentMs: number;
  durationMs: number;
}

const kmIn = (ms: number, fromKt: number, toKt: number): number => (((fromKt + toKt) / 2) * KT_TO_KMH * ms) / 3_600_000;

/** Speed and altitude profile: climb, cruise, descent; short hops never reach full cruise. */
export const planFlight = (info: FlightInfo, from: Airport, to: Airport): Plan => {
  const totalKm = distanceKm(from, to);
  const cruiseKt = Math.max(300, info.speedKt);
  const cruiseAltFt = Math.max(20000, info.altFt);
  const rampKm = kmIn(CLIMB_MS, START_KT, cruiseKt) + kmIn(DESCENT_MS, cruiseKt, END_KT);
  const scale = Math.min(1, totalKm / rampKm);
  const climbMs = CLIMB_MS * scale;
  const descentMs = DESCENT_MS * scale;
  const cruiseKm = Math.max(0, totalKm - rampKm);
  const cruiseMs = (cruiseKm / (cruiseKt * KT_TO_KMH)) * 3_600_000;
  return { totalKm, cruiseKt, cruiseAltFt, climbMs, cruiseMs, descentMs, durationMs: climbMs + cruiseMs + descentMs };
};

const ease = (t: number): number => Math.sin((Math.min(1, Math.max(0, t)) * Math.PI) / 2);

export const flightStatus = (plan: Plan, from: Airport, to: Airport, departedAt: number, now: number): FlightStatus => {
  const { climbMs, cruiseMs, descentMs, cruiseKt, cruiseAltFt, durationMs, totalKm } = plan;
  const t = Math.min(Math.max(0, now - departedAt), durationMs);
  const scale = climbMs / CLIMB_MS;
  const topAlt = cruiseAltFt * Math.min(1, 0.35 + 0.65 * scale);
  // Distance flown is the integral of a linearly changing speed within each phase.
  const along = (ms: number, phaseMs: number, v0: number, v1: number): number =>
    phaseMs > 0 ? kmIn(ms, v0, v0 + ((v1 - v0) * ms) / phaseMs) : 0;

  let flownKm: number;
  let speedKt: number;
  let altFt: number;
  let climbFpm: number;
  let phase: Phase;
  if (t < climbMs) {
    phase = 'climb';
    flownKm = along(t, climbMs, START_KT, cruiseKt);
    speedKt = START_KT + ((cruiseKt - START_KT) * t) / climbMs;
    altFt = topAlt * ease(t / climbMs);
    climbFpm = ((topAlt * Math.PI) / 2 / (climbMs / MIN)) * Math.cos(((t / climbMs) * Math.PI) / 2);
  } else if (t < climbMs + cruiseMs) {
    phase = 'cruise';
    flownKm = kmIn(climbMs, START_KT, cruiseKt) + (cruiseKt * KT_TO_KMH * (t - climbMs)) / 3_600_000;
    speedKt = cruiseKt;
    altFt = topAlt;
    climbFpm = 0;
  } else {
    const d = t - climbMs - cruiseMs;
    phase = t >= durationMs ? 'arrived' : 'descent';
    flownKm = kmIn(climbMs, START_KT, cruiseKt) + (cruiseKt * KT_TO_KMH * cruiseMs) / 3_600_000 + along(d, descentMs, cruiseKt, END_KT);
    speedKt = phase === 'arrived' ? 0 : cruiseKt + ((END_KT - cruiseKt) * d) / descentMs;
    altFt = phase === 'arrived' ? 0 : topAlt * ease(1 - d / descentMs);
    climbFpm = phase === 'arrived' ? 0 : -((topAlt * Math.PI) / 2 / (descentMs / MIN)) * Math.cos(((1 - d / descentMs) * Math.PI) / 2);
  }

  flownKm = Math.min(totalKm, flownKm);
  const progress = totalKm > 0 ? flownKm / totalKm : 1;
  const position = interpolate(from, to, progress);
  const ahead = progress < 0.999 ? interpolate(from, to, Math.min(1, progress + 0.001)) : to;
  return {
    position,
    headingDeg: progress < 0.999 ? bearingDeg(position, ahead) : bearingDeg(from, to),
    altFt,
    speedKt,
    climbFpm,
    totalKm,
    flownKm,
    leftKm: totalKm - flownKm,
    progress,
    elapsedMs: t,
    remainingMs: durationMs - t,
    durationMs,
    phase,
  };
};

/** International Standard Atmosphere outside air temperature, °C. */
export const isaTempC = (altFt: number): number => Math.max(-56.5, 15 - (1.98 * altFt) / 1000);
