# دليل النشر المستقل — نظام مصنع دُهن (`duhn.almidyaf.com`)

هذا المشروع مستقل تمامًا عن موقع البروفايل الرئيسي للشركة (`https://www.almidyaf.com`) من حيث المستودع، وعملية البناء، والنشر، مع مشاركة قاعدة بيانات Supabase واحدة عبر عزل جداول المصنع داخل مخطط PostgreSQL خاص (`duhn` schema) حتى لا تتعارض مع جداول الموقع الرئيسي في مخطط `public`.

## 1. متغيرات البيئة المطلوبة في الإنتاج

| المتغير | القيمة / الوصف |
| --- | --- |
| `DATABASE_URL` | رابط Supabase Transaction Pooler (المنفذ `6543` مع `?pgbouncer=true`) لتشغيل التطبيق |
| `MIGRATION_DATABASE_URL` | رابط Supabase Session Pooler (المنفذ `5432`) لتنفيذ الترحيلات (`pg_advisory_lock`) |
| `DIRECT_URL` | نفس رابط المنفذ `5432` (احتياطي متوافق مع أداة الترحيل) |
| `NEXT_PUBLIC_SUPABASE_URL` | رابط مشروع Supabase (`https://<project-ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | المفتاح العام لمشروع Supabase |
| `BETTER_AUTH_URL` | `https://duhn.almidyaf.com` في الإنتاج (`http://localhost:3108` محليًا) |
| `BETTER_AUTH_SECRET` | مفتاح سري عشوائي لا يقل عن 32 حرفًا |
| `DB_SCHEMA` | اختياري؛ القيمة الافتراضية للاتصال البعيد هي `duhn` (وللمحلي `public`) |

> ملاحظة: يستخدم `src/server/db.ts` و`scripts/migrate.ts` و`scripts/create-owner.ts` اتصال SSL (`{ rejectUnauthorized: false }`) تلقائيًا للروابط البعيدة مع ضبط `search_path=duhn,public`، بينما تبقى البيئة المحلية (`127.0.0.1` / `localhost`) بدون SSL وعلى مخطط `public`.

## 2. تهيئة قاعدة البيانات (مرة واحدة عند الإطلاق)

```bash
npm ci
npm run db:migrate
npm run owner:create
```

## 3. خيارات النشر على `duhn.almidyaf.com`

### الخيار أ: استضافة Node.js (الموصى به لـ Next.js 16 + `pg` + `better-auth`)

يعمل التطبيق مباشرة عبر Node.js (`>=22.12 <27`) على أي منصة تدعم Node (مثل Railway أو Render أو Fly.io أو VPS خلف Cloudflare DNS Proxy):

```bash
npm ci
npm run build
npm run start
```

اضبط سجل DNS في Cloudflare للنطاق الفرعي `duhn` (أو CNAME لهدف الاستضافة) مع تفعيل SSL (Full/Strict).

### الخيار ب: Cloudflare Workers عبر `@opennextjs/cloudflare`

عند الرغبة في النشر على Cloudflare Workers بدل خادم Node.js:
1. ثبّت `@opennextjs/cloudflare` و`wrangler` المتوافقين مع إصدار `next` في `package.json`.
2. فعّل `compatibility_flags = ["nodejs_compat"]` في `wrangler.jsonc` لدعم حزمة `pg` و`node:crypto`.
3. أضف أسرار البيئة (`DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, إلخ) عبر `wrangler secret put` أو لوحة Cloudflare.
4. اربط Custom Domain للنطاق `duhn.almidyaf.com`.

## 4. الربط مع الموقع الرئيسي (`www.almidyaf.com`)

- **رابط الدخول المباشر في زر "مصنع دهن العود" بالموقع الرئيسي:** `https://duhn.almidyaf.com/login`
- **رابط العودة إلى الموقع الرسمي داخل نظام دُهن:** مدمج في تذييل شاشة تسجيل الدخول (`/login`) وفي الشريط الجانبي داخل التطبيق، ويشير إلى `https://www.almidyaf.com`.
