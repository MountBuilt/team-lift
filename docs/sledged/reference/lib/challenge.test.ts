/** Ported from Team Lift tests/challenge.test.js. */
import { describe, it, expect } from 'vitest';
import { EXERCISES, dailyChallenge, challengeStreak, challengeDoneOn } from './challenge.js';
import { dateRange, addDays } from './dates.js';

const START = '2026-07-06'; // a Monday

const e = (userId: string, date: string, fields: Record<string, unknown> = {}) =>
  ({ userId, date, ...fields }) as { userId: string; date: string; dailyChallenge?: boolean };

describe('dailyChallenge', () => {
  it('is deterministic for a given date', () => {
    expect(dailyChallenge('2026-07-10', START)).toEqual(dailyChallenge('2026-07-10', START));
  });

  it('picks a known exercise with whole-number reps', () => {
    for (const d of dateRange('2026-07-06', '2026-08-06')) {
      const c = dailyChallenge(d, START);
      expect(EXERCISES.some((x) => x.name === c.name)).toBe(true);
      expect(Number.isInteger(c.reps) && c.reps > 0).toBe(true);
    }
  });

  it('varies the exercise across a fortnight', () => {
    const names = new Set(
      dateRange('2026-07-06', '2026-07-19').map((d) => dailyChallenge(d, START).name),
    );
    expect(names.size).toBeGreaterThanOrEqual(3);
  });

  it('ramps reps week on week for the same exercise', () => {
    const picks = dateRange('2026-07-06', '2026-09-06').map((d) => ({ d, ...dailyChallenge(d, START) }));
    const byName = new Map<string, (typeof picks)[number]>();
    let checked = 0;
    for (const p of picks) {
      const prev = byName.get(p.name);
      if (prev && p.week > prev.week) {
        expect(p.reps).toBeGreaterThan(prev.reps);
        checked++;
      }
      if (!prev) byName.set(p.name, p);
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it("starts easy: week 1 uses each exercise's base reps", () => {
    for (const d of dateRange(START, addDays(START, 6))) {
      const c = dailyChallenge(d, START);
      expect(c.reps).toBe(EXERCISES.find((x) => x.name === c.name)!.base);
      expect(c.week).toBe(1);
    }
  });

  it('clamps to week 1 before the challenge starts', () => {
    const c = dailyChallenge('2026-06-20', START);
    expect(c.week).toBe(1);
    expect(c.reps).toBe(EXERCISES.find((x) => x.name === c.name)!.base);
  });

  it('gives each crew its own ramp from its own start date', () => {
    // Sledged change: challengeStart is per crew, so the same date can be week 1
    // for a new crew and week 5 for an old one.
    expect(dailyChallenge('2026-08-03', '2026-08-03').week).toBe(1);
    expect(dailyChallenge('2026-08-03', START).week).toBe(5);
  });
});

describe('challengeDoneOn', () => {
  it('lists who ticked the challenge that day', () => {
    const entries = [
      e('u1', '2026-07-10', { dailyChallenge: true }),
      e('u2', '2026-07-10', { workoutParts: ['legs'] }),
      e('u3', '2026-07-09', { dailyChallenge: true }),
    ];
    expect(challengeDoneOn(entries, '2026-07-10')).toEqual(['u1']);
  });
});

describe('challengeStreak', () => {
  it('counts consecutive days ending today', () => {
    const entries = ['2026-07-08', '2026-07-09', '2026-07-10'].map((d) =>
      e('u1', d, { dailyChallenge: true }),
    );
    expect(challengeStreak(entries, 'u1', '2026-07-10')).toBe(3);
  });

  it('survives today being not-yet-done (same-day grace)', () => {
    const entries = ['2026-07-08', '2026-07-09'].map((d) => e('u1', d, { dailyChallenge: true }));
    expect(challengeStreak(entries, 'u1', '2026-07-10')).toBe(2);
  });

  it('breaks on a missed day', () => {
    const entries = ['2026-07-06', '2026-07-07', '2026-07-09', '2026-07-10'].map((d) =>
      e('u1', d, { dailyChallenge: true }),
    );
    expect(challengeStreak(entries, 'u1', '2026-07-10')).toBe(2);
  });

  it('is zero with nothing recent, and ignores other users', () => {
    const entries = [
      e('u1', '2026-07-01', { dailyChallenge: true }),
      e('u2', '2026-07-10', { dailyChallenge: true }),
    ];
    expect(challengeStreak(entries, 'u1', '2026-07-10')).toBe(0);
  });

  it('ignores entries without an explicit tick', () => {
    const entries = [
      e('u1', '2026-07-10', { workoutParts: ['legs'], steps: 9000 }),
      e('u1', '2026-07-09', { dailyChallenge: true }),
    ];
    expect(challengeStreak(entries, 'u1', '2026-07-10')).toBe(1);
  });
});
