import { describe, it, expect } from 'vitest';
import type { EnergyLog, Priority } from './db';
import {
  whoopTierToLevel,
  deriveEnergySignal,
  formatEnergyForBriefing,
  formatEnergyForCall,
} from './energy';

const makeLog = (level: 'red' | 'yellow' | 'green', source: 'whoop' | 'manual' | 'override'): EnergyLog => ({
  id: 1,
  user_id: 1,
  date: '2026-06-14',
  level,
  source,
  created_at: '2026-06-14T08:00:00',
});

const makePriority = (text: string, energy_cost: 'high' | 'medium' | 'low' | null = null): Priority => ({
  id: 1,
  user_id: 1,
  text,
  week_of: '2026-06-08',
  rank: 1,
  energy_cost,
  created_at: '2026-06-14T00:00:00',
});

describe('whoopTierToLevel', () => {
  it('maps score >= 67 to green', () => expect(whoopTierToLevel(67)).toBe('green'));
  it('maps score >= 34 to yellow', () => expect(whoopTierToLevel(34)).toBe('yellow'));
  it('maps score < 34 to red', () => expect(whoopTierToLevel(33)).toBe('red'));
  it('maps 0 to red', () => expect(whoopTierToLevel(0)).toBe('red'));
  it('maps 100 to green', () => expect(whoopTierToLevel(100)).toBe('green'));
});

describe('deriveEnergySignal', () => {
  it('returns stored log when present (override wins over whoop)', () => {
    const log = makeLog('green', 'override');
    const result = deriveEnergySignal(log, 20); // Whoop says red but override wins
    expect(result).toEqual({ level: 'green', source: 'override' });
  });

  it('returns stored manual log when present', () => {
    const log = makeLog('red', 'manual');
    const result = deriveEnergySignal(log, 90);
    expect(result).toEqual({ level: 'red', source: 'manual' });
  });

  it('derives from Whoop when no log', () => {
    const result = deriveEnergySignal(null, 80);
    expect(result).toEqual({ level: 'green', source: 'whoop' });
  });

  it('derives yellow from Whoop score 50', () => {
    const result = deriveEnergySignal(undefined, 50);
    expect(result).toEqual({ level: 'yellow', source: 'whoop' });
  });

  it('returns null when no log and no Whoop', () => {
    expect(deriveEnergySignal(null, null)).toBeNull();
    expect(deriveEnergySignal(undefined, undefined)).toBeNull();
  });
});

describe('formatEnergyForBriefing', () => {
  it('returns unknown action prompt when signal is null', () => {
    const out = formatEnergyForBriefing(null, []);
    expect(out).toContain('Unknown');
    expect(out).toContain('setEnergyLevel');
  });

  it('includes FOCUS-AREA ENERGY COSTS when priorities have cost', () => {
    const out = formatEnergyForBriefing(null, [makePriority('Build Edg3', 'high')]);
    expect(out).toContain('Build Edg3 (high-energy)');
  });

  it('includes ENERGY STATE for green signal', () => {
    const signal = { level: 'green' as const, source: 'whoop' as const };
    const out = formatEnergyForBriefing(signal, []);
    expect(out).toContain('GREEN');
    expect(out).toContain('Full capacity');
  });

  it('adds override prompt with firstName when source is whoop', () => {
    const signal = { level: 'yellow' as const, source: 'whoop' as const };
    const out = formatEnergyForBriefing(signal, [], 'Derrick');
    expect(out).toContain('Derrick');
    expect(out).toContain('override');
  });

  it('falls back to "they" when firstName is empty', () => {
    const signal = { level: 'yellow' as const, source: 'whoop' as const };
    const out = formatEnergyForBriefing(signal, [], '');
    expect(out).toContain('they');
    expect(out).not.toContain('{firstName}');
  });

  it('adds RED DAY ACTION when level is red and high-energy priorities exist', () => {
    const signal = { level: 'red' as const, source: 'manual' as const };
    const out = formatEnergyForBriefing(signal, [makePriority('Deep coding', 'high')]);
    expect(out).toContain('RED DAY ACTION');
    expect(out).toContain('Deep coding');
  });

  it('does NOT add RED DAY ACTION when no high-energy priorities', () => {
    const signal = { level: 'red' as const, source: 'manual' as const };
    const out = formatEnergyForBriefing(signal, [makePriority('Admin tasks', 'low')]);
    expect(out).not.toContain('RED DAY ACTION');
  });
});

describe('formatEnergyForCall', () => {
  it('returns ask prompt when signal is null', () => {
    const out = formatEnergyForCall(null, 'Derrick');
    expect(out).toContain('ENERGY CHECK');
    expect(out).toContain('Derrick');
    expect(out).toContain('setEnergyLevel');
  });

  it('returns compact energy line for green signal', () => {
    const signal = { level: 'green' as const, source: 'whoop' as const };
    const out = formatEnergyForCall(signal, 'Derrick');
    expect(out).toContain('GREEN');
    expect(out).toContain('Whoop');
    expect(out).toContain('override');
  });

  it('returns "Already confirmed" for manual signal', () => {
    const signal = { level: 'red' as const, source: 'manual' as const };
    const out = formatEnergyForCall(signal, 'Derrick');
    expect(out).toContain('RED');
    expect(out).toContain('Already confirmed');
  });

  it('returns "Already confirmed" for override signal', () => {
    const signal = { level: 'yellow' as const, source: 'override' as const };
    const out = formatEnergyForCall(signal, 'Derrick');
    expect(out).toContain('Already confirmed');
    expect(out).not.toContain('ENERGY CHECK');
  });
});
