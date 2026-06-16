import { describe, it, expect } from 'vitest';
import {
  computeWhoopTrends,
  formatTrendForBriefing,
  detectRecoveryDrop,
  formatRecoveryAlertForBriefing,
  computeWhoopBaselines,
  buildBaselineDeviationNote,
  buildCalendarActionFromRecovery,
  type WhoopHistoryPoint,
  type WhoopBaseline,
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

describe('computeWhoopTrends — OVERREACHING + sleepAvg7dH', () => {
  it('sets OVERREACHING when HIGH_STRAIN_STREAK + RECOVERY_DECLINING_3D both fire', () => {
    const recovery = [
      rec('2026-06-11', 70), rec('2026-06-12', 55), rec('2026-06-13', 35), // declining
    ];
    const strain = [
      str('2026-06-11', 15.5), str('2026-06-12', 17.0), str('2026-06-13', 16.0), // high streak
    ];
    const result = computeWhoopTrends(recovery, EMPTY, strain)!;
    expect(result.flags).toContain('OVERREACHING');
    expect(result.flags).toContain('HIGH_STRAIN_STREAK');
    expect(result.flags).toContain('RECOVERY_DECLINING_3D');
  });

  it('does NOT set OVERREACHING when only one condition is met', () => {
    const recovery = [
      rec('2026-06-11', 70), rec('2026-06-12', 55), rec('2026-06-13', 35), // declining
    ];
    // strain NOT above threshold
    const strain = [str('2026-06-11', 10), str('2026-06-12', 12), str('2026-06-13', 11)];
    const result = computeWhoopTrends(recovery, EMPTY, strain)!;
    expect(result.flags).not.toContain('OVERREACHING');
  });

  it('populates sleepAvg7dH when sleep data is present', () => {
    const sleep = Array.from({ length: 7 }, (_, i) =>
      slp(`2026-06-0${i + 7}`, 6 * 3_600_000), // 6h per night
    );
    const result = computeWhoopTrends(EMPTY, sleep, EMPTY)!;
    expect(result.sleepAvg7dH).toBeCloseTo(6, 1);
  });

  it('sleepAvg7dH is null when no sleep data', () => {
    const result = computeWhoopTrends([rec('2026-06-13', 70)], EMPTY, EMPTY)!;
    expect(result.sleepAvg7dH ?? null).toBeNull();
  });
});

describe('formatTrendForBriefing — OVERREACHING priority + sleep quantity', () => {
  it('OVERREACHING takes highest priority over DECLINING_3D', () => {
    const result = formatTrendForBriefing({
      recoveryAvg7d: 40, recoveryDirection: 'down',
      flags: ['OVERREACHING', 'RECOVERY_DECLINING_3D', 'HIGH_STRAIN_STREAK'],
    });
    expect(result).toContain('overreaching zone');
  });

  it('includes sleep avg hours in SLEEP_DEBT message when available', () => {
    const result = formatTrendForBriefing({
      recoveryAvg7d: null, recoveryDirection: null,
      flags: ['SLEEP_DEBT'],
      sleepAvg7dH: 5.8,
    });
    expect(result).toContain('short');
    expect(result).toContain('5.8h');
  });

  it('SLEEP_DEBT message still works without sleepAvg7dH', () => {
    const result = formatTrendForBriefing({
      recoveryAvg7d: null, recoveryDirection: null,
      flags: ['SLEEP_DEBT'],
    });
    expect(result).toContain('short');
  });
});

describe('computeWhoopBaselines', () => {
  it('computes 30-day avg for recovery', () => {
    const history = Array.from({ length: 20 }, (_, i) =>
      rec(`2026-05-${String(i + 1).padStart(2, '0')}`, 70),
    );
    const b = computeWhoopBaselines(history, EMPTY, EMPTY);
    expect(b.recovery30dAvg).toBe(70);
  });

  it('uses at most 30 most recent points', () => {
    const history = [
      ...Array.from({ length: 30 }, (_, i) => rec(`2026-04-${String(i + 1).padStart(2, '0')}`, 80)),
      ...Array.from({ length: 5 }, (_, i) => rec(`2026-05-${String(i + 1).padStart(2, '0')}`, 40)),
    ];
    const b = computeWhoopBaselines(history, EMPTY, EMPTY);
    // Last 30 of 35 points should dominate — mix of 80s and 40s but 80s win most slots
    expect(b.recovery30dAvg).not.toBeNull();
    // Exact avg: last 30 = 25 points at 80 + 5 at 40 = (25*80 + 5*40)/30 ≈ 73.3
    expect(b.recovery30dAvg!).toBe(73);
  });

  it('returns all null when all inputs empty', () => {
    const b = computeWhoopBaselines(EMPTY, EMPTY, EMPTY);
    expect(b.recovery30dAvg).toBeNull();
    expect(b.sleep30dAvgH).toBeNull();
    expect(b.strain30dAvg).toBeNull();
  });

  it('computes sleep baseline in hours', () => {
    const sleep = Array.from({ length: 10 }, (_, i) =>
      slp(`2026-06-0${i + 1}`, 7.5 * 3_600_000),
    );
    const b = computeWhoopBaselines(EMPTY, sleep, EMPTY);
    expect(b.sleep30dAvgH).toBeCloseTo(7.5, 1);
  });
});

describe('buildBaselineDeviationNote', () => {
  const baseline: WhoopBaseline = { recovery30dAvg: 72, sleep30dAvgH: 7.5, strain30dAvg: 12 };

  it('returns null when recovery is within 14 pts of baseline', () => {
    expect(buildBaselineDeviationNote(60, null, baseline)).toBeNull(); // 72 - 60 = 12 < 15
  });

  it('returns recovery note when ≥15 pts below baseline', () => {
    const note = buildBaselineDeviationNote(55, null, baseline); // 72 - 55 = 17 ≥ 15
    expect(note).toContain('17 pts');
    expect(note).toContain('72%');
  });

  it('returns sleep note when ≥45 min shorter than baseline', () => {
    const sleepMs = 6.5 * 3_600_000; // 7.5 - 6.5 = 1h = 60min ≥ 45min
    const note = buildBaselineDeviationNote(null, sleepMs, baseline);
    expect(note).toContain('60 min');
    expect(note).toContain('7.5 h');
  });

  it('recovery note takes priority over sleep note when both fire', () => {
    const sleepMs = 6.5 * 3_600_000;
    const note = buildBaselineDeviationNote(50, sleepMs, baseline); // recovery fires first
    expect(note).toContain('pts below');
  });

  it('returns null when both are within range', () => {
    const sleepMs = 7.3 * 3_600_000; // 7.5 - 7.3 = 0.2h = 12min < 45min
    expect(buildBaselineDeviationNote(60, sleepMs, baseline)).toBeNull();
  });

  it('returns null when baseline has no data', () => {
    const emptyBaseline: WhoopBaseline = { recovery30dAvg: null, sleep30dAvgH: null, strain30dAvg: null };
    expect(buildBaselineDeviationNote(30, null, emptyBaseline)).toBeNull();
  });
});

describe('buildCalendarActionFromRecovery', () => {
  it('returns red-day action when score ≤ 33', () => {
    const action = buildCalendarActionFromRecovery(25);
    expect(action).toContain('red');
    expect(action).toContain('moveEvent');
  });

  it('returns green-day action when score ≥ 67', () => {
    const action = buildCalendarActionFromRecovery(80);
    expect(action).toContain('green');
    expect(action).toContain('createEvent');
  });

  it('returns null for yellow tier (34–66)', () => {
    expect(buildCalendarActionFromRecovery(50)).toBeNull();
  });

  it('boundary: score exactly 33 → red action', () => {
    expect(buildCalendarActionFromRecovery(33)).toContain('red');
  });

  it('boundary: score exactly 67 → green action', () => {
    expect(buildCalendarActionFromRecovery(67)).toContain('green');
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
