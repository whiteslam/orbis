'use client';

import { useEffect, useState } from 'react';
import { Cloud, LoaderCircle, MapPin } from 'lucide-react';
import type { BriefWeather } from '@/lib/home/weather';
import type { WeatherPhase } from '@/lib/home/brief-gate';
import { skyFor } from '@/lib/home/glass';
import { curveLabels, curvePoints } from '@/lib/home/hours';
import { shared } from '@/lib/client/inflight';

type WeatherResponse = BriefWeather & { place: string | null; stale: boolean };

type State =
  | { status: 'loading' }
  | { status: 'ready'; weather: WeatherResponse; place: string }
  | { status: 'needs-city' }
  | { status: 'error'; message: string };

// Below this, a chance of rain is not worth a word.
const RAIN_WORTH_SAYING = 60;

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

/** Weather where the person is (or their home city): what the card should show, and the weather for the brief. */
async function loadWeather(): Promise<{ next: State; weather: WeatherResponse | null }> {
  let result: Awaited<ReturnType<typeof fetchWeather>> | null = null;
  let place = 'Your location';
  try {
    const position = await currentPosition();
    result = await fetchWeather(`?lat=${position.coords.latitude.toFixed(3)}&lon=${position.coords.longitude.toFixed(3)}`);
  } catch {
    // Location denied or unavailable: use the saved home city instead.
  }
  if (result?.status !== 200) {
    result = await fetchWeather('').catch(() => null);
    place = result?.body?.place ?? place;
  }
  if (result?.status === 200 && result.body?.needsCity) return { next: { status: 'needs-city' }, weather: null };
  if (result?.status === 200) {
    const weather = result.body as WeatherResponse;
    return { next: { status: 'ready', weather, place }, weather };
  }
  return { next: { status: 'error', message: result?.body?.error ?? 'Weather is unavailable right now.' }, weather: null };
}

/**
 * Rain is only mentioned when it is happening or likely. "Mostly dry, 10% at
 * most" on every clear day was noise, and a forecast always names its hour.
 */
function rainNote(weather: BriefWeather) {
  if (weather.rainingNow) return 'raining now';
  const peak = weather.rain.peak;
  if (peak && peak.probability >= RAIN_WORTH_SAYING) return `rain likely around ${peak.hour}`;
  return null;
}

export function WeatherCard({ onWeather, onPhase, openPersonal, variant = 'line' }: Readonly<{
  onWeather: (weather: BriefWeather | null) => void;
  onPhase?: (phase: WeatherPhase) => void;
  openPersonal: () => void;
  /** 'line' is Classic's one line of weather; 'glass' is the Glass view's tall widget. */
  variant?: 'line' | 'glass';
}>) {
  const [state, setState] = useState<State>(() => (lastResult && Date.now() - lastResult.at < CLIENT_TTL_MS ? lastResult.state : { status: 'loading' }));

  useEffect(() => {
    if (lastResult && Date.now() - lastResult.at < CLIENT_TTL_MS) {
      if (lastResult.weather) onWeather(lastResult.weather);
      return;
    }
    let cancelled = false;
    // Shared: a second card mounting meanwhile (Classic, then Glass) waits for this one.
    void shared('today-weather', loadWeather).then(({ next, weather }) => {
      if (weather) lastResult = { at: Date.now(), state: next, weather };
      else if (next.status === 'needs-city') lastResult = { at: Date.now(), state: next, weather: null };
      // Errors are not cached, so the next visit retries.
      if (cancelled) return;
      setState(next);
      if (weather) onWeather(weather);
    });
    return () => { cancelled = true; };
  }, [onWeather]);

  // Home waits for this before asking for the AI brief, so the brief is written
  // once, with the weather if there is any, rather than once before and once after.
  useEffect(() => { onPhase?.(state.status); }, [onPhase, state.status]);

  if (variant === 'glass') return <GlassWeather state={state} openPersonal={openPersonal} />;

  // Weather is a line of text on Home, not a card: one number and the two facts
  // that change what you'd do about it.
  if (state.status === 'loading') {
    return <output className="fd-weather-quiet"><LoaderCircle className="workbook-spinner" size={14} /> Checking the weather…</output>;
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
  const rain = rainNote(weather);
  const rainPart = rain ? `, ${rain}` : '';
  return (
    <section className="fd-weather" aria-label={`Weather: ${weather.temperature} degrees, ${weather.condition}${rainPart}`}>
      <b>{weather.temperature}°</b>
      <div>
        {/* Two short lines with room between them, rather than one dense run of
            middots: the condition and what to expect, then where and how it feels. */}
        <p>{weather.condition}{rain && `, ${rain}`}</p>
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

const CURVE_WIDTH = 420;
const CURVE_HEIGHT = 70;

/** The Glass view's weather: a tall frosted widget tinted by the sky, with the next hours as a curve. */
function GlassWeather({ state, openPersonal }: Readonly<{ state: State; openPersonal: () => void }>) {
  if (state.status !== 'ready') {
    let body;
    if (state.status === 'loading') body = <output className="fd-weather-quiet"><LoaderCircle className="workbook-spinner" size={14} /> Checking the weather…</output>;
    else if (state.status === 'needs-city') {
      body = (
        <button type="button" className="fd-weather-quiet fd-weather-button" onClick={openPersonal}>
          <MapPin size={14} aria-hidden="true" /> Allow location, or set your home city, for local weather.
        </button>
      );
    } else body = <p className="fd-weather-quiet"><Cloud size={14} aria-hidden="true" /> {state.message}</p>;
    return <section className="tg-weather" data-sky="clear" aria-label="Weather">{body}</section>;
  }

  const { weather, place } = state;
  const rain = rainNote(weather);
  // Entries cached before hourly temperatures existed have no hours: no curve then.
  const hours = weather.hours ?? [];
  const points = curvePoints(hours, CURVE_WIDTH, CURVE_HEIGHT);
  const first = hours[0];
  const last = hours.at(-1);
  return (
    <section className="tg-weather" data-sky={skyFor(weather)} aria-label={`Weather: ${weather.temperature} degrees, ${weather.condition}`}>
      <p className="tg-weather-place">{place}, {weather.condition.toLowerCase()}</p>
      <p className="tg-weather-temp">{weather.temperature}°</p>
      <p className="tg-weather-meta">Feels {weather.feelsLike}°, humidity {weather.humidity}%, wind {weather.windSpeed} km/h</p>
      {points.length > 0 && first && last && (
        <div className="tg-curve">
          <svg viewBox={`0 0 ${CURVE_WIDTH} ${CURVE_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`Temperature over the next hours, from ${first.temperature}° to ${last.temperature}°`}>
            <polyline points={points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')} fill="none" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="tg-curve-labels">
            {curveLabels(hours).map((hour) => <span key={hour.hour}>{hour.hour} <b>{hour.temperature}°</b></span>)}
          </div>
        </div>
      )}
      {rain && <p className="tg-weather-rain">{rain[0].toUpperCase()}{rain.slice(1)}.</p>}
    </section>
  );
}
