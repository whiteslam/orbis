/** The weather the Home screen fetched, as the brief and the weather line read it. */
export type BriefWeather = {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  condition: string;
  weatherCode: number;
  isDay: boolean;
  /** True when it is precipitating right now, rather than forecast to. */
  rainingNow: boolean;
  /** The next 12 hours: the coming hour, and the wettest hour with its time. */
  rain: {
    soon: number;
    peak: { probability: number; hour: string } | null;
  };
};
