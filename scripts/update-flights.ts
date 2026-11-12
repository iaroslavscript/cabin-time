/**
 * Builds src/ife/flights.json: real flights that were airborne when the script ran.
 *
 * - Live traffic: adsb.lol API (ODbL 1.0) — only used to pick callsigns, aircraft and cruise level.
 * - Routes, airports, airlines, aircraft types: Virtual Radar Server standing data (CC0 1.0).
 *
 * Usage: pnpm update:flights [--data <standing-data dir>]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { distanceKm, trackOffset } from '../src/ife/geo.ts';
import { REGIONS, SAMPLE_POINTS, inRegion, type Region } from '../src/ife/regions.ts';
import type { Airport, City, FlightInfo, Snapshot } from '../src/ife/types.ts';

const OUT = new URL('../src/ife/flights.json', import.meta.url);
const API = 'https://api.adsb.lol/v2/point';
const CAP: Record<Region, number> = { europe: 150, 'north-america': 60, asia: 60, world: 60 };
const MAX_CITIES = 700;

const args = process.argv.slice(2);
const dataDir = args.includes('--data') ? args[args.indexOf('--data') + 1]! : 'tmp/standing-data';

if (!existsSync(dataDir)) {
  console.log(`Cloning VRS standing data into ${dataDir}…`);
  execFileSync('git', ['clone', '--depth', '1', 'https://github.com/vradarserver/standing-data', dataDir], {
    stdio: 'inherit',
  });
}

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted && c === '"' && src[i + 1] === '"') {
      field += '"';
      i++;
    } else if (c === '"') quoted = !quoted;
    else if (quoted) field += c;
    else if (c === ',') endField();
    else if (c === '\n') endRow();
    else field += c;
  }
  if (field || row.length) endRow();
  return rows.slice(1).filter((r) => r.length > 1);
};

const csvFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? csvFiles(join(dir, e.name)) : e.name.endsWith('.csv') ? [join(dir, e.name)] : [],
  );

const schema = (name: string): string => join(dataDir, name, 'schema-01');

// Code,Name,ICAO,IATA,Location,CountryISO2,Latitude,Longitude,AltitudeFeet
const airports = new Map<string, Airport>();
for (const file of csvFiles(schema('airports'))) {
  for (const [code, name, , iata, city, country, lat, lon] of parseCsv(readFileSync(file, 'utf8'))) {
    airports.set(code!, { icao: code!, iata: iata!, name: name!, city: city || name!, country: country!, lat: +lat!, lon: +lon! });
  }
}

// Code,Name,ICAO,IATA,…
const airlines = new Map<string, { name: string; iata: string }>();
for (const [code, name, , iata] of parseCsv(readFileSync(join(schema('airlines'), 'airlines.csv'), 'utf8'))) {
  airlines.set(code!, { name: name!, iata: iata! });
}

// ICAO,Manufacturer,Model,…
const models = new Map<string, string>();
for (const file of csvFiles(schema('model-type'))) {
  for (const [icao, maker, model] of parseCsv(readFileSync(file, 'utf8'))) {
    const full = model!.startsWith(maker!) ? model! : `${maker} ${model}`.trim();
    if (!models.has(icao!)) models.set(icao!, full.replace(/\bA-(\d{3})/, 'A$1'));
  }
}

// Callsign,Code,Number,AirlineCode,AirportCodes — one file per airline.
const routeFiles = csvFiles(schema('routes'));
const routeCache = new Map<string, Map<string, { number: string; airports: string[] }>>();
const routesOf = (airline: string) => {
  let routes = routeCache.get(airline);
  if (!routes) {
    routes = new Map();
    const file = routeFiles.find((f) => f.endsWith(`/${airline}-all.csv`));
    if (file) {
      for (const [callsign, , number, , codes] of parseCsv(readFileSync(file, 'utf8'))) {
        routes.set(callsign!, { number: number!, airports: codes!.split('-') });
      }
    }
    routeCache.set(airline, routes);
  }
  return routes;
};

interface Aircraft {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  alt_baro?: number | string;
  gs?: number;
  lat?: number;
  lon?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const traffic = new Map<string, Aircraft>();
const fetchPoint = async (lat: number, lon: number): Promise<Aircraft[]> => {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}/${lat}/${lon}/250`, { headers: { 'User-Agent': 'github-crew snapshot script' } });
    if (res.ok) return ((await res.json()) as { ac?: Aircraft[] }).ac ?? [];
    if (attempt === 5) throw new Error(`HTTP ${res.status}`);
    // Be polite to the free API: back off when rate limited.
    await sleep(attempt * 15_000);
  }
};

for (const [lat, lon] of Object.values(SAMPLE_POINTS).flat()) {
  try {
    const ac = await fetchPoint(lat, lon);
    for (const a of ac) traffic.set(a.hex, a);
    console.log(`${lat},${lon}: ${ac.length} aircraft`);
  } catch (e) {
    console.warn(`${lat},${lon}: ${String(e)}`);
  }
  await sleep(3000);
}

const picked = new Map<Region, FlightInfo[]>(REGIONS.map((r) => [r, []]));
const seen = new Set<string>();
for (const a of [...traffic.values()].sort(() => Math.random() - 0.5)) {
  const callsign = a.flight?.trim() ?? '';
  const alt = typeof a.alt_baro === 'number' ? a.alt_baro : 0;
  if (!/^[A-Z]{3}\d[0-9A-Z]{0,4}$/.test(callsign) || seen.has(callsign) || alt < 20000 || (a.gs ?? 0) < 300) continue;
  if (a.lat === undefined || a.lon === undefined) continue;
  const route = routesOf(callsign.slice(0, 3)).get(callsign);
  if (!route) continue;

  // Multi-leg routes: use the leg the aircraft is actually flying.
  const pos = { lat: a.lat, lon: a.lon };
  let leg: [Airport, Airport] | undefined;
  for (let i = 0; i + 1 < route.airports.length && !leg; i++) {
    const from = airports.get(route.airports[i]!);
    const to = airports.get(route.airports[i + 1]!);
    if (!from || !to || distanceKm(from, to) < 250) continue;
    const { crossKm, along } = trackOffset(from, to, pos);
    if (crossKm < 120 && along > 0.03 && along < 0.97) leg = [from, to];
  }
  if (!leg) continue;
  const [from, to] = leg;
  const region = REGIONS.find((r) => r !== 'world' && inRegion(r, from.country, to.country)) ?? 'world';
  const list = picked.get(region)!;
  if (list.length >= CAP[region]) continue;

  const airline = airlines.get(callsign.slice(0, 3));
  seen.add(callsign);
  list.push({
    callsign,
    // Alphanumeric ATC callsigns (e.g. AEE6TH) don't map to a commercial flight number.
    flightNo: airline?.iata && /^\d+$/.test(route.number) ? `${airline.iata}${+route.number}` : callsign,
    airline: airline?.name ?? callsign.slice(0, 3),
    aircraft: models.get(a.t ?? '') ?? a.t ?? '',
    typeCode: a.t ?? '',
    reg: a.r ?? '',
    from: from.icao,
    to: to.icao,
    altFt: Math.round(alt / 1000) * 1000,
    speedKt: Math.round(a.gs ?? 450),
  });
}

const flights = REGIONS.flatMap((r) => picked.get(r)!).sort((a, b) => a.callsign.localeCompare(b.callsign));
const usedAirports: Record<string, Airport> = {};
for (const f of flights) for (const code of [f.from, f.to]) usedAirports[code] = airports.get(code)!;

// Map labels: cities of the busiest airports across all routes.
const airportTraffic = new Map<string, number>();
for (const file of routeFiles) {
  for (const row of parseCsv(readFileSync(file, 'utf8'))) {
    for (const code of row[4]?.split('-') ?? []) airportTraffic.set(code, (airportTraffic.get(code) ?? 0) + 1);
  }
}
const cities: City[] = [];
const cityNames = new Set<string>();
for (const [code] of [...airportTraffic].sort((a, b) => b[1] - a[1])) {
  const ap = airports.get(code);
  if (!ap?.iata || cityNames.has(ap.city)) continue;
  cityNames.add(ap.city);
  cities.push([ap.city, +ap.lat.toFixed(3), +ap.lon.toFixed(3)]);
  if (cities.length >= MAX_CITIES) break;
}

const snapshot: Snapshot = { generatedAt: new Date().toISOString(), flights, airports: usedAirports, cities };
writeFileSync(OUT, `${JSON.stringify(snapshot)}\n`);
console.log(
  `Wrote ${flights.length} flights (${REGIONS.map((r) => `${r}: ${picked.get(r)!.length}`).join(', ')}), ` +
    `${Object.keys(usedAirports).length} airports, ${cities.length} cities.`,
);
