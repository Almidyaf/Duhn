'use client';
import { useState } from 'react';
import Link from 'next/link';
import { reportPeriods, type ReportPeriod } from '@/contracts/reports';
import { reportsUi as r } from '@/locales/ar/reports';
export function ReportFilter({
  period,
  anchor,
  from,
  to,
}: {
  period: ReportPeriod;
  anchor: string;
  from: string;
  to: string;
}) {
  const [selected, setSelected] = useState(period);
  return (
    <form action="/reports" method="get" className="report-filter assets-panel">
      <div className="button-row" role="group" aria-label="اختصارات الفترة">
        {(
          [
            ['day', 'اليوم'],
            ['week', 'هذا الأسبوع'],
            ['month', 'هذا الشهر'],
            ['year', 'هذه السنة'],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={`/reports?period=${key}`}
            className={period === key ? 'secondary-button' : 'quiet-button'}
          >
            {label}
          </Link>
        ))}
      </div>
      <label>
        الفترة
        <select
          aria-label="الفترة"
          name="period"
          value={selected}
          onChange={(e) => setSelected(e.target.value as ReportPeriod)}
        >
          {reportPeriods.map((p) => (
            <option key={p} value={p}>
              {r.periods[p]}
            </option>
          ))}
        </select>
      </label>
      {selected === 'custom' ? (
        <>
          <label>
            من تاريخ
            <input type="date" name="from" required defaultValue={from} />
          </label>
          <label>
            إلى تاريخ
            <input type="date" name="to" required defaultValue={to} />
          </label>
        </>
      ) : (
        <label>
          تاريخ ضمن الفترة
          <input
            type="date"
            name="anchor"
            required
            defaultValue={anchor}
            aria-describedby="report-period-help"
          />
        </label>
      )}
      <button className="primary-button">عرض التقرير</button>
      <small id="report-period-help" className="field-hint">
        اختر أي يوم ضمن الأسبوع أو الشهر أو السنة المطلوبة. تظهر حدود الفترة في التقرير.
      </small>
    </form>
  );
}
