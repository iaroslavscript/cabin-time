import { merge, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import worldUrl from 'world-atlas/countries-50m.json?url';
import { greatCircle, mercatorY, subSolarPoint, terminatorLat, type LatLon } from './geo.ts';
import type { City } from './types.ts';

/** A ring/line as flat [lon, lat, lon, lat, …] with its bounding box. */
interface Shape {
  pts: Float32Array;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

export interface World {
  land: Shape[];
  borders: Shape[];
}

const toShape = (coords: number[][]): Shape => {
  const pts = new Float32Array(coords.length * 2);
  let minLon = 180;
  let maxLon = -180;
  let minLat = 90;
  let maxLat = -90;
  coords.forEach(([lon, lat], i) => {
    pts[i * 2] = lon!;
    pts[i * 2 + 1] = lat!;
    minLon = Math.min(minLon, lon!);
    maxLon = Math.max(maxLon, lon!);
    minLat = Math.min(minLat, lat!);
    maxLat = Math.max(maxLat, lat!);
  });
  return { pts, minLon, maxLon, minLat, maxLat };
};

let worldPromise: Promise<World> | undefined;
export const loadWorld = (): Promise<World> =>
  (worldPromise ??= fetch(worldUrl)
    .then((r) => r.json() as Promise<Topology<{ countries: GeometryCollection }>>)
    .then((topo) => {
      const countries = topo.objects.countries;
      const land = merge(topo, countries.geometries as never);
      const borders = mesh(topo, countries, (a, b) => a !== b);
      return {
        land: land.coordinates.flatMap((poly) => poly.map(toShape)),
        borders: borders.coordinates.map(toShape),
      };
    }));

/** A Mercator view: centre (lon, mercator y) and pixels per degree. */
export interface View {
  lon: number;
  y: number;
  scale: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const fitView = (points: LatLon[], rect: Rect, minSpanDeg: number, pad = 0.18): View => {
  const lons = points.map((p) => p.lon);
  const ys = points.map((p) => mercatorY(p.lat));
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanLon = Math.max(minSpanDeg, maxLon - minLon);
  const spanY = Math.max(minSpanDeg * 0.6, maxY - minY);
  const scale = Math.min((rect.w * (1 - 2 * pad)) / spanLon, (rect.h * (1 - 2 * pad)) / spanY);
  return { lon: (minLon + maxLon) / 2, y: (minY + maxY) / 2, scale };
};

export interface MapOverlay {
  from: LatLon & { code: string };
  to: LatLon & { code: string };
  position: LatLon;
  progress: number;
  headingDeg: number;
  cities: City[];
  time: number;
  /** Relative label size; 1 = normal. */
  labelScale?: number;
  /** Areas covered by other UI where no city labels go. */
  reserved?: Rect[];
}

const PALETTE = {
  oceanTop: '#0b2a5c',
  oceanBottom: '#123d7a',
  land: '#c9a96a',
  landEdge: '#8b6c3a',
  border: 'rgb(90 60 30 / 0.55)',
  grid: 'rgb(170 200 255 / 0.13)',
  night: 'rgb(2 6 30 / 0.42)',
  flown: '#ffd23f',
  ahead: 'rgb(255 255 255 / 0.85)',
  label: '#f3f0e6',
};

export const drawMap = (ctx: CanvasRenderingContext2D, rect: Rect, view: View, world: World | undefined, o: MapOverlay): void => {
  const { x: rx, y: ry, w, h } = rect;
  const cx = rx + w / 2;
  const cy = ry + h / 2;
  const px = (lon: number): number => cx + (lon - view.lon) * view.scale;
  const py = (lat: number): number => cy - (mercatorY(lat) - view.y) * view.scale;
  const lonMin = view.lon - w / 2 / view.scale;
  const lonMax = view.lon + w / 2 / view.scale;
  const yMin = view.y - h / 2 / view.scale;
  const yMax = view.y + h / 2 / view.scale;
  const unit = Math.min(w, h * 1.6) / 100;
  const label = (o.labelScale ?? 1) * unit;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rx, ry, w, h);
  ctx.clip();

  const sea = ctx.createLinearGradient(0, ry, 0, ry + h);
  sea.addColorStop(0, PALETTE.oceanTop);
  sea.addColorStop(1, PALETTE.oceanBottom);
  ctx.fillStyle = sea;
  ctx.fillRect(rx, ry, w, h);

  // Graticule.
  const step = view.scale > 60 ? 2 : view.scale > 20 ? 5 : view.scale > 6 ? 10 : 30;
  ctx.strokeStyle = PALETTE.grid;
  ctx.lineWidth = Math.max(1, unit * 0.12);
  ctx.beginPath();
  for (let lon = Math.ceil(lonMin / step) * step; lon <= lonMax; lon += step) {
    ctx.moveTo(px(lon), ry);
    ctx.lineTo(px(lon), ry + h);
  }
  for (let lat = -80; lat <= 80; lat += step) {
    const y = py(lat);
    if (y < ry || y > ry + h) continue;
    ctx.moveTo(rx, y);
    ctx.lineTo(rx + w, y);
  }
  ctx.stroke();

  // The world repeats every 360°; draw the copies that are visible.
  const shifts = [-360, 0, 360].filter((s) => lonMax > -180 + s && lonMin < 180 + s);
  const visible = (s: Shape, shift: number): boolean =>
    s.maxLon + shift >= lonMin && s.minLon + shift <= lonMax && mercatorY(s.maxLat) >= yMin && mercatorY(s.minLat) <= yMax;
  const trace = (s: Shape, shift: number, close: boolean): void => {
    const p = s.pts;
    ctx.moveTo(px(p[0]! + shift), py(p[1]!));
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(px(p[i]! + shift), py(p[i + 1]!));
    if (close) ctx.closePath();
  };

  if (world) {
    ctx.beginPath();
    for (const shift of shifts) for (const s of world.land) if (visible(s, shift)) trace(s, shift, true);
    const landFill = ctx.createLinearGradient(0, ry, 0, ry + h);
    landFill.addColorStop(0, '#d7bd84');
    landFill.addColorStop(1, PALETTE.land);
    ctx.fillStyle = landFill;
    ctx.fill('evenodd');
    ctx.strokeStyle = PALETTE.landEdge;
    ctx.lineWidth = Math.max(1, unit * 0.15);
    ctx.stroke();

    ctx.beginPath();
    for (const shift of shifts) for (const s of world.borders) if (visible(s, shift)) trace(s, shift, false);
    ctx.strokeStyle = PALETTE.border;
    ctx.lineWidth = Math.max(0.8, unit * 0.12);
    ctx.setLineDash([unit * 0.6, unit * 0.4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Night side of the day/night line.
  const sun = subSolarPoint(o.time);
  ctx.beginPath();
  const edge = sun.lat > 0 ? ry + h : ry;
  ctx.moveTo(rx, edge);
  for (let x = rx; x <= rx + w + 4; x += 4) {
    const lon = view.lon + (x - cx) / view.scale;
    ctx.lineTo(x, py(terminatorLat(lon, sun)));
  }
  ctx.lineTo(rx + w, edge);
  ctx.closePath();
  ctx.fillStyle = PALETTE.night;
  ctx.fill();

  // Cities, most important first, skipping any that would overlap.
  const taken: Rect[] = [];
  const overlaps = (r: Rect): boolean =>
    taken.some((t) => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y);
  const placeLabel = (text: string, x: number, y: number, size: number, color: string, bold = false): boolean => {
    ctx.font = `${bold ? 700 : 500} ${size}px system-ui, Roboto, sans-serif`;
    const tw = ctx.measureText(text).width;
    const r = { x: x + size * 0.45, y: y - size * 0.6, w: tw + size * 0.2, h: size * 1.2 };
    if (r.x + r.w > rx + w) r.x = x - size * 0.45 - r.w;
    if (overlaps(r)) return false;
    taken.push(r);
    ctx.lineWidth = size * 0.22;
    ctx.strokeStyle = 'rgb(0 0 0 / 0.55)';
    ctx.strokeText(text, r.x, y + size * 0.35);
    ctx.fillStyle = color;
    ctx.fillText(text, r.x, y + size * 0.35);
    return true;
  };

  const ends = [o.from, o.to].map((a) => ({ ...a, x: px(unwrap(a.lon, view.lon)), y: py(a.lat) }));
  const plane = { x: px(unwrap(o.position.lon, view.lon)), y: py(o.position.lat) };
  // Airport codes always show; then keep cities clear of the aircraft.
  for (const e of ends) placeLabel(e.code, e.x, e.y, label * 3.4, '#ffffff', true);
  taken.push(...(o.reserved ?? []));
  taken.push({ x: plane.x - unit * 3, y: plane.y - unit * 3, w: unit * 6, h: unit * 6 });

  const maxCities = Math.round((w * h) / (unit * unit * 260));
  let shown = 0;
  for (const [name, lat, lon] of o.cities) {
    if (shown >= maxCities) break;
    const x = px(unwrap(lon, view.lon));
    const y = py(lat);
    if (x < rx + unit || x > rx + w - unit || y < ry + unit || y > ry + h - unit) continue;
    if (ends.some((e) => Math.hypot(e.x - x, e.y - y) < unit * 2)) continue;
    if (!placeLabel(name, x, y, label * 2.2, PALETTE.label)) continue;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.5, label * 0.45), 0, Math.PI * 2);
    ctx.fill();
    shown++;
  }

  // Route: flown part solid, the rest dashed.
  const path = greatCircle(o.from, o.to, 96).map((p) => ({ x: px(p.lon - o.from.lon + unwrap(o.from.lon, view.lon)), y: py(p.lat) }));
  const split = Math.round(o.progress * (path.length - 1));
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, unit * 0.55);
  ctx.strokeStyle = PALETTE.ahead;
  ctx.setLineDash([unit * 1.2, unit * 1]);
  ctx.beginPath();
  path.slice(split).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = PALETTE.flown;
  ctx.lineWidth = Math.max(2.5, unit * 0.75);
  ctx.beginPath();
  path.slice(0, split + 1).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.lineTo(plane.x, plane.y);
  ctx.stroke();

  for (const e of ends) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#123';
    ctx.lineWidth = Math.max(1, unit * 0.3);
    ctx.beginPath();
    ctx.arc(e.x, e.y, Math.max(3, unit * 0.9), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  drawPlane(ctx, plane.x, plane.y, unit * 4.2 * (o.labelScale ?? 1), o.headingDeg);
  ctx.restore();
};

/** Longitude shifted by whole turns to be closest to the view centre. */
const unwrap = (lon: number, centre: number): number => lon + Math.round((centre - lon) / 360) * 360;

export const drawPlane = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, headingDeg: number): void => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((headingDeg * Math.PI) / 180);
  ctx.scale(size / 24, size / 24);
  ctx.beginPath();
  // Top view of an airliner pointing up (north), 24 units long.
  ctx.moveTo(0, -12);
  ctx.bezierCurveTo(1.3, -11, 1.4, -9, 1.4, -7);
  ctx.lineTo(1.4, -2.2);
  ctx.lineTo(11, 3.2);
  ctx.lineTo(11, 5);
  ctx.lineTo(1.4, 2.2);
  ctx.lineTo(1.2, 8);
  ctx.lineTo(4.4, 10.6);
  ctx.lineTo(4.4, 12);
  ctx.lineTo(0, 10.8);
  ctx.lineTo(-4.4, 12);
  ctx.lineTo(-4.4, 10.6);
  ctx.lineTo(-1.2, 8);
  ctx.lineTo(-1.4, 2.2);
  ctx.lineTo(-11, 5);
  ctx.lineTo(-11, 3.2);
  ctx.lineTo(-1.4, -2.2);
  ctx.lineTo(-1.4, -7);
  ctx.bezierCurveTo(-1.4, -9, -1.3, -11, 0, -12);
  ctx.closePath();
  ctx.shadowColor = 'rgb(0 0 0 / 0.6)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = '#d62';
  ctx.stroke();
  ctx.restore();
};
