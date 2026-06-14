import { describe, it, expect } from 'vitest';
import {
  computeWhoopTrends,
  formatTrendForBriefing,
  detectRecoveryDrop,
  formatRecoveryAlertForBriefing,
  type WhoopHistoryPoint,
} from './whoopTrends';

function rec(date: string, value: number): WhoopHistoryPoint { return { date, value }; }
function slp(date: string, ms: number): WhoopHistoryPoint   { return { date, value: ms }; }
function str(date: string, value: number): WhoopHistoryPoint { return { date, value }; }

const EMPTY: WhoopHistoryPoint[] = [];

describe('computeWhoopTrends', () => {
  it('returns null when all inputs are empty', () => {
    expect(computeWhoopTrends(EMPTY, EMPTY, EMPTY)).toBeNull();
  });

  // --- recoveryAvg7d ---

  it('computes 7-day recovery average', () => {
    const history = [
      rec('2026-06-07', 60), rec('2026-06-08', 70), rec('2026-06-09', 80),
      rec('2026-06-10', 50), rec('2026-06-11', 60), rec('2026-06-12', 70),
      rec('2026-06-13', 80),
    ];
    const result = computeWhoopTrends(history, EMPTY, EMPTY)!;
    expect(result.recoveryAvg7d).toBeCloseTo((60+70+80+50+60+70+80)/7, 1);
  });

  it('uses only last 7 when history is longer', () => {
    const history = [
      rec('2026-05-31', 10), // day 8 — should be excluded from avg
      rec('2026-06-06', 90), rec('2026-06-07', 90), rec('2026-06-08', 90),
      rec('2026-06-09', 90), rec('2026-06-10', 90), rec('2026-06-11', 90),
      rec('2026-06-13', 90),
    ];
    const result = computeWhoopTrends(history, EMPTY, EMPTY)!;
    expect(result.recoveryAvg7d).toBeCloseTo(90, 1);
  });

  // --- recoveryDirection ---

  it('returns null direction with fewer than 4 data points', () => {
    const history = [rec('2026-06-11', 50), rec('2026-06-12', 40), rec('2026-06-13', 30)];
    const result = computeWhoopTrends(history, EMPTY, EMPTY)!;
    expect(result.recoveryDirection).toBeNull();
  });

  it('detects "down" direction when recent avg drops > 5 pts', () => {
    const history = [
      rec('2026-06-07', 80), rec('2026-06-08', 75), rec('2026-06-09', 78), // prior avg ~77.7
      rec('2026-06-10', 60), rec('2026-06-11', 55), rec('2026-06-12', 50), // recent avg ~55
    ];
    const result = computeWhoopTrends(history, EMPTY, EMPTY)!;
    expect(result.recoveryDirection).toBe('down');
  });

  it('detects "up" direction when recent avg rises > 5 pts', () => {
    const history = [
      rec('2026-06-07', 40), rec('2026-06-08', 38), rec('2026-06-09', 42), // prior avg ~40
      rec('2026-06-10', 70), rec('2026-06-11', 72), rec('2026-06-12', 68), // recent avg ~70
    ];
    const result = computeWhoopTrends(history, EMPTY, EMPTY)!;
    expect(result.recoveryDirection).toBe('up');
  });

  it('returns "flat" when recent delta is within ±5 pts', () => {
    const history = [
      rec('2026-06-07', 65), rec('2026-06-08', 64), rec('2026-06-09', 66),
      rec('2026-06-10', 67), rec('2026-06-11', 63), rec('2026-06-12', 65),
    ];
    const result = computeWhoopTrends(history, EMPTY, EMPTY)!;
    expect(result.recoveryDirection).toBe('flat');
  });

  // --- RECOVERY_DECLINING_3D flag ---

  it('sets RECOVERY_DECLINING_3D when last 3 days are monotonically declining', () => {
    const history = [
      rec('2026-06-11', 70), rec('2026-06-12', 55), rec('2026-06-13', 35),
    ];
    const result = computeWhoopTrends(history, EMPTY, EMPTY)!;
    expect(result.flags).toContain('RECOVERY_DECLINING_3D');
  });

  it('does NOT set RECOVERY_DECLINING_3D when last 3 are not all declining', () => {
    const history = [
      rec('2026-06-11', 50), rec('2026-06-12', 30), rec('2026-06-13', 55), // bounce up on day 3
    ];
    const result = computeWhoopTrends(history, EMPTY, EMPTY)!;
    expect(result.flags).not.toContain('RECOVERY_DECLINING_3D');
  });

  it('does NOT set RECOVERY_DECLINING_3D with fewer than 3 points', () => {
    const history = [rec('2026-06-12', 70), rec('2026-06-13', 50)];
    const result = computeWhoopTrends(history, EMPTY, EMPTY)!;
    expect(result.flags).not.toContain('RECOVERY_DECLINING_3D');
  });

  // --- RECOVERY_LOW_STREAK flag ---

  it('sets RECOVERY_LOW_STREAK when last 3 days are all < 40', () => {
    const history = [
      rec('2026-06-11', 35), rec('2026-06-12', 28), rec('2026-06-13', 31),
    ];
    const result = computeWhoopTrends(history, EMPTY, EMPTY)!;
    expect(result.flags).toContain('RECOVERY_LOW_STREAK');
  });

  it('does NOT set RECOVERY_LOW_STREAK when one of the last 3 is ≥ 40', () => {
    const history = [
      rec('2026-06-11', 35), rec('2026-06-12', 40), rec('2026-06-13', 28),
    ];
    const result = computeWhoopTrends(history, EMPTY, EMPTY)!;
    expect(result.flags).not.toContain('RECOVERY_LOW_STREAK');
  });

  // --- SLEEP_DEBT flag ---

  it('sets SLEEP_DEBT when 7-day avg sleep < 6.5h', () => {
    // 6h = 21_600_000 ms
    const history = Array.from({ length: 7 }, (_, i) =>
      slp(`2026-06-0${i + 7}`, 21_600_000),
    );
    const result = computeWhoopTrends(EMPTY, history, EMPTY)!;
    expect(result.flags).toContain('SLEEP_DEBT');
  });

  it('does NOT set SLEEP_DEBT when 7-day avg sleep >= 6.5h', () => {
    // 7h = 25_200_000 ms
    const history = Array.from({ length: 7 }, (_, i) =>
      slp(`2026-06-0${i + 7}`, 25_200_000),
    );
    const result = computeWhoopTrends(EMPTY, history, EMPTY)!;
    expect(result.flags).not.toContain('SLEEP_DEBT');
  });

  // --- HIGH_STRAIN_STREAK flag ---

  it('sets HIGH_STRAIN_STREAK when last 3 days all have strain > 14', () => {
    const history = [
      str('2026-06-11', 15.5), str('2026-06-12', 17.2), str('2026-06-13', 16.0),
    ];
    const result = computeWhoopTrends(EMPTY, EMPTY, history)!;
    expect(result.flags).toContain('HIGH_STRAIN_STREAK');
  });

  it('does NOT set HIGH_STRAIN_STREAK when one of last 3 is ≤ 14', () => {
    const history = [
      str('2026-06-11', 15.5), str('2026-06-12', 14.0), str('2026-06-13', 16.0),
    ];
    const result = computeWhoopTrends(EMPTY, EMPTY, history)!;
    expect(result.flags).not.toContain('HIGH_STRAIN_STREAK');
  });

  it('sorts input by date regardless of order provided', () => {
    const history = [
      rec('2026-06-13', 30), rec('2026-06-11', 70), rec('2026-06-12', 50),
    ];
    const result = computeWhoopTrends(history, EMPTY, EMPTY)!;
    // sorted: [70, 50, 30] → declining
    expect(result.flags).toContain('RECOVERY_DECLINING_3D');
  });

  it('returns empty flags and null direction when data is unremarkable', () => {
    const history = [
      rec('2026-06-11', 65), rec('2026-06-12', 67), rec('2026-06-13', 66),
    ];
    const result = computeWhoopTrends(history, EMPTY, EMPTY)!;
    expect(result.flags).toHaveLength(0);
  });
});

describe('formatTrendForBriefing', () => {
  it('returns null when no flags and no notable direction', () => {
    expect(formatTrendForBriefing({ recoveryAvg7d: 65, recoveryDirection: 'flat', flags: [] })).toBeNull();
    expect(formatTrendForBriefing({ recoveryAvg7d: null, recoveryDirection: null, flags: [] })).toBeNull();
  });

  it('returns declining-3d message when flag is set', () => {
    const result = formatTrendForBriefing({ recoveryAvg7d: 45, recoveryDirection: 'down', flags: ['RECOVERY_DECLINING_3D'] });
    expect(result).toContain('three days running');
  });

  it('returns low-streak message when flag is set (and takes priority over direction)', () => {
    const result = formatTrendForBriefing({ recoveryAvg7d: 30, recoveryDirection: 'down', flags: ['RECOVERY_LOW_STREAK'] });
    expect(result).toContain('low three or more days');
  });

  it('returns sleep-debt message', () => {
    const result = formatTrendForBriefing({ recoveryAvg7d: 65, recoveryDirection: null, flags: ['SLEEP_DEBT'] });
    expect(result).toContain('Sleep');
    expect(result).toContain('short');
  });

  it('returns high-strain message', () => {
    const result = formatTrendForBriefing({ recoveryAvg7d: null, recoveryDirection: null, flags: ['HIGH_STRAIN_STREAK'] });
    expect(result).toContain('high-strain');
  });

  it('combines sleep-debt + high-strain into one message', () => {
    const result = formatTrendForBriefing({ recoveryAvg7d: null, recoveryDirection: null, flags: ['SLEEP_DEBT', 'HIGH_STRAIN_STREAK'] });
    expect(result).toContain('Sleep');
    expect(result).toContain('strain');
  });

  it('returns direction-up message with avg when no flags', () => {
    const result = formatTrendForBriefing({ recoveryAvg7d: 72, recoveryDirection: 'up', flags: [] });
    expect(result).toContain('trending up');
    expect(result).toContain('72%');
  });

  it('returns direction-down message with avg when no flags', () => {
    const result = formatTrendForBriefing({ recoveryAvg7d: 43, recoveryDirection: 'down', flags: [] });
    expect(result).toContain('trending down');
    expect(result).toContain('43%');
  });

  it('DECLINING_3D flag takes priority over LOW_STREAK', () => {
    const result = formatTrendForBriefing({ recoveryAvg7d: 30, recoveryDirection: 'down', flags: ['RECOVERY_DECLINING_3D', 'RECOVERY_LOW_STREAK'] });
    expect(result).toContain('three days running');
  });
});

describe('detectRecoveryDrop', () => {
  const history7 = [
    rec('2026-06-06', 70), rec('2026-06-07', 72), rec('2026-06-08', 68),
    rec('2026-06-09', 74), rec('2026-06-10', 66), rec('2026-06-11', 71),
    rec('2026-06-12', 70),
  ]; // trailing avg = 70

  it('returns null when today is healthy and no sharp drop', () => {
    expect(detectRecoveryDrop(65, history7)).toBeNull();
  });

  it('fires reason:red when todayScore <= 33', () => {
    const alert = detectRecoveryDrop(28, history7);
    expect(alert).not.toBeNull();
    expect(alert!.reason).toBe('red');
    expect(alert!.todayScore).toBe(28);
    expect(alert!.trailing7dAvg).toBe(70);
  });

  it('fires reason:sharp_drop when drop >= 20 pts from trailing avg', () => {
    const alert = detectRecoveryDrop(45, history7); // 70 - 45 = 25 >= 20
    expect(alert).not.toBeNull();
    expect(alert!.reason).toBe('sharp_drop');
    expect(alert!.dropMagnitude).toBe(25);
  });

  it('does NOT fire when drop is exactly 19 pts (below threshold)', () => {
    expect(detectRecoveryDrop(51, history7)).toBeNull(); // 70 - 51 = 19
  });

  it('fires reason:red even when trailing avg is null (thin history)', () => {
    // Fewer than 3 points → trailing avg is null; red still fires
    const thin = [rec('2026-06-12', 70), rec('2026-06-11', 68)];
    const alert = detectRecoveryDrop(20, thin);
    expect(alert).not.toBeNull();
    expect(alert!.reason).toBe('red');
    expect(alert!.trailing7dAvg).toBeNull();
  });

  it('does NOT fire sharp_drop when history has fewer than 3 points (no reliable avg)', () => {
    const thin = [rec('2026-06-12', 70), rec('2026-06-11', 68)];
    expect(detectRecoveryDrop(45, thin)).toBeNull(); // not red; can't compute avg
  });
});

describe('formatRecoveryAlertForBriefing', () => {
  it('includes score and "red tier" language for reason:red', () => {
    const text = formatRecoveryAlertForBriefing({ reason: 'red', todayScore: 28, trailing7dAvg: 70, dropMagnitude: 42 });
    expect(text).toContain('28%');
    expect(text).toContain('red tier');
    expect(text).toContain('70%');
  });

  it('includes drop magnitude for reason:sharp_drop', () => {
    const text = formatRecoveryAlertForBriefing({ reason: 'sharp_drop', todayScore: 45, trailing7dAvg: 70, dropMagnitude: 25 });
    expect(text).toContain('25-point drop');
    expect(text).toContain('45%');
  });
});
