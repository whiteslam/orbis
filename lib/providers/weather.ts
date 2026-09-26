import 'server-only';

import { cached } from '@/lib/providers/cache';
import { ProviderError, providerJson, type Fetched } from '@/lib/providers/core';

export type Weather = {
  temperature: number;
  feelsLike: number;
  humidity: number;
  weatherCode: number;
  windSpeed: number;
  condition: string;
  isDay: boolean;
  /** True when the current code is actual precipitation, not a forecast of it. */
  rainingNow: boolean;
  /**
   * The rain outlook for the next 12 hours.
   *
   * `peak` is the worst single hour and the hour it falls in — never a bare
   * maximum presented as though it were the chance right now, which is what
   * this field replaced. `soon` is the next hour, for "is it about to start".
   */
  rain: {
    soon: number;
    peak: { probability: number; hour: string } | null;
  };
};

// WMO weather interpretation codes, as used by Open-Meteo.
function describe(code: number) {
  if (code === 0) return 'Clear sky';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code >= 85 && code <= 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Mixed weather';
}

type ForecastResponse = {
  current?: { time?: string; temperature_2m?: number; apparent_temperature?: number; relative_humidity_2m?: number; weather_code?: number; wind_speed_10m?: number; is_day?: number };
  hourly?: { time?: string[]; precipitation_probability?: Array<number | null> };
};

/** Codes 51-67 and 80-99 are precipitation falling now, not a chance of it. */
const PRECIPITATING = (code: number) => (code >= 51 && code <= 67) || (code >= 80 && code <= 99);

/** "2026-09-25T21:00" → "9 pm", the hour a forecast actually refers to. */
function hourLabel(iso: string) {
  const hour = Number(iso.slice(11, 13));
  if (!Number.isFinite(hour)) return iso;
  if (hour === 0) return 'midnight';
  if (hour === 12) return 'noon';
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

/** How many hours ahead the rain outlook looks. */
const RAIN_WINDOW_HOURS = 12;

export async function getWeather(latitude: number, longitude: number): Promise<Fetched<Weather>> {
  const lat = Math.round(latitude * 100) / 100;
  const lon = Math.round(longitude * 100) / 100;
  return cached('open_meteo', `weather:${lat},${lon}`, 30 * 60, async () => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day'
      // Two days, so an outlook taken at 11pm still has a full window ahead of
      // it instead of stopping at midnight.
      + '&hourly=precipitation_probability&forecast_days=2&timezone=auto';
    const body = await providerJson<ForecastResponse>('open_meteo', url);
    const current = body.current;
    if (!current || typeof current.temperature_2m !== 'number' || typeof current.weather_code !== 'number') throw new ProviderError('open_meteo', 'unavailable');

    // The next 12 hours, kept as hours rather than collapsed to one number, so
    // a single wet hour cannot be reported as the chance of rain right now.
    const nowHour = current.time?.slice(0, 13) ?? '';
    const times = body.hourly?.time ?? [];
    const chances = body.hourly?.precipitation_probability ?? [];
    const window = times
      .map((time, index) => ({ time, probability: chances[index] }))
      .filter((entry): entry is { time: string; probability: number } => typeof entry.probability === 'number' && entry.time.slice(0, 13) >= nowHour)
      .slice(0, RAIN_WINDOW_HOURS);
    const worst = window.reduce<{ time: string; probability: number } | null>(
      (best, entry) => (best === null || entry.probability > best.probability ? entry : best),
      null,
    );

    return {
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature ?? current.temperature_2m),
      humidity: Math.round(current.relative_humidity_2m ?? 0),
      weatherCode: current.weather_code,
      windSpeed: Math.round(current.wind_speed_10m ?? 0),
      condition: describe(current.weather_code),
      isDay: current.is_day !== 0,
      rainingNow: PRECIPITATING(current.weather_code),
      rain: {
        soon: window[0]?.probability ?? 0,
        peak: worst && worst.probability > 0 ? { probability: worst.probability, hour: hourLabel(worst.time) } : null,
      },
    };
  });
}

export async function geocodeCity(name: string) {
  const body = await providerJson<{ results?: Array<{ name: string; admin1?: string; country_code?: string; latitude: number; longitude: number }> }>(
    'open_meteo',
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`,
  );
  const match = body.results?.[0];
  if (!match) throw new ProviderError('open_meteo', 'invalid_request');
  return {
    city: [match.name, match.admin1, match.country_code].filter(Boolean).join(', ').slice(0, 120),
    latitude: match.latitude,
    longitude: match.longitude,
  };
}
