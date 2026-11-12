import { describe, expect, it } from 'vitest';
import { flightsFor } from './display.ts';
import snapshot from './flights.json';
import { REGIONS, inRegion } from './regions.ts';

describe('flight snapshot', () => {
  it('has flights for every region, each with both airports in that region', () => {
    for (const region of REGIONS) {
      const flights = flightsFor({ region });
      expect(flights.length, region).toBeGreaterThan(20);
      for (const f of flights) {
        const from = snapshot.airports[f.from as keyof typeof snapshot.airports];
        const to = snapshot.airports[f.to as keyof typeof snapshot.airports];
        expect(inRegion(region, from.country, to.country), `${f.callsign} ${f.from}-${f.to}`).toBe(true);
      }
    }
  });
});
