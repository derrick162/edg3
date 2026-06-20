import { describe, it, expect } from 'vitest';
import {
  numbersIn,
  isHealthMetricStatement,
  isGroundedInSource,
  isUngroundedHealthFact,
} from './factGuards';

describe('numbersIn', () => {
  it('extracts integers and decimals', () => {
    expect(numbersIn('weighs 122 lbs, 5.5 hours')).toEqual(['122', '5.5']);
    expect(numbersIn('no numbers here')).toEqual([]);
  });
});

describe('isHealthMetricStatement', () => {
  it('flags weight/body measurement claims with a number', () => {
    expect(isHealthMetricStatement('Derrick weighs 122 lbs')).toBe(true);
    expect(isHealthMetricStatement('Resting heart rate is 58')).toBe(true);
    expect(isHealthMetricStatement('Body fat is 14%')).toBe(true);
  });

  it('does not flag non-health facts or health words without numbers', () => {
    expect(isHealthMetricStatement('Wants to close Series A by September')).toBe(false);
    expect(isHealthMetricStatement('Derrick wants to lose weight')).toBe(false);
  });
});

describe('isGroundedInSource', () => {
  it('is grounded when every number appears in the source', () => {
    expect(isGroundedInSource('weighs 122 lbs', 'I weigh 122 these days')).toBe(true);
  });

  it('is ungrounded when a number is absent from the source', () => {
    expect(isGroundedInSource('weighs 122 lbs', 'we talked about fundraising')).toBe(false);
  });

  it('treats number-free statements as trivially grounded', () => {
    expect(isGroundedInSource('prefers mornings', 'anything')).toBe(true);
  });
});

describe('isUngroundedHealthFact', () => {
  it('drops a health metric the user never stated', () => {
    expect(isUngroundedHealthFact('Derrick weighs 122 lbs', 'we talked about the calendar')).toBe(true);
  });

  it('keeps a health metric the user explicitly stated', () => {
    expect(isUngroundedHealthFact('Derrick weighs 122 lbs', 'I weigh 122 right now')).toBe(false);
  });

  it('never drops non-health facts', () => {
    expect(isUngroundedHealthFact('Raised 500 from an angel', 'nothing about it')).toBe(false);
  });
});
