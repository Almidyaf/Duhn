import { formatWeight } from '@/contracts/weight';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { Shell } from '@/components/shell';
import { requireMember } from '@/server/members';
import { AppError } from '@/server/errors';
import { getFactoryReport, reportContext } from '@/server/reports';
import {
  formatGrams,
  reportRange,
  reportPeriods,
  type ReportPeriod,
  type FactoryReport,
} from '@/contracts/reports';
import { ReportFilter } from '@/features/reports/report-filter';
import { reportsUi as r } from '@/locales/ar/reports';
export const dynamic = 'force-dynamic';
export const metadata = { title: r.title };
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const member = await requireMember(await headers()).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 401) redirect('/login');
    if (error instanceof AppError && error.status === 403) redirect('/access');
    throw error;
  });
  if (member.role === 'operator') redirect('/access');
  const context = await reportContext(member),
    params = await searchParams;
  let period: ReportPeriod = 'month',
    anchor = context.today,
    range = reportRange('month', anchor),
    invalid = false;
  try {
    period = z.enum(reportPeriods).parse(params.period ?? 'month');
    anchor = z.iso.date().parse(params.anchor ?? context.today);
    range = reportRange(
      period,
      anchor,
      { from: String(params.from ?? ''), to: String(params.to ?? '') },
      context.weekStart,
    );
  } catch {
    invalid = true;
  }
  const data = invalid ? null : await getFactoryReport(member, range, context.timezone);
  return (
    <Shell member={member} section="reports">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{context.name}</p>
          <h1>{r.title}</h1>
          <p className="muted">{r.lead}</p>
        </div>
        <Link className="secondary-button" href="/production">
          فتح خط الإنتاج
        </Link>
      </div>
      <ReportFilter
        key={`${period}:${anchor}:${range.from}:${range.to}`}
        period={period}
        anchor={anchor}
        from={range.from}
        to={range.to}
      />
      {invalid ? (
        <p className="notice danger" role="alert">
          اختر تاريخين صحيحين؛ تاريخ النهاية لا يسبق البداية، والفترة لا تتجاوز عشر سنوات.
        </p>
      ) : (
        data && <ReportBody data={data} />
      )}
    </Shell>
  );
}
function ReportBody({ data: d }: { data: FactoryReport }) {
  const max = Math.max(...d.series.map((s) => Number(s.quantity)), 1);
  const metrics = [
    ['مواد خام متاحة', d.current.raw],
    ['في مرحلة الفرن', d.current.oven],
    ['قيد التصفية والتعبئة', d.processing.in_process],
    ['معبأ بانتظار التصريف', d.processing.pending],
    ['مخزون المنتج النهائي', d.processing.inventory],
  ];
  const movements = [
    ['استلام مشتريات', d.totals.received],
    ['تسجيل مواد موجودة مسبقًا', d.totals.opening],
    ['كميات استلام ملغاة', d.totals.reversed],
    ['دخل خط الإنتاج', d.totals.fermented],
    ['الناتج بعد الفرن', d.processing.oven],
    ['الناتج بعد التصفية', d.processing.filtered],
    ['الناتج المعبأ', d.processing.packed],
    ['المنقول إلى المخزون', d.processing.stored],
    ['البيع اللحظي', d.processing.sold],
  ];
  return (
    <>
      <p className="record-note">
        آخر قراءة: <bdi>{d.generatedAt}</bdi> · توقيت المصنع: <bdi>{d.timezone}</bdi>. حدّث التقرير
        لقراءة أحدث الحركات.
      </p>
      <h2 className="report-section-title">الأرصدة الحالية</h2>
      <p className="muted">هذه الكميات موجودة الآن؛ لا تتغير بتغيير فترة التقرير.</p>
      <div className="report-metrics">
        {metrics.map(([label, value]) => (
          <article className="report-metric" key={label}>
            <span>{label}</span>
            <strong dir="ltr">
              {formatGrams(value)} <small>جم</small>
            </strong>
          </article>
        ))}
      </div>
      <p>
        نسبة الناتج للعمليات المكتملة خلال الفترة:{' '}
        <strong dir="ltr">{formatWeight(d.processing.yield_percent)}%</strong>
      </p>
      <section className="assets-panel report-panel">
        <h2>المنتج النهائي المتاح الآن</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>المنتج</th>
                <th>الجزء</th>
                <th>الكمية</th>
                <th>الحالة</th>
                <th>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {d.finishedInventory.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.sequence_no}</td>
                  <td>
                    <bdi>{formatGrams(item.quantity)} جم</bdi>
                  </td>
                  <td>{item.state === 'stored' ? 'في المخزون' : 'بانتظار التصريف'}</td>
                  <td>
                    <Link href={'/production/' + item.batch_id}>فتح الدفعة</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!d.finishedInventory.length && (
          <p className="empty-state">لا يوجد منتج نهائي متاح حاليًا.</p>
        )}
      </section>
      <div className="report-status-strip">
        <span>
          دفعات قيد التخمير أو الفحص: <strong>{d.current.running}</strong>
        </span>
        <span>
          جاهزة للسحب: <strong>{d.current.ready}</strong>
        </span>
        <span className={d.current.late ? 'report-late' : ''}>
          تأخر تأكيد فحصها: <strong>{d.current.late}</strong>
        </span>
      </div>
      <h2 className="report-section-title">
        حركة الفترة: <bdi>{d.range.from}</bdi> إلى <bdi>{d.range.to}</bdi>
      </h2>
      <p className="muted">
        تشمل يوم البداية والنهاية بتوقيت المصنع. كل حركة تُحسب في تاريخ حدوثها؛ الكميات عبر المراحل
        لا تُجمع كإنتاج نهائي.
      </p>
      <div className="report-metrics report-movements">
        {movements.map(([label, value]) => (
          <article className="report-metric" key={label}>
            <span>{label}</span>
            <strong dir="ltr">
              {formatGrams(value)} <small>جم</small>
            </strong>
          </article>
        ))}
      </div>
      <div className="report-status-strip">
        <span>{d.totals.receipts} عمليات إدخال مواد</span>
        <span>{d.totals.batches} دفعات تخمير جديدة</span>
        <span>{d.totals.orders} عمليات سحب للإنتاج</span>
      </div>
      <div className="report-columns">
        <section className="assets-panel report-panel">
          <h2>تطور الكمية الداخلة للتخمير</h2>
          <p className="muted">
            بالجرام · عرض شهري للفترات الأطول من 63 يومًا. الفترات دون حركات لا تظهر.
          </p>
          {d.series.length ? (
            <div className="report-bars" role="list" aria-label="حركة التخمير حسب التاريخ">
              {d.series.map((row) => (
                <div role="listitem" className="report-bar-row" key={row.day}>
                  <bdi>{row.day}</bdi>
                  <div className="report-bar-track" aria-hidden="true">
                    <span style={{ width: `${(Number(row.quantity) / max) * 100}%` }} />
                  </div>
                  <strong dir="ltr">{formatGrams(row.quantity)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">لا توجد دفعات تخمير بدأت خلال هذه الفترة.</p>
          )}
        </section>
        <section className="assets-panel report-panel">
          <h2>حركة المنتجات خلال الفترة</h2>
          <p className="muted">أعلى 50 منتجًا حسب الكمية الداخلة للتخمير.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>دخل التخمير (جم)</th>
                  <th>سُحب للإنتاج (جم)</th>
                </tr>
              </thead>
              <tbody>
                {d.products.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td dir="ltr">{formatGrams(p.entered)}</td>
                    <td dir="ltr">{formatGrams(p.withdrawn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!d.products.length && (
            <p className="empty-state">لا توجد حركة منتجات في الفترة المختارة.</p>
          )}
        </section>
      </div>
      <section className="assets-panel report-panel">
        <h2>الدفعات الجارية الآن</h2>
        <p className="muted">
          أقرب 25 دفعة لموعد الفحص ولها كمية متبقية، بغض النظر عن الفترة المختارة. الأجزاء المسحوبة
          في مرحلة الفرن، وتشمل الأجزاء المنتظرة والجاري تشغيلها.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الدفعة / المنتج</th>
                <th>المتبقي (جم)</th>
                <th>موعد الفحص</th>
                <th>الحالة</th>
                <th>الأجزاء المسحوبة</th>
              </tr>
            </thead>
            <tbody>
              {d.operations.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/production/${o.id}`}>
                      B-{o.code.padStart(4, '0')} · {o.name}
                    </Link>
                  </td>
                  <td dir="ltr">{formatGrams(o.quantity)}</td>
                  <td>
                    <bdi>{o.due}</bdi>
                  </td>
                  <td>
                    <span className={`status-pill ${o.status === 'late' ? 'inactive' : 'active'}`}>
                      {r.status[o.status as keyof typeof r.status]}
                    </span>
                  </td>
                  <td>{o.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!d.operations.length && <p className="empty-state">لا توجد دفعات جارية حاليًا.</p>}
      </section>
      <p className="notice warning">
        السجلات التي تحمل كلمة «تجريبي» بيانات اختبار وتدخل ضمن الأرقام المعروضة. تقارير الناتج
        النهائي والتعبئة والبيع تُحسب من العمليات المؤكدة؛ لا تُعرض لها أرقام افتراضية.
      </p>
    </>
  );
}
