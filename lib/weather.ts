// getWeather tool support (R9 T4). Open-Meteo (free, no API key).
// Pure formatter + WMO-code mapping are unit-tested; the fetch wrapper degrades
// gracefully so a network failure never sounds like "I don't have weather data".

// Default coordinates: Toronto (Derrick's city). Later: derive from user timezone.
export const TORONTO = { latitude: 43.65, longitude: -79.38, timezone: 'America/Toronto' };

/** Map a WMO weather code to a plain-English description. */
export function wmoToDescription(code: number): string {
  if (code === 0) return 'clear';
  if (code === 1) return 'mostly sunny';
  if (code === 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code >= 45 && code <= 48) return 'foggy';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rainy';
  if (code >= 71 && code <= 77) return 'snowy';
  if (code >= 80 && code <= 82) return 'showers';
  if (code >= 85 && code <= 86) return 'snow showers';
  if (code >= 95 && code <= 99) return 'thunderstorms';
  return 'mixed conditions';
}

export interface OpenMeteoDaily {
  time?: string[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_probability_max?: number[];
  weathercode?: number[];
}

/**
 * Build a spoken-friendly forecast string from Open-Meteo daily arrays.
 * Returns today + tomorrow (when present). °C for Canadian users.
 * Returns null when the data is unusable (caller falls back to a graceful line).
 */
export function formatWeatherForVoice(daily: OpenMeteoDaily | null | undefined, city = 'Toronto'): string | null {
  const highs = daily?.temperature_2m_max;
  const codes = daily?.weathercode;
  if (!highs?.length || !codes?.length) return null;

  const precip = daily?.precipitation_probability_max ?? [];
  const round = (n: number) => Math.round(n);

  const todayHigh = round(highs[0]);
  const todayDesc = wmoToDescription(codes[0]);
  const todayRain = typeof precip[0] === 'number' ? precip[0] : null;
  let out = `${city} today: high ${todayHigh}°C, ${todayDesc}`;
  if (todayRain != null && todayRain >= 10) out += `, ${todayRain}% chance of rain`;
  out += '.';

  if (highs.length > 1 && codes.length > 1) {
    const tHigh = round(highs[1]);
    const tDesc = wmoToDescription(codes[1]);
    const tRain = typeof precip[1] === 'number' ? precip[1] : null;
    let tomorrow = ` Tomorrow: high ${tHigh}°C, ${tDesc}`;
    if (tRain != null && tRain >= 30) tomorrow += `, ${tRain}% chance of rain`;
    tomorrow += '.';
    out += tomorrow;
  }

  return out;
}

const FALLBACK = "I'm having trouble pulling weather right now — check your weather app for the latest.";

/**
 * Fetch today + tomorrow's forecast and return a spoken-friendly string.
 * Never throws — returns a graceful fallback line on any failure.
 */
export async function getWeatherForecast(
  coords: { latitude: number; longitude: number; timezone: string } = TORONTO,
  city = 'Toronto',
): Promise<string> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode` +
      `&timezone=${encodeURIComponent(coords.timezone)}&forecast_days=2`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return FALLBACK;
    const json = await res.json() as { daily?: OpenMeteoDaily };
    return formatWeatherForVoice(json.daily, city) ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/**
 * Today-only variant for the gratitude call — returns a short one-line phrase or null on failure.
 * Never includes tomorrow. Returns null (not the FALLBACK string) so the caller can omit weather
 * cleanly from the prompt rather than having Edge read a failure message.
 */
export async function getWeatherToday(
  coords: { latitude: number; longitude: number; timezone: string } = TORONTO,
  city = 'Toronto',
): Promise<string | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}` +
      `&daily=temperature_2m_max,precipitation_probability_max,weathercode` +
      `&timezone=${encodeURIComponent(coords.timezone)}&forecast_days=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json() as { daily?: OpenMeteoDaily };
    const daily = json.daily;
    const highs = daily?.temperature_2m_max;
    const codes = daily?.weathercode;
    if (!highs?.length || !codes?.length) return null;
    const code = codes[0];
    // Skip weather entirely for unpleasant conditions — not a positive opener.
    // Rainy (61-67), drizzle (51-57), foggy (45-48), showers (80-82), snow (71-77, 85-86), thunder (95-99)
    if ((code >= 45 && code <= 86) || code >= 95) return null;
    const todayHigh = Math.round(highs[0]);
    const todayDesc = wmoToDescription(code);
    return `${city}: high ${todayHigh} degrees, ${todayDesc}`;
  } catch {
    return null;
  }
}
