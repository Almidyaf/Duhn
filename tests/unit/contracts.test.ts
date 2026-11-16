import { describe, it, expect } from 'vitest';
import {
  normalizeWeightInput,
  fromMilligrams,
  toMilligrams,
  positiveWeightSchema,
} from '../../src/contracts/weight';
import {
  endStoppage,
  inspectTiming,
  statusAfterResume,
  type StageTiming,
} from '../../src/contracts/stages';
import { requireExpectedVersion } from '../../src/contracts/requests';

describe('exact gram quantities', () => {
  it('normalizes Arabic decimal notation and preserves milligrams', () => {
    expect(normalizeWeightInput(' ٢٥٠٠٠٫١٢٣ ')).toBe('25000.123');
    expect(normalizeWeightInput('۰۰۵.۱')).toBe('5.100');
    expect(fromMilligrams(toMilligrams('0.100') + toMilligrams('0.200'))).toBe('0.300');
    expect(fromMilligrams(toMilligrams('999999999999999.999'))).toBe('999999999999999.999');
  });
  it.each(['25,000', '5.0001', '-1', 'Infinity', '1e4', '٢٥٬٠٠٠', '', '1000000000000000'])(
    'rejects ambiguous, out of range or unsupported input %s',
    (value) => expect(() => normalizeWeightInput(value)).toThrow(),
  );
  it('permits signed report differences without allowing negative stock inputs', () =>
    expect(fromMilligrams(-100000n)).toBe('-100.000'));
  it('rejects zero and malformed positive weights as validation results', () => {
    expect(positiveWeightSchema.safeParse('0.000').success).toBe(false);
    expect(positiveWeightSchema.safeParse('not-a-weight').success).toBe(false);
    expect(positiveWeightSchema.safeParse('0.001').success).toBe(true);
  });
});

const minute = 60_000;
const base: StageTiming = {
  status: 'running',
  timeBasis: 'active_time',
  startedAt: 0,
  targetDurationMs: 240 * minute,
  reachedDueAt: null,
  stoppages: [],
};
describe('Astra timing acceptance examples', () => {
  it('extends active processing for an actual 45 minute pause', () => {
    const state = {
      ...base,
      stoppages: [
        {
          startedAt: 90 * minute,
          endedAt: 135 * minute,
          resumedAt: 135 * minute,
          endReason: 'resumed' as const,
        },
      ],
    };
    expect(inspectTiming(state, 135 * minute)).toEqual({
      reachedDueAt: null,
      remainingMs: 150 * minute,
      expectedAt: 285 * minute,
    });
    expect(inspectTiming(state, 300 * minute).reachedDueAt).toBe(285 * minute);
  });
  it('keeps a paused active timer without a fictional expected completion', () => {
    expect(
      inspectTiming(
        {
          ...base,
          status: 'paused',
          stoppages: [{ startedAt: 90 * minute, endedAt: null, resumedAt: null, endReason: null }],
        },
        200 * minute,
      ),
    ).toEqual({ reachedDueAt: null, remainingMs: 150 * minute, expectedAt: null });
  });
  it('does not freeze elapsed time and resumes while inspection remains required', () => {
    const stop = { startedAt: 30 * minute, endedAt: null, resumedAt: null, endReason: null };
    expect(
      inspectTiming(
        { ...base, timeBasis: 'elapsed_time', targetDurationMs: 60 * minute, stoppages: [stop] },
        70 * minute,
      ).reachedDueAt,
    ).toBe(60 * minute);
    const ended = endStoppage(stop, 70 * minute, 'resumed');
    expect(ended.endedAt! - ended.startedAt).toBe(40 * minute);
    expect(ended.resumedAt).toBe(70 * minute);
    expect(statusAfterResume('awaiting_inspection', 60 * minute)).toBe('awaiting_inspection');
  });
  it('ends a stoppage on completion without inventing a resume', () => {
    const ended = endStoppage(
      { startedAt: 30 * minute, endedAt: null, resumedAt: null, endReason: null },
      80 * minute,
      'stage_completed',
    );
    expect(ended.endedAt! - ended.startedAt).toBe(50 * minute);
    expect(ended.resumedAt).toBeNull();
    expect(() => endStoppage(ended, 90 * minute, 'resumed')).toThrow();
  });
  it('retains a previously reached due time after a later pause', () => {
    const state = {
      ...base,
      targetDurationMs: 60 * minute,
      reachedDueAt: 60 * minute,
      stoppages: [{ startedAt: 70 * minute, endedAt: null, resumedAt: null, endReason: null }],
    };
    expect(inspectTiming(state, 90 * minute).reachedDueAt).toBe(60 * minute);
    expect(statusAfterResume('paused', 60 * minute)).toBe('awaiting_inspection');
  });
  it('rejects completing or restarting terminal stages as a resume', () =>
    expect(() => statusAfterResume('completed', 60 * minute)).toThrow());
});
it('uses the version read from the server', () => {
  expect(() => requireExpectedVersion(3, 3)).not.toThrow();
  expect(() => requireExpectedVersion(3, 4)).toThrow('VERSION_CONFLICT');
});
