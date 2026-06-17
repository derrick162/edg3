import { describe, it, expect } from 'vitest';
import {
  tagTopicsFromTranscript,
  tagCommitmentsFromTasks,
} from './episodeStore';

// ── tagTopicsFromTranscript ───────────────────────────────────────────────────

describe('tagTopicsFromTranscript', () => {
  it('returns empty array for empty transcript', () => {
    expect(tagTopicsFromTranscript('', ['fundraising', 'health'])).toEqual([]);
  });

  it('matches a priority text when a keyword from it appears', () => {
    const transcript = 'We talked about extending the runway for the next quarter.';
    const result = tagTopicsFromTranscript(transcript, ['extend runway', 'get to 130 lbs']);
    expect(result).toContain('extend runway');
    expect(result).not.toContain('get to 130 lbs');
  });

  it('matches a short priority (< 5 char word) by whole phrase', () => {
    const transcript = 'I need to focus on sales.';
    const result = tagTopicsFromTranscript(transcript, ['sales']);
    expect(result).toContain('sales');
  });

  it('adds domain keyword tags (fundraising detected from "investor")', () => {
    const transcript = 'Met with an investor today and discussed our deck.';
    const result = tagTopicsFromTranscript(transcript, []);
    expect(result).toContain('fundraising');
  });

  it('adds domain keyword tags (fitness from "workout")', () => {
    const transcript = 'Did a workout this morning before the call.';
    const result = tagTopicsFromTranscript(transcript, []);
    expect(result).toContain('fitness');
  });

  it('caps output at 10 tags when many keywords match', () => {
    const priorities = Array.from({ length: 20 }, (_, i) => `priority-keyword-${i}`);
    const transcript = priorities.join(' ');
    const result = tagTopicsFromTranscript(transcript, priorities);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it('does not duplicate tags', () => {
    const transcript = 'runway runway runway runway';
    const result = tagTopicsFromTranscript(transcript, ['extend runway']);
    const uniqueResult = [...new Set(result)];
    expect(result.length).toBe(uniqueResult.length);
  });

  it('returns both priority and domain tags when both match', () => {
    const transcript = 'We discussed fundraising with an investor. Recovery score was low.';
    const result = tagTopicsFromTranscript(transcript, ['improve runway']);
    expect(result).toContain('fundraising');
    expect(result).toContain('recovery');
  });
});

// ── tagCommitmentsFromTasks ───────────────────────────────────────────────────

describe('tagCommitmentsFromTasks', () => {
  it('returns empty array for no tasks', () => {
    expect(tagCommitmentsFromTasks([])).toEqual([]);
  });

  it('returns task texts up to limit of 10', () => {
    const tasks = Array.from({ length: 15 }, (_, i) => `Task ${i + 1}`);
    const result = tagCommitmentsFromTasks(tasks);
    expect(result).toHaveLength(10);
    expect(result[0]).toBe('Task 1');
  });

  it('returns all tasks when count < 10', () => {
    const tasks = ['Send email to Alice', 'Review the pitch deck', 'Block time for coding'];
    const result = tagCommitmentsFromTasks(tasks);
    expect(result).toEqual(tasks);
  });
});
