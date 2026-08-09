// ============================================================================
// /api/read-kroki — قراءة جدول إحداثيات الكروكي بالذكاء الاصطناعي
//
// لماذا وسيط على الخادم بدل نداء مباشر من المتصفح؟
//
// كان المتصفح ينادي api.anthropic.com بنفسه، فيضطر المستخدم إلى لصق مفتاحه
// في كل جلسة. والمفتاح في كود المتصفح مكشوف لمن يفتح أدوات المطوّر.
//
// هنا يبقى المفتاح في متغيرات بيئة Vercel، لا يغادر الخادم أبداً، ويُضبط
// **مرة واحدة** لا مرة كل جلسة. المتصفح يرسل الصورة فقط.
//
// الإعداد المطلوب (مرة واحدة):
//   Vercel → Settings → Environment Variables
//   الاسم:  ANTHROPIC_API_KEY
//   القيمة: sk-ant-...
//   ثم أعد النشر (Redeploy) لتُقرأ القيمة.
// ============================================================================

const ALLOWED_ORIGINS = [
  "https://qibla-replit.vercel.app",
  "http://localhost:3000",
];

const MODEL = "claude-sonnet-4-6";

// الموجّهات محفوظة هنا لا تُرسل من المتصفح: لو قبِلنا موجّهاً من العميل
// لأصبح مفتاحك بوابة مفتوحة لأي طلب يخطر ببال من يعرف الرابط.
const PROMPTS = {
  // يستخدمه kroki.js — إحداثيات واسم فقط
  basic:
    "اقرأ جدول إحداثيات قطعة الأرض من هذه الصورة (كروكي مساحي عُماني). " +
    "أعد الإجابة بصيغة JSON فقط بدون أي نص إضافي أو علامات markdown، بالشكل التالي بالضبط:\n" +
    '{"points": [[easting, northing], ...], "zone": <رقم نطاق UTM إن وجد أو null>, ' +
    '"datum": "psd93" أو "wgs84utm" أو null, "name": "<اسم المسجد أو القطعة إن وُجد بالوثيقة أو null>"}\n' +
    "ملاحظات مهمة:\n" +
    "- بعض الجداول تكتب عمود Northing قبل عمود Easting — تأكد من إخراج كل نقطة " +
    "بترتيب [Easting, Northing] دائماً بغض النظر عن ترتيب الأعمدة كما تظهر في الصورة.\n" +
    "- انسخ الأرقام كما هي بالضبط دون أي تقريب أو تعديل.\n" +
    "- إذا لم تجد قيمة لأي حقل ضعه null.",

  // يستخدمه app.js — يضيف المساحة ونص نظام الإسناد الحرفي
  full:
    "اقرأ جدول إحداثيات قطعة الأرض من هذه الصورة (كروكي مساحي عُماني). " +
    "أعد الإجابة بصيغة JSON فقط بدون أي نص إضافي أو علامات markdown، بالشكل التالي بالضبط:\n" +
    '{"points": [[easting, northing], ...], "area": <رقم المساحة الإجمالية بالمتر المربع كما هي مكتوبة بالوثيقة أو null>, ' +
    '"zone": <رقم نطاق UTM إن وجد أو null>, "datum": "psd93" أو "wgs84utm" أو null, ' +
    '"rawText": "<انسخ هنا حرفياً السطر الذي يذكر نظام الإسناد كما هو مكتوب في الوثيقة، مثل Clark1880 40N، أو اتركه فارغاً>"}\n' +
    "ملاحظات مهمة:\n" +
    "- بعض الجداول تكتب عمود Northing قبل عمود Easting — تأكد من إخراج كل نقطة " +
    "بترتيب [Easting, Northing] دائماً بغض النظر عن ترتيب الأعمدة كما تظهر في الصورة.\n" +
    "- انسخ الأرقام كما هي بالضبط دون أي تقريب أو تعديل.\n" +
    "- إذا لم تجد قيمة لأي حقل ضعه null.",
};

// الصور الكبيرة تتجاوز حد جسم الطلب في Vercel، فنرفع السقف صراحةً
module.exports.config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
};

module.exports = async function handler(req, res) {
  const origin = String((req.headers && req.headers.origin) || "");

  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ ok: false, error: "أصل غير مصرّح به." });
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Sky-Key");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "الطريقة غير مدعومة." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // رسالة صريحة تقول ماذا يُفعل بالضبط — أنفع من "خطأ في الخادم"
    return res.status(503).json({
      ok: false,
      error:
        "لم يُضبط ANTHROPIC_API_KEY في متغيرات بيئة Vercel. " +
        "أضفه من Settings → Environment Variables ثم أعد النشر.",
    });
  }

  const optionalGate = process.env.SKY_API_KEY;
  if (optionalGate && String(req.headers["x-sky-key"] || "") !== optionalGate) {
    return res.status(401).json({ ok: false, error: "غير مصرّح." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const imageBase64 = body.imageBase64;
    const mediaType = body.mediaType || "image/jpeg";
    const prompt = PROMPTS[body.variant] || PROMPTS.basic;

    if (!imageBase64) {
      return res.status(400).json({ ok: false, error: "لم تصل الصورة." });
    }
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/.test(mediaType)) {
      return res.status(400).json({ ok: false, error: "نوع الصورة غير مدعوم." });
    }

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: imageBase64 },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      // نُمرّر سبب الرفض كما ورد: "الرصيد نفد" مختلف عن "المفتاح خاطئ"
      const detail = (data && data.error && data.error.message) || "حالة " + upstream.status;
      return res.status(502).json({ ok: false, error: "خدمة القراءة ردّت: " + detail });
    }

    const text = (data.content || [])
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return res.status(502).json({
        ok: false,
        error: "تعذّر فهم ردّ خدمة القراءة. جرّب صورة أوضح.",
      });
    }

    return res.status(200).json({ ok: true, result: parsed });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: (err && err.message) || "خطأ غير متوقع في الخادم.",
    });
  }
};
