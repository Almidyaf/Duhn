import { writeFileSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { processingSchema } from '../src/contracts/processing';
import { ovenStartSchema } from '../src/contracts/oven';
import {
  catalogInputSchemas,
  catalogUpdateSchemas,
  catalogEntitySchema,
} from '../src/contracts/catalog';
import { receiptInputSchema, voidReceiptSchema } from '../src/contracts/receipts';
import { assetDeleteSchema, assetInputSchema, assetUpdateSchema } from '../src/contracts/assets';

import { factorySettingsInputSchema } from '../src/contracts/settings';
import { productionStartSchema } from '../src/contracts/production';
const schemas: Record<string, unknown> = {};
for (const [name, schema] of Object.entries({
  FactorySettingsInput: factorySettingsInputSchema,
  ProductionStartInput: productionStartSchema,
  OvenStartInput: ovenStartSchema,
  ProcessingInput: processingSchema,
}))
  schemas[name] = z.toJSONSchema(schema, { io: 'input' });
for (const entity of catalogEntitySchema.options) {
  schemas[`${entity}Input`] = z.toJSONSchema(catalogInputSchemas[entity], { io: 'input' });
  schemas[`${entity}Update`] = z.toJSONSchema(catalogUpdateSchemas[entity], { io: 'input' });
}
schemas.ReceiptInput = {
  ...z.toJSONSchema(receiptInputSchema, { io: 'input' }),
  description:
    '1–25 distinct raw products. Purchase requires active supplier; opening requires owner, null supplier, empty reference, reason >=3 chars. Positive canonical gram strings; rejects precision above 3. Time assigned by server in UTC.',
};
schemas.VoidReceiptInput = z.toJSONSchema(voidReceiptSchema, { io: 'input' });
schemas.AssetInput = z.toJSONSchema(assetInputSchema, { io: 'input' });
schemas.AssetUpdate = z.toJSONSchema(assetUpdateSchema, { io: 'input' });
schemas.AssetDelete = z.toJSONSchema(assetDeleteSchema, { io: 'input' });
const timestamp = { type: 'string', format: 'date-time' };
const uuid = { type: 'string', format: 'uuid' };
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
schemas.Error = {
  type: 'object',
  required: ['code', 'request_id'],
  properties: { code: { type: 'string' }, request_id: uuid },
  additionalProperties: false,
};
schemas.Cursor = {
  type: 'object',
  required: ['at', 'id'],
  properties: { at: timestamp, id: uuid },
  additionalProperties: false,
};
const base = {
  id: uuid,
  name: { type: 'string' },
  active: { type: 'boolean' },
  version: { type: 'integer', minimum: 1 },
  created_at: timestamp,
};
const item = (properties: Record<string, unknown>) => ({
  type: 'object',
  required: Object.keys(properties),
  properties,
  additionalProperties: false,
});
schemas.productsItem = item({
  ...base,
  code: { type: 'string' },
  kind: { enum: ['raw', 'finished'], type: 'string' },
});
(schemas.productsItem as { properties: Record<string, unknown> }).properties.raw_product_id = {
  type: ['string', 'null'],
  format: 'uuid',
};
(schemas.productsItem as { properties: Record<string, unknown> }).properties.raw_product_name = {
  type: ['string', 'null'],
};
schemas.suppliersItem = item({ ...base, contact: { type: 'string' } });
schemas.Asset = item({
  ...base,
  code: { type: 'string' },
  category: {
    type: 'string',
    enum: ['oven', 'scale', 'equipment', 'other'],
  },
  location: { type: 'string' },
  notes: { type: 'string' },
  updated_at: timestamp,
});
const textField = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
const weight = { type: 'string', pattern: '^[0-9]+\\.[0-9]{3}$' };
schemas.Receipt = item({
  id: uuid,
  code: textField,
  kind: { type: 'string', enum: ['purchase', 'opening'] },
  supplier_id: { anyOf: [uuid, { type: 'null' }] },
  supplier_name: nullableText,
  reference: textField,
  note: textField,
  status: { type: 'string', enum: ['posted', 'voided'] },
  version: { type: 'integer', minimum: 1 },
  created_at: timestamp,
  void_reason: nullableText,
  voided_at: { anyOf: [timestamp, { type: 'null' }] },
  line_count: { type: 'integer', minimum: 1, maximum: 25 },
  total_g: weight,
});
schemas.ReceiptLine = item({
  id: uuid,
  product_id: uuid,
  product_name: textField,
  type_name: textField,
  quantity_g: weight,
  lot_id: uuid,
  lot_code: textField,
  account_id: uuid,
  balance_g: weight,
  balance_version: { type: 'integer', minimum: 1 },
});
schemas.ReceiptDetail = item({
  receipt: ref('Receipt'),
  lines: { type: 'array', minItems: 1, maxItems: 25, items: ref('ReceiptLine') },
});
schemas.RawLot = item({
  id: uuid,
  code: textField,
  product_id: uuid,
  product_name: textField,
  type_name: textField,
  receipt_id: uuid,
  receipt_code: textField,
  supplier_name: nullableText,
  quantity_g: weight,
  version: { type: 'integer', minimum: 1 },
  created_at: timestamp,
});
const page = (schema: string) =>
  item({
    items: { type: 'array', maxItems: 25, items: ref(schema) },
    next_cursor: { anyOf: [ref('Cursor'), { type: 'null' }] },
  });
schemas.FactorySettings = item({
  id: uuid,
  name: textField,
  timezone: nullableText,
  week_starts_on: { type: ['integer', 'null'], minimum: 0, maximum: 6 },
  weight_precision: { const: 3, type: 'integer' },
  configured: { type: 'boolean' },
  version: { type: 'integer', minimum: 1 },
  updated_at: timestamp,
});
schemas.ProductionOrder = item({
  id: uuid,
  code: textField,
  target_product_id: uuid,
  product_name: textField,
  raw_product_id: uuid,
  raw_product_name: textField,
  raw_lot_id: uuid,
  quantity_g: weight,
  created_at: timestamp,
  stage_id: uuid,
  stage_status: { type: 'string', enum: ['queued', 'running', 'paused', 'completed'] },
  stage_version: { type: 'integer', minimum: 1 },
  started_at: { anyOf: [timestamp, { type: 'null' }] },
  due_at: { anyOf: [timestamp, { type: 'null' }] },
  duration_minutes: { type: 'integer' },
  warning_minutes: { type: 'integer' },
  grace_minutes: { type: 'integer' },
  asset_name: nullableText,
  paused_at: { anyOf: [timestamp, { type: 'null' }] },
  time_basis: { type: 'string', enum: ['active', 'elapsed'] },
  processing_state: nullableText,
  processing_version: { type: ['integer', 'null'] },
  available_g: nullableText,
  oven_output_g: nullableText,
  filter_output_g: nullableText,
  packing_output_g: nullableText,
});
schemas.OvenChoice = item({
  id: uuid,
  name: textField,
  version: { type: 'integer', minimum: 1 },
  created_at: timestamp,
});
schemas.OvenChoices = page('OvenChoice');
schemas.OvenStartResult = item({
  order_id: uuid,
  stage_id: uuid,
  version: { type: 'integer', minimum: 1 },
  status: { type: 'string', const: 'running' },
  started_at: timestamp,
  due_at: timestamp,
});
schemas.SourceChoice = item({
  id: uuid,
  code: textField,
  quantity_g: weight,
  version: { type: 'integer', minimum: 1 },
  created_at: timestamp,
});
schemas.ProductionDetail = item({
  order: ref('ProductionOrder'),
  server_time: timestamp,
});
schemas.ProductionPage = item({ ...page('ProductionOrder').properties, server_time: timestamp });
schemas.ProductionOptions = item({
  product: ref('productsItem'),
  raw_product: ref('productsItem'),
  settings_version: { type: 'integer', minimum: 1 },
  timezone: textField,
  sources: page('SourceChoice'),
});
const response = (schema: unknown, description = 'Success') => ({
  description,
  content: { 'application/json': { schema } },
});
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 422, 503].map((code) => [
    code,
    response(
      ref('Error'),
      'Request rejected or result not confirmed; inspect code. 503 may follow an uncertain commit: retain the original key and body.',
    ),
  ]),
);
const query = (name: string, schema: unknown, required = false) => ({
  in: 'query',
  name,
  required,
  schema,
});
const id = { in: 'path', name: 'id', required: true, schema: uuid };
const key = { in: 'header', name: 'Idempotency-Key', required: true, schema: uuid };
const origin = {
  in: 'header',
  name: 'Origin',
  required: true,
  schema: { type: 'string' },
  description: 'Must equal the configured application origin.',
};
const pagination = [query('before_at', timestamp), query('before_id', uuid)];
const filters = [
  query('q', { type: 'string', maxLength: 120 }),
  query('status', { type: 'string', enum: ['all', 'active', 'inactive'] }),
  ...pagination,
];
const paths: Record<string, unknown> = {};
function write(input: string, output: unknown, update = false) {
  return {
    parameters: [...(update ? [id] : []), key, origin],
    requestBody: { required: true, content: { 'application/json': { schema: ref(input) } } },
    responses: { [update ? '200' : '201']: response(output), ...errors },
  };
}
for (const entity of catalogEntitySchema.options) {
  const path = `/catalog/${entity}`;
  paths[path] = {
    get: {
      description:
        'Owner/manager only. Cursor fields must be sent together. Active products exclude inactive parent types.',
      parameters: [
        ...filters,
        ...(entity === 'products'
          ? [
              query(
                'type_id',
                {
                  ...uuid,
                  description:
                    'Required unless kind=raw or kind=finished explicitly selects a separate catalog across classifications.',
                },
                false,
              ),
              query('kind', { type: 'string', enum: ['raw', 'finished'] }),
            ]
          : []),
      ],
      responses: { '200': response(page(`${entity}Item`)), ...errors },
    },
    post: write(`${entity}Input`, item({ item: ref(`${entity}Item`) })),
  };
  paths[`${path}/{id}`] = {
    get: {
      parameters: [id],
      responses: { '200': response(item({ item: ref(`${entity}Item`) })), ...errors },
    },
    patch: write(`${entity}Update`, item({ item: ref(`${entity}Item`) }), true),
  };
}
paths['/assets'] = {
  get: { parameters: filters, responses: { '200': response(page('Asset')), ...errors } },
  post: write('AssetInput', item({ asset: ref('Asset') })),
};
paths['/assets/{id}'] = {
  patch: write('AssetUpdate', item({ asset: ref('Asset') }), true),
  delete: {
    ...write('AssetDelete', item({ deleted: { const: true }, id: uuid }), true),
    description: 'Safely deletes an unreferenced asset. Returns 409 ITEM_IN_USE if referenced.',
  },
};
paths['/receipts'] = {
  get: {
    parameters: [
      query('q', { type: 'string', maxLength: 120 }),
      query('status', { type: 'string', enum: ['all', 'posted', 'voided'] }),
      ...pagination,
    ],
    responses: { '200': response(page('Receipt')), ...errors },
  },
  post: {
    ...write('ReceiptInput', ref('ReceiptDetail')),
    description:
      'Owner/manager for purchase; owner only for opening. Commits source lot, ledger, balance, audit, outbox and idempotent result atomically. Duplicate non-empty supplier reference is rejected, including references on reversed receipts.',
  },
};
paths['/receipts/{id}'] = {
  get: { parameters: [id], responses: { '200': response(ref('ReceiptDetail')), ...errors } },
};
paths['/receipts/{id}/void'] = {
  post: {
    ...write('VoidReceiptInput', ref('ReceiptDetail')),
    parameters: [id, key, origin],
    responses: { '200': response(ref('ReceiptDetail')), ...errors },
    description:
      'Exact reversal only when none of the source balances have ever been used. Opening reversal is owner-only. Original document and movement remain immutable; expected_version comes from receipt.',
  },
};
paths['/materials/lots'] = {
  get: {
    parameters: [query('q', { type: 'string', maxLength: 120 }), ...pagination],
    responses: { '200': response(page('RawLot')), ...errors },
    description:
      'Owner/manager only. Positive raw stock by source lot, including historical names; not finished goods stock. No arbitrary movement HTTP endpoint exists.',
  },
};
paths['/settings'] = {
  get: {
    description:
      'Owner/manager read. Settings start unconfigured; no factory timezone is inferred.',
    responses: { '200': response(ref('FactorySettings')), ...errors },
  },
  patch: {
    ...write('FactorySettingsInput', ref('FactorySettings')),
    responses: { '200': response(ref('FactorySettings')), ...errors },
    description:
      'Owner only. Versioned settings, explicit precision acknowledgement and valid IANA/PostgreSQL timezone required.',
  },
};
paths['/production-orders'] = {
  get: {
    parameters: [query('q', { type: 'string', maxLength: 120 }), ...pagination],
    responses: { '200': response(ref('ProductionPage')), ...errors },
  },
  post: {
    ...write('ProductionStartInput', ref('ProductionDetail')),
    description:
      'Owner/manager only in this release. Configured factory, active finished product linked to an active raw product, and one compatible source lot required. Atomically moves raw material to a queued oven production order. source_version is the raw material balance version.',
  },
};
paths['/production-orders/options'] = {
  get: {
    parameters: [query('product_id', uuid, true), ...pagination],
    responses: { '200': response(ref('ProductionOptions')), ...errors },
    description:
      'Linked raw product and paged positive source lots compatible with the selected finished oil product.',
  },
};
paths['/production-orders/{id}'] = {
  get: {
    parameters: [id],
    responses: { '200': response(ref('ProductionDetail')), ...errors },
    description: 'Single production order detail with server_time.',
  },
};
paths['/requests/{key}'] = {
  get: {
    description:
      'Only the current actor and active management role. unknown is not proof that a request never arrived. Completed result is the service result, without the HTTP item/asset wrapper.',
    parameters: [{ in: 'path', name: 'key', required: true, schema: uuid }],
    responses: {
      '200': response({
        oneOf: [
          item({ status: { const: 'unknown', type: 'string' } }),
          item({
            status: { const: 'completed', type: 'string' },
            result: {
              oneOf: [
                ref('Asset'),
                ref('ReceiptDetail'),
                ref('FactorySettings'),
                ref('ProductionDetail'),
                ref('OvenStartResult'),
                ref('typesItem'),
                ref('productsItem'),
                ref('suppliersItem'),
                item({ recipe: ref('Recipe'), product_version: { type: 'integer' } }),
              ],
            },
          }),
        ],
      }),
      ...errors,
    },
  },
};
paths['/ovens'] = {
  get: {
    parameters: [query('q', { type: 'string', maxLength: 120 }), ...pagination],
    responses: { '200': response(ref('OvenChoices')), ...errors },
    description:
      'Active, unoccupied ovens. Paginated choices; availability is checked again under lock when starting.',
  },
};
paths['/production-orders/{id}/start'] = {
  post: {
    ...write('OvenStartInput', ref('OvenStartResult')),
    parameters: [id, key, origin],
    responses: { '200': response(ref('OvenStartResult')), ...errors },
    description:
      'Starts a queued oven stage once. Uses stage expected_version and asset_version. Reserves one oven, records server timestamps, duration, actor and durable event; no material movement. Elapsed timer alone never completes or releases equipment.',
  },
};
schemas.Notification = item({
  id: textField,
  title: textField,
  body: textField,
  href: textField,
  severity: { type: 'string', enum: ['info', 'warning', 'danger'] },
  occurred_at: timestamp,
  is_read: { type: 'boolean' },
});
schemas.NotificationFeed = item({
  items: { type: 'array', items: ref('Notification'), maxItems: 30 },
  unread_count: { type: 'integer' },
  next_cursor: { anyOf: [item({ at: timestamp, id: textField }), { type: 'null' }] },
});
paths['/notifications'] = {
  get: {
    parameters: [query('before_at', timestamp), query('before_id', textField)],
    responses: { '200': response(ref('NotificationFeed')), ...errors },
    description:
      'Owner/manager notification history and per-user unread count. Refreshes idempotent event projection; timer expiry does not complete production stages.',
  },
};
paths['/notifications/read'] = {
  post: {
    parameters: [origin],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            oneOf: [
              {
                type: 'object',
                required: ['all'],
                properties: { all: { const: true } },
                additionalProperties: false,
              },
              {
                type: 'object',
                required: ['ids'],
                properties: {
                  ids: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 100,
                    items: { type: 'string', maxLength: 100 },
                  },
                },
                additionalProperties: false,
              },
            ],
          },
        },
      },
    },
    responses: { '200': response(item({ ok: { const: true } })), ...errors },
    description: 'Idempotent per-user read markers. History is retained.',
  },
};
paths['/production-orders/{id}/process'] = {
  post: {
    ...write('ProcessingInput', item({ ok: { const: true } })),
    parameters: [id, key, origin],
    responses: {
      '200': response({
        type: 'object',
        properties: { ok: { const: true }, state: { type: 'string' } },
      }),
      ...errors,
    },
    description:
      'Versioned oven inspection/output after due, filtering, packing, final store or quantity-only spot sale, and oven pause/resume with reason/inspection. Preserves grams and history. Output cannot exceed input; zero requires reason.',
  },
};
const doc = {
  openapi: '3.1.0',
  info: {
    title: 'Duhn implemented management API',
    version: '0.4.0',
    description:
      'Implemented application routes only. Same-origin session cookie issued by Better Auth at /api/auth; public signup disabled. Receiving, reversal, factory configuration, direct raw-to-oil linking, direct production start, and oven start are implemented. Oven completion, filtering, packing, final stock, quantity-only sale and oven pause/resume are implemented. In-app notifications are available; external delivery is not implemented. Reports are server-rendered. Production commands currently require owner/manager; operator delegation is pending.',
  },
  servers: [{ url: '/api/v1' }],
  security: [{ session: [] }],
  paths,
  components: {
    securitySchemes: {
      session: {
        type: 'apiKey',
        in: 'cookie',
        name: 'better-auth.session_token',
        description:
          'Session cookie; HTTPS deployments use the secure cookie prefix configured by Better Auth.',
      },
    },
    schemas,
  },
};
const output = `${JSON.stringify(doc, null, 2)}\n`;
const path = 'docs/openapi.json';
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== output)
    throw new Error('OpenAPI is stale. Run npm run api:generate.');
} else writeFileSync(path, output);
console.log('OpenAPI contracts verified.');
