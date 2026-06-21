import { describe, it, expect } from 'vitest';
import { pickTaskToComplete, type TaskLike } from './taskMatch';

const tasks: TaskLike[] = [
  { id: 1, text: 'Follow up with David' },
  { id: 2, text: 'Send the proposal to CIBC' },
  { id: 3, text: 'Book dentist' },
];

describe('pickTaskToComplete (R14 T4)', () => {
  it('matches on exact normalized title', () => {
    expect(pickTaskToComplete(tasks, 'book dentist').match?.id).toBe(3);
  });

  it('matches on substring', () => {
    expect(pickTaskToComplete(tasks, 'David').match?.id).toBe(1);
    expect(pickTaskToComplete(tasks, 'proposal').match?.id).toBe(2);
  });

  it('returns no match when nothing is close', () => {
    const r = pickTaskToComplete(tasks, 'water the plants');
    expect(r.match).toBeNull();
    expect(r.ambiguous).toEqual([]);
  });

  it('returns ambiguous when 2+ tasks match the query', () => {
    const two: TaskLike[] = [{ id: 1, text: 'call the bank' }, { id: 2, text: 'call the dentist' }];
    const r = pickTaskToComplete(two, 'call');
    expect(r.match).toBeNull();
    expect(r.ambiguous.map(t => t.id)).toEqual([1, 2]);
  });

  it('empty query → no match', () => {
    expect(pickTaskToComplete(tasks, '').match).toBeNull();
  });
});
