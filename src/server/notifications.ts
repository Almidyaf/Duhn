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
  await transaction(async (client) => {
    const events = await client.query(
      `SELECT e.*,p.name AS product_name,o.id AS order_id,o.code::text AS order_code,
    f.id AS batch_id,f.code::text AS batch_code,r.code::text AS receipt_code FROM outbox_events e
    LEFT JOIN production_orders o ON o.id=coalesce((e.payload->>'order_id')::uuid,e.entity_id)
    LEFT JOIN fermentations f ON f.id=CASE WHEN e.topic IN ('fermentation.started','fermentation.ready') THEN e.entity_id ELSE o.fermentation_id END
    LEFT JOIN products p ON p.id=coalesce(o.target_product_id,f.target_product_id)
    LEFT JOIN receipts r ON r.id=e.entity_id
    WHERE e.topic=ANY($1::text[]) AND NOT EXISTS(SELECT FROM notifications n WHERE n.id='event:'||e.id::text)
    ORDER BY e.created_at DESC,e.id DESC LIMIT 200`,
      [Object.keys(topics)],
    );
    for (const e of events.rows) {
      const code = e.order_code
        ? `PRD-${String(e.order_code).padStart(6, '0')}`
        : e.batch_code
          ? `B-${String(e.batch_code).padStart(6, '0')}`
          : '';
      const body =
        e.product_name && code
          ? `${e.product_name} · ${code}${e.payload.quantity_g ? ' · ' + e.payload.quantity_g + ' جم' : ''}`
          : `سند الاستلام ${e.receipt_code ?? ''}`;
      const href = e.order_id
        ? '/production/' + e.order_id
        : e.batch_id
          ? '/production/' + e.batch_id
          : '/purchases/' + e.entity_id;
      await client.query(
        `INSERT INTO notifications VALUES($1,$2,$3,$4,'info',$5) ON CONFLICT DO NOTHING`,
        ['event:' + e.id, topics[e.topic], body, href, e.created_at],
      );
    }
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
  const result = await getPool().query(
    `SELECT n.*,r.read_at IS NOT NULL AS is_read FROM notifications n
 LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=$1 ${filter}
 ORDER BY n.occurred_at DESC,n.id DESC LIMIT 31`,
    values,
  );
  const count = await getPool().query(
    `SELECT count(*)::int AS count FROM notifications n WHERE NOT EXISTS(SELECT FROM notification_reads r WHERE r.notification_id=n.id AND r.user_id=$1)`,
    [member.id],
  );
  const items = result.rows.slice(0, 30),
    last = items.at(-1);
  return {
    items,
    unread_count: count.rows[0].count,
    next_cursor:
      result.rows.length > 30 && last ? { at: last.occurred_at.toISOString(), id: last.id } : null,
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
