import type { Prefs } from '../prefs.ts';
import { drawCamera } from './camera.ts';
import snapshotJson from './flights.json';
import { duration, formatter, type Formatter } from './format.ts';
import { sunElevation } from './geo.ts';
import { drawMap, fitView, loadWorld, type Rect, type World } from './map.ts';
import { inRegion } from './regions.ts';
import { flightStatus, isaTempC, planFlight, type FlightStatus, type Plan } from './sim.ts';
import type { Airport, FlightInfo, Snapshot } from './types.ts';
import { compass, describeWeather, fetchWeather, type Weather } from './weather.ts';

const snapshot = snapshotJson as unknown as Snapshot;
const STORAGE_KEY = 'cabin-ife-v1';
const WEATHER_REFRESH_MS = 15 * 60_000;
const WEATHER_RETRY_MS = 2 * 60_000;
/** How long the "arrived" state stays on screen before the next flight. */
const ARRIVED_HOLD_MS = 90_000;

export type ScreenId = 'map' | 'progress' | 'mini' | 'altspeed' | 'weather' | 'remaining' | 'camera';

/** Loop order and display times, after typical overhead IFE moving-map cycles. */
export const SCREENS: { id: ScreenId; ms: number }[] = [
  { id: 'map', ms: 40_000 },
  { id: 'progress', ms: 15_000 },
  { id: 'mini', ms: 15_000 },
  { id: 'altspeed', ms: 12_000 },
  { id: 'weather', ms: 15_000 },
  { id: 'remaining', ms: 15_000 },
  { id: 'camera', ms: 25_000 },
];

interface Active {
  info: FlightInfo;
  from: Airport;
  to: Airport;
  plan: Plan;
  departedAt: number;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const flightsFor = (prefs: Pick<Prefs, 'region'>): FlightInfo[] =>
  snapshot.flights.filter((f) => {
    const from = snapshot.airports[f.from];
    const to = snapshot.airports[f.to];
    return from && to && inRegion(prefs.region, from.country, to.country);
  });

export class MovingMap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: HTMLElement;
  private prefs: Prefs;
  private fmt: Formatter;
  private world: World | undefined;
  private flight: Active | undefined;
  private weather: { to?: Weather; fromOffset?: number; next: number; abort?: AbortController } = { next: 0 };
  private screen = 0;
  private screenStart = Date.now();
  private timer: number | undefined;
  private frame: number | undefined;
  private lastFrame = 0;
  private elapsedOnScreen = 0;

  constructor(
    private readonly root: HTMLElement,
    prefs: Prefs,
  ) {
    this.prefs = prefs;
    this.fmt = formatter(prefs.units, prefs.clock);
    this.canvas = root.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.hud = root.querySelector('.ife-hud')!;
    new ResizeObserver(() => this.render()).observe(this.canvas);
    void loadWorld()
      .then((w) => {
        this.world = w;
        this.render();
      })
      .catch(() => undefined);
    this.restoreOrPick();
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
  }

  /** e.g. "LH400 Lufthansa, Frankfurt am Main → New York". */
  get summary(): string {
    const f = this.flight;
    return f ? `${f.info.flightNo} ${f.info.airline}, ${f.from.city} → ${f.to.city}` : '—';
  }

  setPrefs(prefs: Prefs): void {
    const regionChanged = prefs.region !== this.prefs.region;
    this.prefs = prefs;
    this.fmt = formatter(prefs.units, prefs.clock);
    if (regionChanged) this.newFlight();
    if (prefs.ife) this.start();
    else this.stop();
    this.render();
  }

  newFlight(): void {
    const candidates = flightsFor(this.prefs).filter((f) => f.callsign !== this.flight?.info.callsign);
    const info = candidates[Math.floor(Math.random() * candidates.length)];
    if (!info) return;
    const from = snapshot.airports[info.from]!;
    const to = snapshot.airports[info.to]!;
    const plan = planFlight(info, from, to);
    // Join the flight somewhere between shortly after take-off and the last quarter.
    const departedAt = Date.now() - plan.durationMs * (0.08 + Math.random() * 0.67);
    this.setFlight({ info, from, to, plan, departedAt });
    this.screen = 0;
    this.screenStart = Date.now();
    this.render();
  }

  start(): void {
    if (this.timer !== undefined || !this.prefs.ife || document.hidden) return;
    this.screenStart = Date.now() - this.elapsedOnScreen;
    this.timer = window.setInterval(() => this.tick(), 1000);
    this.tick();
  }

  stop(): void {
    this.elapsedOnScreen = Date.now() - this.screenStart;
    window.clearInterval(this.timer);
    this.timer = undefined;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  private restoreOrPick(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { callsign?: string; departedAt?: number } | null;
      const info = flightsFor(this.prefs).find((f) => f.callsign === saved?.callsign);
      if (info && typeof saved?.departedAt === 'number') {
        const from = snapshot.airports[info.from]!;
        const to = snapshot.airports[info.to]!;
        const plan = planFlight(info, from, to);
        if (Date.now() < saved.departedAt + plan.durationMs) {
          this.setFlight({ info, from, to, plan, departedAt: saved.departedAt });
          return;
        }
      }
    } catch {
      // Ignore broken storage and pick a fresh flight.
    }
    this.newFlight();
  }

  private setFlight(flight: Active): void {
    this.flight = flight;
    this.root.dataset.flight = flight.info.callsign;
    this.root.dataset.route = `${flight.from.country}-${flight.to.country}`;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ callsign: flight.info.callsign, departedAt: flight.departedAt }));
    } catch {
      // Storage unavailable; the flight just won't survive a reload.
    }
    this.weather.abort?.abort();
    this.weather = { next: 0 };
    this.refreshWeather();
  }

  private refreshWeather(): void {
    const flight = this.flight;
    if (!flight || Date.now() < this.weather.next) return;
    const abort = new AbortController();
    this.weather.abort = abort;
    this.weather.next = Date.now() + WEATHER_RETRY_MS;
    Promise.all([fetchWeather(flight.to, abort.signal), fetchWeather(flight.from, abort.signal)])
      .then(([to, from]) => {
        if (this.flight !== flight) return;
        this.weather = { to, fromOffset: from.utcOffsetSec, next: Date.now() + WEATHER_REFRESH_MS };
        this.render();
      })
      .catch(() => undefined);
  }

  private get available(): boolean[] {
    const status = this.status();
    return SCREENS.map(({ id }) => {
      if (id !== 'camera') return true;
      // Like a real tail camera: only worth showing in daylight.
      return !!status && sunElevation(status.position, Date.now()) > -6;
    });
  }

  private tick(): void {
    const now = Date.now();
    const status = this.status();
    if (status?.phase === 'arrived' && now - this.flight!.departedAt - status.durationMs > ARRIVED_HOLD_MS) this.newFlight();
    this.refreshWeather();
    if (now - this.screenStart >= SCREENS[this.screen]!.ms) {
      const available = this.available;
      do this.screen = (this.screen + 1) % SCREENS.length;
      while (!available[this.screen]);
      this.screenStart = now;
    }
    this.render();
  }

  private status(): FlightStatus | undefined {
    const f = this.flight;
    return f && flightStatus(f.plan, f.from, f.to, f.departedAt, Date.now());
  }

  render(): void {
    const flight = this.flight;
    const status = this.status();
    const id = SCREENS[this.screen]!.id;
    this.root.dataset.screen = id;
    if (!flight || !status || !this.prefs.ife) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (!w || !h) return;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    if (id === 'camera') {
      this.animateCamera();
    } else {
      if (this.frame !== undefined) cancelAnimationFrame(this.frame);
      this.frame = undefined;
      this.drawMapScreen(id, status, { x: 0, y: 0, w, h });
    }
    this.hud.innerHTML = this.hudHtml(id, flight, status);
  }

  private drawMapScreen(id: ScreenId, s: FlightStatus, full: Rect): void {
    const f = this.flight!;
    const overlay = {
      from: { ...f.from, code: f.from.iata || f.from.icao },
      to: { ...f.to, code: f.to.iata || f.to.icao },
      position: s.position,
      progress: s.progress,
      headingDeg: s.headingDeg,
      cities: snapshot.cities,
      time: Date.now(),
    };
    if (id === 'mini') {
      const rect = { ...full, w: full.w * 0.56 };
      drawMap(this.ctx, rect, fitView([s.position], rect, 9, 0), this.world, { ...overlay, labelScale: 1.15 });
      this.ctx.fillStyle = '#071733';
      this.ctx.fillRect(rect.w, 0, full.w - rect.w, full.h);
      return;
    }
    // Header and footer bars cover part of the screen: fit the route into the area between them.
    const routeArea = { ...full, y: full.h * 0.12, h: full.h * 0.74 };
    const view = fitView([f.from, f.to, s.position], routeArea, 16);
    view.y += 0.02 * (full.h / view.scale);
    if (id === 'map') {
      const bar = full.h * 0.11;
      drawMap(this.ctx, full, view, this.world, {
        ...overlay,
        reserved: [{ ...full, h: bar }, { ...full, y: full.h - bar, h: bar }],
      });
      return;
    }
    // Text screens: the map stays as a dimmed backdrop.
    drawMap(this.ctx, full, view, this.world, { ...overlay, cities: [] });
    this.ctx.fillStyle = 'rgb(4 14 36 / 0.8)';
    this.ctx.fillRect(0, 0, full.w, full.h);
  }

  private animateCamera(): void {
    if (this.frame !== undefined) return;
    this.lastFrame = performance.now();
    const step = (t: number): void => {
      const s = this.status();
      if (!s || SCREENS[this.screen]!.id !== 'camera') return;
      const dt = Math.min(100, t - this.lastFrame);
      this.lastFrame = t;
      drawCamera(this.ctx, { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height }, t, sunElevation(s.position, Date.now()), s.speedKt / 500, dt);
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private hudHtml(id: ScreenId, f: Active, s: FlightStatus): string {
    const fmt = this.fmt;
    const now = Date.now();
    const toOffset = this.weather.to?.utcOffsetSec;
    const local = (t: number, offset: number | undefined): string =>
      offset === undefined ? `${fmt.time(t)} UTC` : fmt.time(t, offset);
    const eta = now + s.remainingMs;
    const fromCode = esc(f.from.iata || f.from.icao);
    const toCode = esc(f.to.iata || f.to.icao);
    const title = `<div class="ife-bar top"><b>${esc(f.info.flightNo)}</b><span>${esc(f.from.city)} → ${esc(f.to.city)}</span></div>`;
    const pct = Math.round(s.progress * 100);
    const track = `<div class="ife-track"><span>${fromCode}</span><div class="ife-progress"><i style="width:${pct}%"></i><svg style="left:${pct}%"><use href="#i-plane" /></svg></div><span>${toCode}</span></div>`;
    const row = (k: string, v: string): string => `<div class="ife-row"><span>${k}</span><b>${v}</b></div>`;
    const phase = { climb: 'Climbing', cruise: 'Cruising', descent: 'Descending', arrived: 'Arrived' }[s.phase];

    switch (id) {
      case 'map':
        return `${title}<div class="ife-bar bottom"><span>UTC ${fmt.time(now)}</span><span>ETA ${local(eta, toOffset)}</span><span>${duration(s.remainingMs)} to go</span></div>`;
      case 'progress':
        return `${title}<div class="ife-panel"><h3>Flight progress · ${pct}%</h3>${track}
          ${row('Departure', `${local(f.departedAt, this.weather.fromOffset)} ${fromCode}`)}
          ${row('Arrival (estimated)', `${local(eta, toOffset)} ${toCode}`)}
          ${row('Flight time', duration(s.durationMs))}
          ${row('Elapsed', duration(s.elapsedMs))}
          ${row('Remaining', duration(s.remainingMs))}</div>`;
      case 'mini':
        return `<div class="ife-side"><b class="ife-flight">${esc(f.info.flightNo)}</b>
          ${row('Altitude', fmt.altitude(s.altFt))}
          ${row('Ground speed', fmt.speed(s.speedKt))}
          ${row('Heading', `${Math.round(s.headingDeg)}° ${compass(s.headingDeg)}`)}
          ${row('Distance to go', fmt.distance(s.leftKm))}
          ${row('ETA', local(eta, toOffset))}</div>`;
      case 'altspeed':
        return `${title}<div class="ife-panel ife-gauges">
          <div><span>Altitude</span><b>${fmt.altitude(s.altFt)}</b><small>${phase}</small></div>
          <div><span>Ground speed</span><b>${fmt.speed(s.speedKt)}</b><small>${esc(f.info.aircraft || f.info.typeCode)}</small></div>
          <div><span>Outside air</span><b>${fmt.temp(isaTempC(s.altFt))}</b><small>Heading ${Math.round(s.headingDeg)}° ${compass(s.headingDeg)}</small></div></div>`;
      case 'weather': {
        const wx = this.weather.to;
        if (!wx) {
          return `${title}<div class="ife-panel"><h3>Weather in ${esc(f.to.city)}</h3><p class="ife-note">Weather information is not available right now.</p></div>`;
        }
        const { label, icon } = describeWeather(wx.code, wx.isDay);
        return `${title}<div class="ife-panel ife-weather"><h3>Weather in ${esc(f.to.city)}</h3>
          <div class="ife-wx"><span class="ife-icon">${icon}</span><b>${fmt.temp(wx.tempC)}</b><span>${label}</span></div>
          ${row('Local time', `${fmt.time(now, wx.utcOffsetSec)} ${esc(wx.timezone)}`)}
          ${row('Wind', `${compass(wx.windDir)} ${fmt.wind(wx.windKmh)}`)}
          ${row('Humidity', `${Math.round(wx.humidity)}%`)}</div>`;
      }
      case 'remaining':
        return `${title}<div class="ife-panel"><h3>Arriving in ${esc(f.to.city)}</h3>${track}
          <div class="ife-big"><div><span>Time to destination</span><b>${duration(s.remainingMs)}</b></div>
          <div><span>Distance to destination</span><b>${fmt.distance(s.leftKm)}</b></div></div>
          ${row('Distance travelled', fmt.distance(s.flownKm))}</div>`;
      case 'camera':
        return `<div class="ife-cam"><span class="rec"></span>TAIL CAMERA<span>${fmt.time(now)} UTC</span></div>`;
    }
  }
}

export const snapshotDate = (): string => snapshot.generatedAt.slice(0, 10);
