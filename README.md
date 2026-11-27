> Full source of the LIMS package. A ready zip is under [Releases](https://github.com/genex-kw-store/lims-kuwait-lab/releases).
>
> الكود الكامل لنظام المعمل. النسخة المضغوطة الجاهزة في صفحة الإصدارات (Releases).

---

# نظام إدارة مختبرات التحاليل الطبية (LIMS)

نظام ويب متكامل لإدارة المختبر: استقبال، سحب عينات، نتائج، اعتماد، تقارير، فواتير، مخازن، محاسبة، صلاحيات، سجل مراقبة — عربي/إنجليزي بالكامل، عملة الدينار الكويتي (٣ خانات عشرية).

## التشغيل (٣ خطوات)

1. ثبّت **Node.js 18+** من https://nodejs.org
2. في مجلد المشروع شغّل مرة واحدة: `npm install`
3. للتشغيل: `npm start`

ثم افتح: **http://localhost:3000** — ومن أي جهاز آخر على نفس الشبكة: `http://<عنوان-IP-للجهاز>:3000`

### الدخول الافتراضي (غيّر كلمات المرور فوراً من شاشة المستخدمون)
| المستخدم | كلمة المرور | الدور |
|---|---|---|
| admin | Admin@123 | مدير عام |
| manager | Manager@123 | مدير معمل (اعتماد النتائج) |
| recep | Recep@123 | استقبال |
| phlebo | Phlebo@123 | فني سحب |
| tech | Tech@123 | أخصائي مختبر |
| acc | Acc@123 | محاسب |

### أوامر إضافية
- `npm run reset` — مسح كل البيانات والبدء من جديد بالبيانات التأسيسية فقط.
- النسخ الاحتياطي: تلقائي يومياً (٢ صباحاً) في مجلد `backups/` + يدوي من شاشة الإعدادات (تحميل/استعادة كاملة أو جزئية).
- بوابة المريض: `http://<العنوان>:3000/portal` برقم الملف وكود الدخول المطبوع على الفاتورة.
- قبل الاستخدام الحقيقي: حدّث اسم المعمل وبياناته و**رابط النظام (Base URL)** من الإعدادات حتى يعمل رمز QR على التقارير.

## English Quick Start

1. Install Node.js 18+.
2. `npm install` (once), then `npm start`.
3. Open http://localhost:3000 — other devices on the same network use this PC's IP.
4. Default logins above (change them immediately). Patient portal at `/portal`.
5. `npm run reset` wipes data and restores seed master data.

### Stack
Node.js + Express + SQLite (better-sqlite3, WAL) — no external DB server needed. Frontend: dependency-free responsive SPA (AR/EN, RTL/LTR), Chart.js + JsBarcode bundled locally (works offline).
