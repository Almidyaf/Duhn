export type StageStatus =
  'queued' | 'running' | 'paused' | 'awaiting_inspection' | 'on_hold' | 'completed' | 'cancelled';
export type StoppageEndReason = 'resumed' | 'stage_completed' | 'cancelled' | 'superseded';
export type Stoppage = {
  startedAt: number;
  endedAt: number | null;
  resumedAt: number | null;
  endReason: StoppageEndReason | null;
};
export type StageTiming = {
  status: StageStatus;
  timeBasis: 'active_time' | 'elapsed_time';
  startedAt: number;
  targetDurationMs: number;
  reachedDueAt: number | null;
  stoppages: Stoppage[];
};

export function inspectTiming(stage: StageTiming, now: number) {
  if (now < stage.startedAt || stage.targetDurationMs < 0) throw new Error('INVALID_TIME');
  let cursor = stage.startedAt;
  let remaining = stage.targetDurationMs;
  let computedDue: number | null =
    stage.timeBasis === 'elapsed_time' ? stage.startedAt + remaining : null;
  if (stage.timeBasis === 'active_time') {
    for (const stop of stage.stoppages) {
      if (
        stop.startedAt < cursor ||
        stop.startedAt > now ||
        (stop.endedAt !== null && (stop.endedAt < stop.startedAt || stop.endedAt > now))
      )
        throw new Error('INVALID_STOPPAGE');
      const interval = stop.startedAt - cursor;
      if (remaining <= interval) {
        computedDue = cursor + remaining;
        break;
      }
      remaining -= interval;
      if (stop.endedAt === null) {
        return {
          reachedDueAt: stage.reachedDueAt,
          remainingMs: stage.reachedDueAt === null ? remaining : 0,
          expectedAt: null,
        };
      }
      cursor = stop.endedAt;
    }
    computedDue ??= cursor + remaining;
  }
  if (computedDue === null) throw new Error('INVALID_TIME');
  const reachedDueAt = stage.reachedDueAt ?? (computedDue <= now ? computedDue : null);
  return {
    reachedDueAt,
    remainingMs: reachedDueAt !== null ? 0 : Math.max(computedDue - now, 0),
    expectedAt: computedDue,
  };
}

export function endStoppage(stop: Stoppage, at: number, reason: StoppageEndReason): Stoppage {
  if (stop.endedAt !== null || at < stop.startedAt) throw new Error('INVALID_STOPPAGE');
  return { ...stop, endedAt: at, resumedAt: reason === 'resumed' ? at : null, endReason: reason };
}

export function statusAfterResume(status: StageStatus, reachedDueAt: number | null): StageStatus {
  if (status !== 'paused' && status !== 'awaiting_inspection')
    throw new Error('INVALID_TRANSITION');
  return reachedDueAt !== null || status === 'awaiting_inspection'
    ? 'awaiting_inspection'
    : 'running';
}
