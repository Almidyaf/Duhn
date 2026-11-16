import { randomUUID } from 'node:crypto';
import { processingSchema, type ProcessingInput } from '../contracts/processing';
import { toMilligrams, fromMilligrams } from '../contracts/weight';
import { writeOnce } from './write-once';
import type { Member } from './members';
import { AppError } from './errors';
import { lockBalances, postMovement } from './material-ledger';
export function processOrder(member: Member, key: string, orderId: string, input: ProcessingInput) {
  const parsed = processingSchema.parse(input);
  return writeOnce(member, key, `processing:${orderId}`, parsed, async (client) => {
    const identity = (
      await client.query(`SELECT s.id,s.asset_id FROM stage_runs s WHERE production_order_id=$1`, [
        orderId,
      ])
    ).rows[0];
    if (!identity) throw new AppError('NOT_FOUND', 404);
    if (identity.asset_id)
      await client.query('SELECT id FROM assets WHERE id=$1 FOR UPDATE', [identity.asset_id]);
    const stage = (
      await client.query('SELECT * FROM stage_runs WHERE id=$1 FOR UPDATE', [identity.id])
    ).rows[0];
    const row = (
      await client.query('SELECT * FROM order_processing WHERE order_id=$1 FOR UPDATE', [orderId])
    ).rows[0];
    const context = (
      await client.query(
        `SELECT o.quantity_g::text,coalesce(o.raw_product_id,f.raw_product_id) AS raw_product_id,coalesce(o.target_product_id,f.target_product_id) AS target_product_id FROM production_orders o LEFT JOIN fermentations f ON f.id=o.fermentation_id WHERE o.id=$1`,
        [orderId],
      )
    ).rows[0];
    const completingOven = parsed.action === 'complete_oven';
    const ovenAction =
      completingOven || parsed.action === 'pause_oven' || parsed.action === 'resume_oven';
    if ((ovenAction ? stage.version : row?.version) !== parsed.expected_version)
      throw new AppError('VERSION_CONFLICT', 409);
    const event = async (topic: string, payload: object, eventEntity = orderId) => {
      await client.query(
        'INSERT INTO audit_events(id,actor_id,action,entity_id,after_value,request_key) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
        [randomUUID(), member.id, topic, orderId, JSON.stringify(payload), key],
      );
      await client.query(
        'INSERT INTO outbox_events(id,topic,entity_id,payload) VALUES($1,$2,$3,$4::jsonb)',
        [randomUUID(), topic, eventEntity, JSON.stringify({ ...payload, order_id: orderId })],
      );
    };
    const pause = (
      await client.query(
        'SELECT * FROM oven_pauses WHERE order_id=$1 AND ended_at IS NULL FOR UPDATE',
        [orderId],
      )
    ).rows[0];
    if (parsed.action === 'pause_oven' || parsed.action === 'resume_oven') {
      if (stage.status !== 'running' || row) throw new AppError('INVALID_STATE', 409);
      if (parsed.action === 'pause_oven') {
        if (pause) throw new AppError('INVALID_STATE', 409);
        const pauseId = randomUUID();
        await client.query(
          'INSERT INTO oven_pauses(id,order_id,reason,actor_id) VALUES($1,$2,$3,$4)',
          [pauseId, orderId, parsed.note, member.id],
        );
        await client.query('UPDATE stage_runs SET version=version+1 WHERE id=$1', [stage.id]);
        await event('oven.paused', { reason: parsed.note }, pauseId);
      } else {
        if (!pause) throw new AppError('INVALID_STATE', 409);
        await client.query(
          "UPDATE stage_runs SET due_at=CASE WHEN policy->>'time_basis'='active' THEN due_at+(clock_timestamp()-$2::timestamptz) ELSE due_at END,version=version+1 WHERE id=$1",
          [stage.id, pause.started_at],
        );
        await client.query(
          'UPDATE oven_pauses SET ended_at=clock_timestamp(),resumed_by=$2 WHERE id=$1',
          [pause.id, member.id],
        );
        await event('oven.resumed', {}, pause.id);
      }
      return { ok: true };
    }
    if (completingOven && pause) throw new AppError('OVEN_PAUSED', 409);
    if (parsed.action === 'start_filter' || parsed.action === 'start_packing') {
      const kind = parsed.action === 'start_filter' ? 'filter' : 'packing';
      if (!row || row.state !== kind + '_queued') throw new AppError('INVALID_STATE', 409);
      await client.query(
        'UPDATE order_processing SET state=$2,started_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE order_id=$1',
        [orderId, kind + '_running'],
      );
      await event(kind + '.started', { order_id: orderId });
      return { ok: true };
    }
    const source = (
      await client.query('SELECT id FROM material_accounts WHERE production_order_id=$1', [orderId])
    ).rows[0];
    if (parsed.action === 'store' || parsed.action === 'sell') {
      if (!row || row.state !== 'finished') throw new AppError('INVALID_STATE', 409);
      const [balance] = await lockBalances(client, [source.id]);
      if (toMilligrams(balance.quantity_g) <= 0n) throw new AppError('INSUFFICIENT_BALANCE', 409);
      const state = parsed.action === 'store' ? 'stored' : 'sold';
      if (state === 'sold') {
        const external = await externalAccount(context.target_product_id, 'sale');
        await postMovement(client, {
          kind: 'sale',
          production_order_id: orderId,
          actor_id: member.id,
          request_key: key,
          lines: [
            { account_id: source.id, quantity_g: '-' + balance.quantity_g },
            { account_id: external, quantity_g: balance.quantity_g },
          ],
        });
      }
      await client.query(
        'INSERT INTO production_dispatches(order_id,destination,quantity_g,actor_id) VALUES($1,$2,$3,$4)',
        [orderId, state, balance.quantity_g, member.id],
      );
      await client.query(
        'UPDATE order_processing SET state=$2,version=version+1,updated_at=clock_timestamp() WHERE order_id=$1',
        [orderId, state],
      );
      await event('production.' + state, { quantity_g: balance.quantity_g });
      return { ok: true };
    }
    async function externalAccount(product: string, kind: string) {
      await client.query(
        'INSERT INTO material_accounts(id,product_id,external_kind) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [randomUUID(), product, kind],
      );
      return (
        await client.query(
          'SELECT id FROM material_accounts WHERE product_id=$1 AND external_kind=$2',
          [product, kind],
        )
      ).rows[0].id as string;
    }
    const kind = completingOven
      ? 'oven'
      : parsed.action === 'complete_filter'
        ? 'filter'
        : 'packing';
    if (completingOven) {
      if (stage.status !== 'running' || row) throw new AppError('INVALID_STATE', 409);
      if (
        (await client.query('SELECT clock_timestamp()>= $1::timestamptz AS due', [stage.due_at]))
          .rows[0].due !== true
      )
        throw new AppError('INSPECTION_NOT_DUE', 409);
    } else if (!row || row.state !== kind + '_running') throw new AppError('INVALID_STATE', 409);
    const sourceId = completingOven
      ? (await client.query('SELECT id FROM material_accounts WHERE stage_run_id=$1', [stage.id]))
          .rows[0].id
      : source.id;
    const [balance] = await lockBalances(client, [sourceId]);
    const output = toMilligrams(parsed.quantity_g!),
      available = toMilligrams(balance.quantity_g);
    if (output > available) throw new AppError('OUTPUT_EXCEEDS_INPUT', 422);
    let destination = sourceId;
    const lines: { account_id: string; quantity_g: string }[] = [];
    if (completingOven) {
      destination = randomUUID();
      await client.query(
        'INSERT INTO material_accounts(id,product_id,production_order_id) VALUES($1,$2,$3)',
        [destination, context.target_product_id, orderId],
      );
      const sink = await externalAccount(context.raw_product_id, 'processing');
      lines.push(
        { account_id: sourceId, quantity_g: '-' + balance.quantity_g },
        { account_id: sink, quantity_g: balance.quantity_g },
      );
      if (output > 0n) {
        const origin = await externalAccount(context.target_product_id, 'processing');
        lines.push(
          { account_id: origin, quantity_g: '-' + parsed.quantity_g },
          { account_id: destination, quantity_g: parsed.quantity_g! },
        );
      }
    } else if (output < available) {
      const loss = fromMilligrams(available - output),
        sink = await externalAccount(context.target_product_id, 'processing');
      lines.push(
        { account_id: sourceId, quantity_g: '-' + loss },
        { account_id: sink, quantity_g: loss },
      );
    }
    const movement = lines.length
      ? await postMovement(client, {
          kind: 'processing',
          production_order_id: orderId,
          actor_id: member.id,
          request_key: key,
          lines,
        })
      : null;
    await client.query(
      'INSERT INTO processing_results(id,order_id,kind,input_g,output_g,started_at,actor_id,note,movement_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        randomUUID(),
        orderId,
        kind,
        balance.quantity_g,
        parsed.quantity_g,
        completingOven ? stage.started_at : row.started_at,
        member.id,
        parsed.note,
        movement,
      ],
    );
    const next =
      output === 0n
        ? 'discarded'
        : kind === 'oven'
          ? 'filter_queued'
          : kind === 'filter'
            ? 'packing_queued'
            : 'finished';
    if (completingOven) {
      await client.query(
        "UPDATE stage_runs SET status='completed',completed_at=clock_timestamp(),completed_by=$2,version=version+1 WHERE id=$1",
        [stage.id, member.id],
      );
      await client.query('INSERT INTO order_processing(order_id,state) VALUES($1,$2)', [
        orderId,
        next,
      ]);
    } else
      await client.query(
        'UPDATE order_processing SET state=$2,version=version+1,started_at=NULL,updated_at=clock_timestamp() WHERE order_id=$1',
        [orderId, next],
      );
    await event(kind + '.completed', {
      order_id: orderId,
      input_g: balance.quantity_g,
      quantity_g: parsed.quantity_g,
      state: next,
    });
    return { ok: true, state: next };
  });
}
