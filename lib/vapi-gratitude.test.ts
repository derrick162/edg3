import { describe, it, expect } from 'vitest';
import { buildGratitudeSystemPrompt } from './vapi';

describe('buildGratitudeSystemPrompt (R20)', () => {
  it('includes the first name and date, and weaves in the weather when provided', () => {
    const p = buildGratitudeSystemPrompt('Derrick', 'Monday, June 22', 'Sunny, high of 24');
    expect(p).toContain('Derrick');
    expect(p).toContain('Monday, June 22');
    expect(p).toContain('Sunny, high of 24');
    expect(p).toContain('recordGratitude');
    // Tone guard: never a productivity briefing.
    expect(p).toContain('NOT a productivity briefing');
  });

  it('omits the weather clause when weather is null', () => {
    const p = buildGratitudeSystemPrompt('Sam', 'Tuesday, June 23', null);
    expect(p).toContain('Today is Tuesday, June 23.');
    // No trailing weather fragment — date immediately followed by closing quote.
    expect(p).toContain('Today is Tuesday, June 23." Then ask warmly');
  });

  it('includes quote instruction when quoteEnabled=true', () => {
    const p = buildGratitudeSystemPrompt('Derrick', 'Monday, June 22', null, true, 'rebuilding');
    expect(p).toContain('rebuilding');
    expect(p).toContain('QUOTE');
    expect(p).toContain('NOT a productivity briefing');
  });

  it('excludes quote instruction when quoteEnabled=false (default)', () => {
    const p = buildGratitudeSystemPrompt('Derrick', 'Monday, June 22', null);
    expect(p).not.toContain('QUOTE');
  });
});

describe('buildGratitudeSystemPrompt — time-aware greeting (R19 T3 follow-up)', () => {
  // positional: firstName, dateStr, weatherStr, quoteEnabled, quoteTheme, language, recoveryScore, greeting, timeOfDay
  it('defaults to morning wording when greeting/timeOfDay are omitted (backward compatible)', () => {
    const p = buildGratitudeSystemPrompt('Derrick', 'Monday June 23', null);
    expect(p).toContain('Good morning Derrick!');
    expect(p).toContain('How are you doing this morning?');
  });

  it('uses the supplied evening greeting + period instead of "Good morning"', () => {
    const p = buildGratitudeSystemPrompt('Derrick', 'Monday June 23', null, false, 'resilience', 'en', null, 'Good evening', 'evening');
    expect(p).toContain('Good evening Derrick!');
    expect(p).toContain('How are you doing this evening?');
    expect(p).not.toContain('Good morning');
    expect(p).not.toContain('this morning');
    // the fixed-ritual phrasing must not re-introduce a hardcoded morning
    expect(p).not.toContain('morning gratitude check-in');
  });

  it('threads the time-of-day into the Whoop acknowledgment line too', () => {
    const p = buildGratitudeSystemPrompt('Derrick', 'Monday June 23', null, false, 'resilience', 'en', 86, 'Good afternoon', 'afternoon');
    expect(p).toContain('WHOOP ACKNOWLEDGMENT');
    expect(p).toContain('How are you doing this afternoon?');
    expect(p).not.toContain('this morning');
  });

  it('Cantonese uses the supplied localized greeting, not hardcoded 早晨', () => {
    const p = buildGratitudeSystemPrompt('Derrick', '六月二十三', null, false, 'resilience', 'yue', null, '晚上好', 'evening');
    expect(p).toContain('晚上好 Derrick！');
    expect(p).not.toContain('早晨 Derrick');
  });
});

describe('buildGratitudeSystemPrompt — R25 T2 (recovery opener + natural conversation)', () => {
  // positional: firstName, dateStr, weatherStr, quoteEnabled, quoteTheme, language, recoveryScore
  const build = (recovery: number | null) =>
    buildGratitudeSystemPrompt('Derrick', 'Monday June 23', null, false, 'resilience', 'en', recovery);

  it('includes the Whoop acknowledgment when recovery ≥ 80', () => {
    const p = build(86);
    expect(p).toContain('WHOOP ACKNOWLEDGMENT');
    expect(p).toContain('86%');
  });

  it('omits the Whoop acknowledgment when recovery is below 80', () => {
    expect(build(60)).not.toContain('WHOOP ACKNOWLEDGMENT');
  });

  it('omits the Whoop acknowledgment when recovery is null', () => {
    expect(build(null)).not.toContain('WHOOP ACKNOWLEDGMENT');
  });

  it('replaces the hard "Do not pivot" block with WHAT TO DEFLECT (natural conversation allowed)', () => {
    const p = build(null);
    expect(p).not.toContain('Do not pivot');
    expect(p).toContain('WHAT TO DEFLECT');
  });
});

describe('buildGratitudeSystemPrompt — R27 (memory injection so Edge knows people)', () => {
  // positional: firstName, dateStr, weatherStr, quoteEnabled, quoteTheme, language, recoveryScore, greeting, timeOfDay, memoryText
  // Use a distinctive phrase that does NOT appear anywhere in the static prompt (the LISTENING
  // example already mentions "Patrick", so assert on the bachelor-party detail instead).
  const memory = 'WHAT EDGE KNOWS ABOUT YOU:\nPeople: Patrick — bachelor party in Vegas next month';

  it('injects the memory block (incl. people facts) when memoryText is provided', () => {
    const p = buildGratitudeSystemPrompt('Derrick', 'Monday June 23', null, false, 'resilience', 'en', null, 'Good morning', 'morning', memory);
    expect(p).toContain('MEMORY —');
    expect(p).toContain('bachelor party in Vegas next month');
    // Guard: memory is for answering, not for pivoting away from gratitude.
    expect(p).toContain('never volunteer it');
  });

  it('omits the memory block when memoryText is empty (default)', () => {
    const p = buildGratitudeSystemPrompt('Derrick', 'Monday June 23', null);
    expect(p).not.toContain('MEMORY —');
    expect(p).not.toContain('bachelor party in Vegas next month');
  });

  it('injects the memory block in the Cantonese gratitude prompt too', () => {
    const p = buildGratitudeSystemPrompt('Derrick', '6月23日 星期一', null, false, 'resilience', 'yue', null, '早晨', 'morning', memory);
    expect(p).toContain('記憶');
    expect(p).toContain('bachelor party in Vegas next month');
    // Still the Cantonese gratitude prompt, not the English one.
    expect(p).toContain('感恩');
  });
});
