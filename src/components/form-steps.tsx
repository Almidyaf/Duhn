import { Check } from 'lucide-react';
import { workflowUi as w } from '@/locales/ar/workflow';
export function FormSteps({ labels, current }: { labels: readonly string[]; current: number }) {
  return (
    <ol className="form-steps" aria-label={w.steps}>
      {labels.map((label, i) => (
        <li
          key={label}
          className={i === current ? 'current' : i < current ? 'complete' : ''}
          aria-current={i === current ? 'step' : undefined}
        >
          <span className="step-number" aria-hidden="true">
            {i < current ? <Check size={15} /> : i + 1}
          </span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}
