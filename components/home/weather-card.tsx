'use client';

import { useEffect, useState } from 'react';
import { Cloud, LoaderCircle, MapPin } from 'lucide-react';
import type { BriefWeather } from '@/lib/home/weather';

type WeatherResponse = BriefWeather & { place: string | null; stale: boolean };

type State =
  | { status: 'loading' }
  | { status: 'ready'; weather: WeatherResponse; place: string }
  | { status: 'needs-city' }
  | { status: 'error'; message: string };

// Home remounts on every tab switch; reuse the last result for 10 minutes.
let lastResult: { at: number; state: State; weather: BriefWeather | null } | null = null;
const CLIENT_TTL_MS = 10 * 60 * 1000;

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
  const [state, setState] = useState<State>(() => (lastResult && Date.now() - lastResult.at < CLIENT_TTL_MS ? lastResult.state : { status: 'loading' }));

  useEffect(() => {
    if (lastResult && Date.now() - lastResult.at < CLIENT_TTL_MS) {
      if (lastResult.weather) onWeather(lastResult.weather);
      return;
    }
    let cancelled = false;
    const remember = (next: State, weather: BriefWeather | null) => {
      lastResult = { at: Date.now(), state: next, weather };
      setState(next);
    };
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
      if (result?.status === 200 && result.body?.needsCity) {
        remember({ status: 'needs-city' }, null);
      } else if (result?.status === 200) {
        remember({ status: 'ready', weather: result.body as WeatherResponse, place }, result.body as WeatherResponse);
        onWeather(result.body as WeatherResponse);
      } else {
        // Errors are not cached, so the next visit retries.
        setState({ status: 'error', message: result?.body?.error ?? 'Weather is unavailable right now.' });
      }
    })();
    return () => { cancelled = true; };
  }, [onWeather]);

  // Weather is a line of text on Home, not a card: one number and the two facts
  // that change what you'd do about it.
  if (state.status === 'loading') {
    return <p className="fd-weather-quiet" role="status"><LoaderCircle className="workbook-spinner" size={14} /> Checking the weather…</p>;
  }
  if (state.status === 'needs-city') {
    return (
      <button type="button" className="fd-weather-quiet fd-weather-button" onClick={openPersonal}>
        <MapPin size={14} aria-hidden="true" /> Allow location, or set your home city, for local weather.
      </button>
    );
  }
  if (state.status === 'error') {
    return <p className="fd-weather-quiet"><Cloud size={14} aria-hidden="true" /> {state.message}</p>;
  }

  const { weather, place } = state;
  // A forecast always names the hour it is about. A bare "100% chance of rain"
  // next to a dry window is what made this line untrustworthy.
  const peak = weather.rain.peak;
  const rain = weather.rainingNow
    ? peak && peak.probability >= 40 ? `raining, ${peak.probability}% again by ${peak.hour}` : 'raining now'
    : peak && peak.probability >= 50
      ? `${peak.probability}% rain around ${peak.hour}`
      : peak && peak.probability > 0
        ? `mostly dry, ${peak.probability}% at most`
        : 'no rain in the next 12 hours';
  return (
    <section className="fd-weather" aria-label={`Weather: ${weather.temperature} degrees, ${weather.condition}, ${rain}`}>
      <b>{weather.temperature}°</b>
      <div>
        {/* Two short lines with room between them, rather than one dense run of
            middots: the condition and what to expect, then where and how it feels. */}
        <p>{weather.condition}, {rain}</p>
        <p className="fd-weather-meta">
          <span>Feels {weather.feelsLike}°</span>
          <span>{weather.humidity}% humidity</span>
          <span>{weather.windSpeed} km/h</span>
          <span>{place}</span>
        </p>
      </div>
    </section>
  );
}
