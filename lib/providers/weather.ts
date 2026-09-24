import 'server-only';

import { cached } from '@/lib/providers/cache';
import { ProviderError, providerJson, type Fetched } from '@/lib/providers/core';

export type Weather = {
  temperature: number;
  feelsLike: number;
  humidity: number;
  rainProbability: number;
  weatherCode: number;
  windSpeed: number;
  condition: string;
  isDay: boolean;
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

export async function getWeather(latitude: number, longitude: number): Promise<Fetched<Weather>> {
  const lat = Math.round(latitude * 100) / 100;
  const lon = Math.round(longitude * 100) / 100;
  return cached('open_meteo', `weather:${lat},${lon}`, 30 * 60, async () => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day'
      + '&hourly=precipitation_probability&forecast_days=1&timezone=auto';
    const body = await providerJson<ForecastResponse>('open_meteo', url);
    const current = body.current;
    if (!current || typeof current.temperature_2m !== 'number' || typeof current.weather_code !== 'number') throw new ProviderError('open_meteo', 'unavailable');

    // Highest chance of rain over the rest of today.
    const nowHour = current.time?.slice(0, 13) ?? '';
    const times = body.hourly?.time ?? [];
    const chances = body.hourly?.precipitation_probability ?? [];
    const upcoming = chances.filter((value, index) => typeof value === 'number' && (times[index] ?? '') >= nowHour) as number[];

    return {
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature ?? current.temperature_2m),
      humidity: Math.round(current.relative_humidity_2m ?? 0),
      rainProbability: upcoming.length ? Math.max(...upcoming) : 0,
      weatherCode: current.weather_code,
      windSpeed: Math.round(current.wind_speed_10m ?? 0),
      condition: describe(current.weather_code),
      isDay: current.is_day !== 0,
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
