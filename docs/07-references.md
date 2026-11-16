# المهارات والمراجع المستخدمة

تاريخ الاطلاع: 2026-11-04. هذه المراجع دعمت قرارات التصميم؛ لا تثبت أن التطبيق نُفذ أو أن جودة التشغيل الصناعي اعتُمدت. تعليمات المستخدم ونطاق المصنع يتقدمان على أمثلة المهارات العامة.

## المهارات المحلية المقروءة

| المهارة | موقع SKILL.md في بيئة الإعداد | الاستفادة |
|---|---|---|
| erp-domain-knowledge | /home/omar/.agents/skills/erp-domain-knowledge/SKILL.md | ربط الاستلام والإنتاج والمخزون وتتبع الدفعات دون إضافة وحدات غير مطلوبة |
| documentation | /home/omar/.agents/skills/documentation/SKILL.md | فصل المواصفات عن التشغيل، تعليمات التنفيذ، وروابط بدل نسخ القواعد بين الملفات |
| agency-ui-designer | /home/omar/.agents/skills/agency-ui-designer/SKILL.md | tokens ومكونات وحالات UI ووصول وتصميم متعدد المقاسات |
| postgresql-database-engineering | /home/omar/.agents/skills/postgresql-database-engineering/SKILL.md | المعاملات والقيود والفهارس والجلب والاتصالات والنسخ والاستعادة |
| vercel-react-best-practices | /home/omar/.agents/skills/vercel-react-best-practices/SKILL.md | تقليل تسلسل الجلب والبيانات المنقولة وإعادة العرض وتحميل الأجزاء الثقيلة عند الحاجة |
| i18n-expert | /home/omar/.agents/skills/i18n-expert/SKILL.md | الرسائل العربية وRTL وتوحيد تنسيق الأرقام والأوقات وأخطاء الواجهة |

المهارات إرشادات عامة؛ لم تُنسخ منها إعدادات ذاكرة أو أوامر SQL تشغيلية جاهزة على الإنتاج. القيم الصناعية والمالية لم تُستنتج منها. تطبيق التدويل هنا للعربية فقط، دون إضافة لغات افتراضية من أمثلة المهارة.

المسارات أعلاه توثيق لما قُرئ أثناء إعداد الخطة. لا يلزم وجود هذه المهارات لدى Gemini لأن التعليمات المطلوبة مترجمة إلى مواصفات المشروع، ويمكن الرجوع للمصادر الرسمية التالية عند التنفيذ.

## مراجع رسمية

- أقفال الصفوف والتعارضات: [PostgreSQL — Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html). استُخدم لتوجيه قفل الأرصدة والتعامل مع التزامن.
- أساليب النسخ: [PostgreSQL — Backup and Restore](https://www.postgresql.org/docs/current/backup.html). اختيار آلية الاستعادة يعتمد على RPO/RTO والمزود والإصدار.
- حدود الوصول للبيانات: [Next.js — Data Security](https://nextjs.org/docs/app/guides/data-security). يدعم وضع التحقق وإرجاع البيانات المحدودة في DAL خادمية.
- جلب البيانات: [Next.js — Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data). مرجع لتنفيذ القراءة الخادمية وتقليل انتظار الطلبات المستقلة.
- المعاملات على اتصال واحد: [node-postgres — Transactions](https://node-postgres.com/features/transactions). يُراجع عند تنفيذ خدمة المعاملات.
- إعادة الجلب عند التركيز والاتصال: [SWR — Automatic Revalidation](https://swr.vercel.app/docs/revalidation). تُضبط السياسات وفق حاجات المصنع.
- المصادقة والجلسات: [Better Auth — Introduction](https://better-auth.com/docs/introduction). اختيار مقترح؛ يجب مراجعة التكامل والنسخ المدعومة وإعداد الأمان عند التأسيس.
- معايير الوصول: [W3C — WCAG Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/). أساس أهداف التصميم والتحقق، وليس شهادة امتثال.
- تنظيم طلبات Gemini: [Google — Prompt Design Strategies](https://aistudio.google.com/docs/prompting-strategies). يدعم التعليمات المحددة والأمثلة والمخرجات الواضحة؛ تقسيم المشروع إلى المهام هنا قرار خاص بهذه الخطة.

لم تُثبت الخطة رقم إصدار Flash أو سعة سياقه أو سعره، ولم تفترض أن التوجيه وحده يضمن تنفيذًا صحيحًا. تُثبت نسخ الأدوات البرمجية وقت T03 بعد التحقق من توافقها، ويظل lockfile مرجع التنفيذ.
