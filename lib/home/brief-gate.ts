/**
 * Where the weather line on Home has got to. Everything but 'loading' is final:
 * the brief can be written without weather, it just must not be written twice
 * because weather arrived a moment after the first request went out.
 */
export type WeatherPhase = 'loading' | 'ready' | 'error' | 'needs-city' | 'off';

/** Whether Home has everything the AI brief will be written from. */
export function briefReady({ weather, portfolioSettled }: { weather: WeatherPhase; portfolioSettled: boolean }) {
  return weather !== 'loading' && portfolioSettled;
}
