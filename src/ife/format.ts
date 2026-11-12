import type { Clock, Units } from '../prefs.ts';

const nf = (digits = 0) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits });

export interface Formatter {
  distance: (km: number) => string;
  altitude: (ft: number) => string;
  speed: (kt: number) => string;
  temp: (c: number) => string;
  wind: (kmh: number) => string;
  /** Wall-clock time at a UTC offset (seconds). */
  time: (epochMs: number, offsetSec?: number) => string;
}

export const duration = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 60_000));
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
};

export const formatter = (units: Units, clock: Clock): Formatter => {
  const metric = units === 'metric';
  return {
    distance: (km) => (metric ? `${nf().format(km)} km` : `${nf().format(km * 0.621371)} mi`),
    altitude: (ft) => (metric ? `${nf().format(Math.round(ft * 0.3048 / 10) * 10)} m` : `${nf().format(Math.round(ft / 10) * 10)} ft`),
    speed: (kt) => (metric ? `${nf().format(kt * 1.852)} km/h` : `${nf().format(kt * 1.15078)} mph`),
    temp: (c) => (metric ? `${nf().format(c)} °C` : `${nf().format(c * 1.8 + 32)} °F`),
    wind: (kmh) => (metric ? `${nf().format(kmh)} km/h` : `${nf().format(kmh * 0.621371)} mph`),
    time: (epochMs, offsetSec = 0) => {
      const d = new Date(epochMs + offsetSec * 1000);
      const h = d.getUTCHours();
      const m = String(d.getUTCMinutes()).padStart(2, '0');
      if (clock === '24h') return `${String(h).padStart(2, '0')}:${m}`;
      return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
    },
  };
};
