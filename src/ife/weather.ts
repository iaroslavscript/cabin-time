import type { LatLon } from './geo.ts';

export interface Weather {
  tempC: number;
  code: number;
  windKmh: number;
  windDir: number;
  humidity: number;
  isDay: boolean;
  /** Destination UTC offset in seconds, used for local arrival time. */
  utcOffsetSec: number;
  timezone: string;
}

const API = 'https://api.open-meteo.com/v1/forecast';

export const fetchWeather = async (at: LatLon, signal?: AbortSignal): Promise<Weather> => {
  const params = new URLSearchParams({
    latitude: at.lat.toFixed(3),
    longitude: at.lon.toFixed(3),
    current: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,relative_humidity_2m,is_day',
    timezone: 'auto',
  });
  const res = await fetch(`${API}?${params}`, { signal });
  if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
  const data = (await res.json()) as {
    utc_offset_seconds: number;
    timezone_abbreviation?: string;
    timezone?: string;
    current: Record<string, number>;
  };
  const c = data.current;
  return {
    tempC: c.temperature_2m ?? NaN,
    code: c.weather_code ?? 0,
    windKmh: c.wind_speed_10m ?? 0,
    windDir: c.wind_direction_10m ?? 0,
    humidity: c.relative_humidity_2m ?? 0,
    isDay: c.is_day !== 0,
    utcOffsetSec: data.utc_offset_seconds ?? 0,
    timezone: data.timezone_abbreviation || data.timezone || 'UTC',
  };
};

/** WMO weather interpretation codes (as used by Open-Meteo) → label and icon. */
export const describeWeather = (code: number, isDay = true): { label: string; icon: string } => {
  const sun = isDay ? '☀️' : '🌙';
  if (code === 0) return { label: 'Clear sky', icon: sun };
  if (code <= 2) return { label: 'Partly cloudy', icon: isDay ? '⛅' : '☁️' };
  if (code === 3) return { label: 'Overcast', icon: '☁️' };
  if (code <= 48) return { label: 'Fog', icon: '🌫️' };
  if (code <= 57) return { label: 'Drizzle', icon: '🌦️' };
  if (code <= 67) return { label: 'Rain', icon: '🌧️' };
  if (code <= 77) return { label: 'Snow', icon: '🌨️' };
  if (code <= 82) return { label: 'Rain showers', icon: '🌦️' };
  if (code <= 86) return { label: 'Snow showers', icon: '🌨️' };
  return { label: 'Thunderstorm', icon: '⛈️' };
};

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg: number): string => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
