import { getPool } from './db';
import { requireAssetAccess, type Member } from './members';
import { reportRangeSchema, type ReportRange, type FactoryReport } from '../contracts/reports';
import { getFactorySettings } from './settings';
import { factoryProfile } from '../config/factory-profile';

export async function reportContext(member: Member) {
  requireAssetAccess(member);
  const settings = await getFactorySettings(member);
  const timezone = settings.timezone ?? factoryProfile.timezone;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return {
    timezone,
    weekStart: settings.week_starts_on ?? 1,
    today: `${part('year')}-${part('month')}-${part('day')}`,
    name: settings.name || factoryProfile.name,
  };
}
export async function getFactoryReport(member: Member, input: ReportRange): Promise<FactoryReport> {
  requireAssetAccess(member);
  const range = reportRangeSchema.parse(input);
  const { timezone } = await reportContext(member);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const values = [range.from, range.to, timezone];
    const period = (alias = '') =>
      `${alias}created_at >= ($1::date::timestamp AT TIME ZONE $3) AND ${alias}created_at < (($2::date+1)::timestamp AT TIME ZONE $3)`;
    // Count only positive movement legs; the matching negative ledger leg must not double totals.
    const totals = (
      await client.query<FactoryReport['totals']>(
        `WITH movement AS (
      SELECT m.id,m.kind,sum(l.quantity_g) AS quantity FROM material_movements m JOIN movement_lines l ON l.movement_id=m.id
      WHERE ${period('m.')} AND l.quantity_g>0 GROUP BY m.id,m.kind
    ) SELECT
      coalesce(sum(quantity) FILTER(WHERE kind='receipt'),0)::text AS received,
      coalesce(sum(quantity) FILTER(WHERE kind='opening'),0)::text AS opening,
      coalesce(sum(quantity) FILTER(WHERE kind='reversal'),0)::text AS reversed,
      coalesce(sum(quantity) FILTER(WHERE kind='fermentation_start'),0)::text AS fermented,
      coalesce(sum(quantity) FILTER(WHERE kind IN ('withdrawal','production_start')),0)::text AS withdrawn,
      count(*) FILTER(WHERE kind IN ('receipt','opening'))::int AS receipts,
      count(*) FILTER(WHERE kind='fermentation_start')::int AS batches,
      count(*) FILTER(WHERE kind IN ('withdrawal','production_start'))::int AS orders FROM movement`,
        values,
      )
    ).rows[0];
    const current = (
      await client.query<FactoryReport['current']>(`SELECT
      coalesce(sum(b.quantity_g) FILTER(WHERE a.raw_lot_id IS NOT NULL),0)::text AS raw,
      coalesce(sum(b.quantity_g) FILTER(WHERE a.fermentation_id IS NOT NULL),0)::text AS fermentation,
      coalesce(sum(b.quantity_g) FILTER(WHERE a.stage_run_id IS NOT NULL),0)::text AS oven,
      (SELECT count(*)::int FROM stage_runs WHERE kind='fermentation' AND status='running') AS running,
      (SELECT count(*)::int FROM fermentations f JOIN material_accounts a ON a.fermentation_id=f.id JOIN material_balances b ON b.account_id=a.id WHERE f.status='ready' AND b.quantity_g>0) AS ready,
      (SELECT count(*)::int FROM stage_runs WHERE kind='fermentation' AND status='running' AND now()>due_at+((policy->>'grace_minutes')::int*interval '1 minute')) AS late
      FROM material_accounts a JOIN material_balances b ON b.account_id=a.id WHERE a.external_kind IS NULL`)
    ).rows[0];
    const bucket = Date.parse(range.to) - Date.parse(range.from) > 62 * 86400000 ? 'month' : 'day';
    const series = (
      await client.query<FactoryReport['series'][number]>(
        `SELECT to_char(date_trunc('${bucket}',created_at AT TIME ZONE $3),'YYYY-MM-DD') AS day,sum(quantity_g)::text AS quantity FROM production_orders WHERE ${period()} GROUP BY 1 ORDER BY 1`,
        values,
      )
    ).rows;
    const products = (
      await client.query<FactoryReport['products'][number]>(
        `SELECT p.id,p.name,sum(o.quantity_g)::text AS entered,sum(o.quantity_g)::text AS withdrawn
         FROM production_orders o
         LEFT JOIN fermentations f ON f.id=o.fermentation_id
         JOIN products p ON p.id=coalesce(o.target_product_id,f.target_product_id)
         WHERE ${period('o.')}
         GROUP BY p.id,p.name
         ORDER BY sum(o.quantity_g) DESC,p.created_at DESC,p.id LIMIT 50`,
        values,
      )
    ).rows;
    const operations = (
      await client.query<FactoryReport['operations'][number]>(
        `SELECT o.id,o.code::text,p.name AS name,o.quantity_g::text AS quantity,
      CASE WHEN s.status='queued' THEN 'queued' WHEN now()>s.due_at+((s.policy->>'grace_minutes')::int*interval '1 minute') THEN 'late' WHEN now()>=s.due_at THEN 'inspection' ELSE 'running' END AS status,
      coalesce(to_char(s.due_at AT TIME ZONE $1,'YYYY-MM-DD HH24:MI'),'—') AS due,1::int AS orders
      FROM production_orders o
      LEFT JOIN fermentations f ON f.id=o.fermentation_id
      JOIN products p ON p.id=coalesce(o.target_product_id,f.target_product_id)
      JOIN stage_runs s ON s.production_order_id=o.id
      LEFT JOIN order_processing op ON op.order_id=o.id
      WHERE op.state IS NULL OR op.state NOT IN ('stored','sold','discarded')
      ORDER BY s.due_at NULLS LAST,o.created_at DESC,o.id LIMIT 25`,
        [timezone],
      )
    ).rows;
    const generatedAt = (
      await client.query<{ stamp: string }>(
        `SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD HH24:MI') AS stamp`,
        [timezone],
      )
    ).rows[0].stamp;
    const production = (
      await client.query(
        `SELECT
     coalesce(sum(r.output_g) FILTER(WHERE r.kind='oven'),0)::text AS oven,
     coalesce(sum(r.output_g) FILTER(WHERE r.kind='filter'),0)::text AS filtered,
     coalesce(sum(r.output_g) FILTER(WHERE r.kind='packing'),0)::text AS packed,
     coalesce(round(100*sum(r.output_g) FILTER(WHERE r.kind='packing') / nullif(sum(o.quantity_g) FILTER(WHERE r.kind='packing'),0),2),0)::text AS yield_percent
     FROM processing_results r JOIN production_orders o ON o.id=r.order_id WHERE ${period('r.').replaceAll('r.created_at', 'r.completed_at')}`,
        values,
      )
    ).rows[0];
    const dispatch = (
      await client.query(
        `SELECT coalesce(sum(quantity_g) FILTER(WHERE destination='stored'),0)::text AS stored,coalesce(sum(quantity_g) FILTER(WHERE destination='sold'),0)::text AS sold FROM production_dispatches WHERE ${period()}`,
        values,
      )
    ).rows[0];
    const stock = (
      await client.query(
        `SELECT coalesce(sum(b.quantity_g) FILTER(WHERE op.state='stored'),0)::text AS inventory,coalesce(sum(b.quantity_g) FILTER(WHERE op.state='finished'),0)::text AS pending,coalesce(sum(b.quantity_g) FILTER(WHERE op.state IN ('filter_queued','filter_running','packing_queued','packing_running')),0)::text AS in_process FROM order_processing op JOIN material_accounts a ON a.production_order_id=op.order_id JOIN material_balances b ON b.account_id=a.id`,
      )
    ).rows[0];
    const finishedInventory = (
      await client.query(
        `SELECT o.id,f.id AS batch_id,p.name,o.sequence_no,b.quantity_g::text AS quantity,op.state FROM order_processing op JOIN production_orders o ON o.id=op.order_id JOIN fermentations f ON f.id=o.fermentation_id JOIN products p ON p.id=f.target_product_id JOIN material_accounts a ON a.production_order_id=o.id JOIN material_balances b ON b.account_id=a.id WHERE op.state IN ('stored','finished') AND b.quantity_g>0 ORDER BY op.updated_at DESC,o.id LIMIT 25`,
      )
    ).rows;
    const processing = { ...production, ...dispatch, ...stock };
    await client.query('COMMIT');
    return {
      processing,
      finishedInventory,
      range,
      timezone,
      generatedAt,
      totals,
      current,
      series,
      products,
      operations,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
