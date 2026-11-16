'use client';
import { FlaskConical } from 'lucide-react';
import { AnimatedFlame } from './animated-flame';
export function timeProgress(start: number, due: number, now: number) {
  const elapsed =
    due > start
      ? Math.max(0, Math.min(100, ((now - start) / (due - start)) * 100))
      : now >= due
        ? 100
        : 0;
  return { elapsed, remaining: Math.ceil(100 - elapsed) };
}
export function StageProgress({
  start,
  due,
  now,
  kind,
  compact = false,
  paused = false,
}: {
  start: number;
  due: number;
  now: number;
  kind: 'fermentation' | 'oven';
  compact?: boolean;
  paused?: boolean;
}) {
  const { elapsed } = timeProgress(start, due, now),
    running = now < due;
  const completed = Math.floor(elapsed);
  return (
    <div
      className={`stage-progress ${kind} ${paused ? 'paused' : running ? 'moving' : 'due'} ${compact ? 'compact' : ''}`}
    >
      <div className="stage-progress-meta">
        <span className="stage-motion" aria-hidden="true">
          {kind === 'oven' ? (
            <AnimatedFlame active={running && !paused} size={compact ? 24 : 32} />
          ) : (
            <FlaskConical size={compact ? 18 : 24} />
          )}
          {kind === 'fermentation' && (
            <>
              <i />
              <i />
              <i />
            </>
          )}
        </span>
        <span>{paused ? 'متوقف مؤقتًا' : running ? 'تقدم المدة' : 'جاهز للفحص'}</span>
        <bdi>{completed}%</bdi>
      </div>
      <div
        className="stage-progress-track"
        role="progressbar"
        aria-label={`المدة المنقضية — ${kind === 'oven' ? 'الفرن' : 'التخمير'}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(elapsed)}
        aria-valuetext={`تقدم المدة ${completed}%`}
      >
        <span className="stage-progress-fill" style={{ width: `${elapsed}%` }} />
      </div>
    </div>
  );
}
