import { getPool, transaction } from './db';
import { requireAssetAccess, type Member } from './members';
const topics: Record<string, string> = {
  'oven.paused': 'توقف تشغيل الفرن',
  'oven.resumed': 'استؤنف تشغيل الفرن',
  'oven.completed': 'اكتملت مرحلة الفرن',
  'filter.started': 'بدأت التصفية',
  'filter.completed': 'اكتملت التصفية',
  'packing.started': 'بدأت التعبئة',
  'packing.completed': 'اكتملت التعبئة',
  'production.stored': 'نُقل المنتج إلى المخزون',
  'production.sold': 'تم البيع اللحظي',
  'receipt.posted': 'تم تسجيل استلام مواد',
  'receipt.voided': 'تم إلغاء استلام مواد',
  'production.started': 'تم بدء أمر إنتاج جديد',
  'fermentation.started': 'بدأ تخمير دفعة',
  'fermentation.ready': 'تم اعتماد الجاهزية للسحب',
  'fermentation.withdrawn': 'تم سحب كمية إلى الإنتاج',
  'oven.started': 'بدأ تشغيل الفرن',
};
export async function syncNotifications(member: Member) {
  requireAssetAccess(member);
  const topicEntries = Object.entries(topics);
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO notifications(id,title,body,href,severity,occurred_at)
       SELECT
         'event:' || e.id::text,
         t.title,
         CASE
           WHEN p.name IS NOT NULL AND (o.code IS NOT NULL OR f.code IS NOT NULL) THEN
             p.name || ' · ' ||
             (CASE WHEN o.code IS NOT NULL THEN 'PRD-' || lpad(o.code::text, 6, '0') ELSE 'B-' || lpad(f.code::text, 6, '0') END) ||
             coalesce(' · ' || nullif(e.payload->>'quantity_g', '') || ' جم', '')
           ELSE 'سند الاستلام ' || coalesce(r.code::text, '')
         END,
         CASE
           WHEN o.id IS NOT NULL THEN '/production/' || o.id::text
           WHEN f.id IS NOT NULL THEN '/production/' || f.id::text
           ELSE '/purchases/' || e.entity_id::text
         END,
         'info',
         e.created_at
       FROM outbox_events e
       JOIN unnest($1::text[], $2::text[]) AS t(topic, title) ON t.topic = e.topic
       LEFT JOIN production_orders o ON o.id=coalesce((e.payload->>'order_id')::uuid,e.entity_id)
       LEFT JOIN fermentations f ON f.id=CASE WHEN e.topic IN ('fermentation.started','fermentation.ready') THEN e.entity_id ELSE o.fermentation_id END
       LEFT JOIN products p ON p.id=coalesce(o.target_product_id,f.target_product_id)
       LEFT JOIN receipts r ON r.id=e.entity_id
       WHERE NOT EXISTS(SELECT FROM notifications n WHERE n.id='event:'||e.id::text)
       ORDER BY e.created_at DESC,e.id DESC LIMIT 200
       ON CONFLICT DO NOTHING`,
      [topicEntries.map(([k]) => k), topicEntries.map(([, v]) => v)],
    );
    await client.query(`INSERT INTO notifications(id,title,body,href,severity,occurred_at)
   SELECT 'stage:'||s.id::text||':'||v.kind||':'||floor(extract(epoch FROM s.due_at)*1000)::bigint::text,
    'الفرن: '||v.title,
    p.name||' · PRD-'||lpad(o.code::text,6,'0'), '/production/'||o.id::text,v.severity,v.at
   FROM stage_runs s
   JOIN production_orders o ON o.id=s.production_order_id
   LEFT JOIN fermentations f ON f.id=o.fermentation_id
   JOIN products p ON p.id=coalesce(o.target_product_id,f.target_product_id)
   CROSS JOIN LATERAL (VALUES
    ('soon','اقترب موعد الفحص','warning',s.due_at-make_interval(mins=>(s.policy->>'warning_minutes')::int)),
    ('due','حان موعد الفحص','warning',s.due_at),
    ('late','تأخر تأكيد الفحص','danger',s.due_at+make_interval(mins=>(s.policy->>'grace_minutes')::int))
   ) v(kind,title,severity,at)
   WHERE s.kind='oven' AND s.status='running' AND NOT EXISTS(SELECT FROM oven_pauses z WHERE z.order_id=s.production_order_id AND z.ended_at IS NULL) AND v.at<=statement_timestamp()
    AND (v.kind<>'soon' OR ((s.policy->>'warning_minutes')::int>0 AND s.due_at>statement_timestamp()))
   ON CONFLICT DO NOTHING`);
  });
}
export async function listNotifications(member: Member, before?: { at: string; id: string }) {
  await syncNotifications(member);
  const values: unknown[] = [member.id];
  let filter = '';
  if (before) {
    values.push(before.at, before.id);
    filter = 'WHERE (n.occurred_at,n.id)<($2::timestamptz,$3::text)';
  }
  const row = (
    await getPool().query<{
      unread_count: number;
      items: Array<{
        id: string;
        title: string;
        body: string;
        href: string;
        severity: string;
        occurred_at: string;
        is_read: boolean;
      }>;
    }>(
      `WITH unread AS (
        SELECT count(*)::int AS count FROM notifications n
        WHERE NOT EXISTS(SELECT FROM notification_reads r WHERE r.notification_id=n.id AND r.user_id=$1)
      )
      SELECT
        (SELECT count FROM unread) AS unread_count,
        coalesce((
          SELECT jsonb_agg(row_to_json(x)) FROM (
            SELECT n.id,n.title,n.body,n.href,n.severity,
              to_char(n.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
              r.read_at IS NOT NULL AS is_read
            FROM notifications n
            LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=$1 ${filter}
            ORDER BY n.occurred_at DESC,n.id DESC LIMIT 31
          ) x
        ), '[]'::jsonb) AS items`,
      values,
    )
  ).rows[0];
  const items = row.items.slice(0, 30),
    last = items.at(-1);
  return {
    items,
    unread_count: row.unread_count,
    next_cursor: row.items.length > 30 && last ? { at: last.occurred_at, id: last.id } : null,
  };
}
export async function readNotifications(member: Member, ids?: string[]) {
  requireAssetAccess(member);
  await getPool().query(
    `INSERT INTO notification_reads(user_id,notification_id) SELECT $1,id FROM notifications ${ids ? 'WHERE id=ANY($2::text[])' : ''} ON CONFLICT DO NOTHING`,
    ids ? [member.id, ids] : [member.id],
  );
  return { ok: true };
}
