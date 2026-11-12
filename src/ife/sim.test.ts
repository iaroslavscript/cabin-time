import { describe, expect, it } from 'vitest';
import { distanceKm, sunElevation, trackOffset } from './geo.ts';
import { flightStatus, planFlight } from './sim.ts';
import type { Airport, FlightInfo } from './types.ts';

const airport = (icao: string, lat: number, lon: number): Airport => ({
  icao,
  iata: icao.slice(1),
  name: icao,
  city: icao,
  country: 'XX',
  lat,
  lon,
});
const FRA = airport('EDDF', 50.033, 8.571);
const JFK = airport('KJFK', 40.64, -73.779);
const MUC = airport('EDDM', 48.354, 11.786);
const NUE = airport('EDDN', 49.499, 11.078);
const info = (from: Airport, to: Airport): FlightInfo => ({
  callsign: 'TST1',
  flightNo: 'TS1',
  airline: 'Test',
  aircraft: 'Airbus A350',
  typeCode: 'A359',
  reg: '',
  from: from.icao,
  to: to.icao,
  altFt: 37000,
  speedKt: 480,
});

describe('geo', () => {
  it('measures great-circle distance and track offset', () => {
    expect(distanceKm(FRA, JFK)).toBeCloseTo(6200, -2);
    const off = trackOffset(FRA, JFK, { lat: 55, lon: -30 });
    expect(off.crossKm).toBeLessThan(300);
    expect(off.along).toBeGreaterThan(0.3);
    expect(off.along).toBeLessThan(0.8);
  });

  it('knows day from night', () => {
    const noon = Date.UTC(2026, 2, 20, 12);
    expect(sunElevation({ lat: 0, lon: 0 }, noon)).toBeGreaterThan(80);
    expect(sunElevation({ lat: 0, lon: 180 }, noon)).toBeLessThan(-80);
  });
});

describe('flight simulation', () => {
  const plan = planFlight(info(FRA, JFK), FRA, JFK);
  const at = (fraction: number) => flightStatus(plan, FRA, JFK, 0, plan.durationMs * fraction);

  it('climbs, cruises and descends along the route', () => {
    const start = at(0);
    expect(start.phase).toBe('climb');
    expect(start.altFt).toBe(0);
    expect(distanceKm(start.position, FRA)).toBeLessThan(1);

    const mid = at(0.5);
    expect(mid.phase).toBe('cruise');
    expect(mid.altFt).toBe(37000);
    expect(mid.speedKt).toBe(480);
    expect(mid.flownKm + mid.leftKm).toBeCloseTo(mid.totalKm);
    expect(mid.remainingMs).toBeCloseTo(plan.durationMs / 2);

    const end = at(1);
    expect(end.phase).toBe('arrived');
    expect(end.leftKm).toBeCloseTo(0);
    expect(distanceKm(end.position, JFK)).toBeLessThan(1);
  });

  it('takes a realistic time for a transatlantic flight', () => {
    expect(plan.durationMs / 3_600_000).toBeGreaterThan(7);
    expect(plan.durationMs / 3_600_000).toBeLessThan(8.5);
  });

  it('never reaches full cruise on a short hop', () => {
    const hop = planFlight(info(MUC, NUE), MUC, NUE);
    expect(hop.cruiseMs).toBe(0);
    const top = Math.max(...[0.3, 0.4, 0.5, 0.6].map((f) => flightStatus(hop, MUC, NUE, 0, hop.durationMs * f).altFt));
    expect(top).toBeLessThan(37000);
    expect(flightStatus(hop, MUC, NUE, 0, hop.durationMs).position.lat).toBeCloseTo(NUE.lat, 3);
  });
});
