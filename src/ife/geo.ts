export const EARTH_KM = 6371;
const RAD = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

export const normLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

export const distanceKm = (a: LatLon, b: LatLon): number => {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Initial great-circle bearing from a to b, degrees clockwise from north. */
export const bearingDeg = (a: LatLon, b: LatLon): number => {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const Δλ = (b.lon - a.lon) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / RAD + 360) % 360;
};

/** Point at fraction f (0..1) along the great circle from a to b. */
export const interpolate = (a: LatLon, b: LatLon, f: number): LatLon => {
  const δ = distanceKm(a, b) / EARTH_KM;
  if (δ < 1e-9) return { ...a };
  const φ1 = a.lat * RAD;
  const λ1 = a.lon * RAD;
  const φ2 = b.lat * RAD;
  const λ2 = b.lon * RAD;
  const A = Math.sin((1 - f) * δ) / Math.sin(δ);
  const B = Math.sin(f * δ) / Math.sin(δ);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / RAD, lon: Math.atan2(y, x) / RAD };
};

/** Great-circle path as a list of points, longitudes unwrapped so the line never jumps across the antimeridian. */
export const greatCircle = (a: LatLon, b: LatLon, steps = 64): LatLon[] => {
  const pts: LatLon[] = [];
  let prev = a.lon;
  for (let i = 0; i <= steps; i++) {
    const p = interpolate(a, b, i / steps);
    let lon = p.lon;
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    prev = lon;
    pts.push({ lat: p.lat, lon });
  }
  return pts;
};

/** Distance of p from the great circle a→b (km) and how far along it p lies (fraction of a→b). */
export const trackOffset = (a: LatLon, b: LatLon, p: LatLon): { crossKm: number; along: number } => {
  const d13 = distanceKm(a, p) / EARTH_KM;
  const θ13 = bearingDeg(a, p) * RAD;
  const θ12 = bearingDeg(a, b) * RAD;
  const cross = Math.asin(Math.sin(d13) * Math.sin(θ13 - θ12));
  const along = Math.acos(Math.min(1, Math.max(-1, Math.cos(d13) / Math.cos(cross))));
  const total = distanceKm(a, b) / EARTH_KM;
  const sign = Math.cos(θ13 - θ12) < 0 ? -1 : 1;
  return { crossKm: Math.abs(cross) * EARTH_KM, along: total > 0 ? (sign * along) / total : 0 };
};

/** Sub-solar point (where the sun is overhead) for a moment in time; accurate to a fraction of a degree. */
export const subSolarPoint = (time: number): LatLon => {
  const days = time / 86_400_000 - 10_957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * days) * RAD;
  const q = 280.459 + 0.98564736 * days;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const ε = (23.439 - 0.00000036 * days) * RAD;
  const decl = Math.asin(Math.sin(ε) * Math.sin(L)) / RAD;
  const ra = Math.atan2(Math.cos(ε) * Math.sin(L), Math.cos(L)) / RAD;
  const eqTimeDeg = normLon(q - ra);
  const utcHours = (((time / 3_600_000) % 24) + 24) % 24;
  return { lat: decl, lon: normLon(-15 * (utcHours - 12) - eqTimeDeg) };
};

/** Sun elevation above the horizon in degrees. */
export const sunElevation = (p: LatLon, time: number): number => {
  const s = subSolarPoint(time);
  const cosZ =
    Math.sin(p.lat * RAD) * Math.sin(s.lat * RAD) +
    Math.cos(p.lat * RAD) * Math.cos(s.lat * RAD) * Math.cos((p.lon - s.lon) * RAD);
  return Math.asin(Math.max(-1, Math.min(1, cosZ))) / RAD;
};

/** Latitude of the day/night line at a longitude, given the sub-solar point. */
export const terminatorLat = (lon: number, sun: LatLon): number => {
  const decl = Math.abs(sun.lat) < 0.01 ? 0.01 : sun.lat;
  return Math.atan(-Math.cos((lon - sun.lon) * RAD) / Math.tan(decl * RAD)) / RAD;
};

export const mercatorY = (lat: number): number => {
  const φ = Math.max(-85, Math.min(85, lat)) * RAD;
  return Math.log(Math.tan(Math.PI / 4 + φ / 2)) / RAD;
};
