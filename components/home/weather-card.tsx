'use client';

import { useEffect, useState } from 'react';
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSun, Droplets, LoaderCircle, MapPin, Moon, Snowflake, Sun } from 'lucide-react';
import type { BriefWeather } from '@/lib/home/brief';

type WeatherResponse = BriefWeather & { feelsLike: number; humidity: number; windSpeed: number; isDay: boolean; place: string | null; stale: boolean };

type State =
  | { status: 'loading' }
  | { status: 'ready'; weather: WeatherResponse; place: string }
  | { status: 'needs-city' }
  | { status: 'error'; message: string };

function WeatherIcon({ code, isDay }: { code: number; isDay: boolean }) {
  const props = { size: 30, 'aria-hidden': true } as const;
  if (code >= 95) return <CloudLightning {...props} />;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return <Snowflake {...props} />;
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return <CloudRain {...props} />;
  if (code >= 51 && code <= 57) return <CloudDrizzle {...props} />;
  if (code === 45 || code === 48) return <CloudFog {...props} />;
  if (code === 3) return <Cloud {...props} />;
  if (code >= 1) return <CloudSun {...props} />;
  return isDay ? <Sun {...props} /> : <Moon {...props} />;
}

async function fetchWeather(query: string) {
  const response = await fetch(`/api/weather${query}`, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function currentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8_000, maximumAge: 30 * 60 * 1000 });
  });
}

export function WeatherCard({ onWeather, openPersonal }: { onWeather: (weather: BriefWeather | null) => void; openPersonal: () => void }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let result: Awaited<ReturnType<typeof fetchWeather>> | null = null;
      let place = 'Your location';
      try {
        const position = await currentPosition();
        result = await fetchWeather(`?lat=${position.coords.latitude.toFixed(3)}&lon=${position.coords.longitude.toFixed(3)}`);
      } catch {
        // Location denied or unavailable: use the saved home city instead.
      }
      if (!result || result.status !== 200) {
        result = await fetchWeather('').catch(() => null);
        place = result?.body?.place ?? place;
      }
      if (cancelled) return;
      if (result?.status === 200) {
        setState({ status: 'ready', weather: result.body as WeatherResponse, place });
        onWeather(result.body as WeatherResponse);
      } else if (result?.status === 404) {
        setState({ status: 'needs-city' });
      } else {
        setState({ status: 'error', message: result?.body?.error ?? 'Weather is unavailable right now.' });
      }
    })();
    return () => { cancelled = true; };
  }, [onWeather]);

  if (state.status === 'loading') {
    return <section className="weather-card loading"><LoaderCircle className="workbook-spinner" size={16} /><span>Checking the weather…</span></section>;
  }
  if (state.status === 'needs-city') {
    return (
      <button type="button" className="weather-card empty" onClick={openPersonal}>
        <MapPin size={18} aria-hidden="true" />
        <span><strong>See your local weather</strong><small>Allow location, or set your home city in Personal.</small></span>
      </button>
    );
  }
  if (state.status === 'error') {
    return <section className="weather-card empty"><Cloud size={18} aria-hidden="true" /><span><strong>Weather</strong><small>{state.message}</small></span></section>;
  }

  const { weather, place } = state;
  return (
    <section className={`weather-card ${weather.isDay ? 'day' : 'night'}`} aria-label={`Weather: ${weather.temperature} degrees, ${weather.condition}`}>
      <div className="weather-main">
        <WeatherIcon code={weather.weatherCode} isDay={weather.isDay} />
        <div>
          <strong>{weather.temperature}°C</strong>
          <span>{weather.condition}</span>
        </div>
      </div>
      <div className="weather-meta">
        <small><MapPin size={11} aria-hidden="true" />{place}</small>
        <small>Feels like {weather.feelsLike}°</small>
        <small><Droplets size={11} aria-hidden="true" />{weather.rainProbability}% chance of rain</small>
      </div>
    </section>
  );
}
