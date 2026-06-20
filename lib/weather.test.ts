import { describe, it, expect } from 'vitest';
import { wmoToDescription, formatWeatherForVoice } from './weather';

describe('wmoToDescription', () => {
  it('maps known WMO codes to plain English', () => {
    expect(wmoToDescription(0)).toBe('clear');
    expect(wmoToDescription(2)).toBe('partly cloudy');
    expect(wmoToDescription(3)).toBe('overcast');
    expect(wmoToDescription(45)).toBe('foggy');
    expect(wmoToDescription(63)).toBe('rainy');
    expect(wmoToDescription(73)).toBe('snowy');
    expect(wmoToDescription(81)).toBe('showers');
    expect(wmoToDescription(95)).toBe('thunderstorms');
  });

  it('falls back to mixed conditions for unknown codes', () => {
    expect(wmoToDescription(999)).toBe('mixed conditions');
  });
});

describe('formatWeatherForVoice', () => {
  it('produces a clean today + tomorrow spoken string', () => {
    const s = formatWeatherForVoice({
      time: ['2026-06-20', '2026-06-21'],
      temperature_2m_max: [24.3, 21.8],
      temperature_2m_min: [15, 14],
      precipitation_probability_max: [20, 5],
      weathercode: [2, 1],
    });
    expect(s).toBe('Toronto today: high 24°C, partly cloudy, 20% chance of rain. Tomorrow: high 22°C, mostly sunny.');
  });

  it('omits rain mention when probability is low for today', () => {
    const s = formatWeatherForVoice({
      temperature_2m_max: [24],
      precipitation_probability_max: [0],
      weathercode: [0],
    });
    expect(s).toBe('Toronto today: high 24°C, clear.');
  });

  it('includes tomorrow rain only when ≥30%', () => {
    const s = formatWeatherForVoice({
      temperature_2m_max: [20, 18],
      precipitation_probability_max: [5, 60],
      weathercode: [1, 61],
    });
    expect(s).toContain('Tomorrow: high 18°C, rainy, 60% chance of rain.');
  });

  it('returns null when data is unusable', () => {
    expect(formatWeatherForVoice(null)).toBeNull();
    expect(formatWeatherForVoice({})).toBeNull();
    expect(formatWeatherForVoice({ temperature_2m_max: [] })).toBeNull();
  });

  it('honors a custom city name', () => {
    const s = formatWeatherForVoice({ temperature_2m_max: [10], weathercode: [0] }, 'Vancouver');
    expect(s).toContain('Vancouver today');
  });
});
