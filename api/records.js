// ============================================================================
// /api/records — واجهة البيانات المركزية
//
// التخزين: قاعدة بيانات Redis (Upstash / Vercel KV) عبر واجهتها REST.
//
// لماذا هذا الاختيار؟
//   • بلا أي حزم خارجية (نستخدم fetch المدمج) — فلا package.json ولا npm،
//     ولا يفشل البناء لأسباب اعتمادية.
//   • لا نشر يدوي بعد كل تعديل — على عكس Google Apps Script الذي كان يتطلب
//     "New version" في كل مرة، وهو ما عطّل المزامنة مراراً.
//   • بلا مشاكل CORS أو صفحات تسجيل دخول تعترض الطلبات.
//   • كل سجل يُخزَّن كحقل مستقل في Hash، فالكتابة المتزامنة لا تُتلف بعضها.
//
// المفاتيح المستخدمة في القاعدة:
//   sky:completed  → المساجد المنتهية
//   sky:qibla      → مساجد أداة القبلة
//   sky:requests   → طلبات تحديد القبلة (الدفع والزيارة والجاهزية)
//
// الإعداد مرة واحدة في Vercel:
//   Storage → Create → Upstash Redis (أو KV) → Connect to project
//   يضبط Vercel متغيّري البيئة تلقائياً، ثم أعد النشر.
//
// العمليات:
//   GET    /api/records?type=completed|qibla|requests
//   POST   /api/records   { type, records:[...] }
//   DELETE /api/records   { type, recordId }
// ============================================================================

const ALLOWED_TYPES = ["completed", "qibla", "requests"];

// أسماء متغيّرات البيئة تختلف بين تكامل KV وتكامل Upstash المباشر
function creds() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      "قاعدة البيانات غير مربوطة. في Vercel: Storage ← Create ← Upstash Redis ← Connect to project، ثم أعد النشر.",
    );
  }
  return { url: url.replace(/\/+$/, ""), token };
}

// تنفيذ أمر Redis عبر واجهة REST
async function redis(command) {
  const { url, token } = creds();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error("رد غير مفهوم من قاعدة البيانات: " + raw.slice(0, 120));
  }

  if (!res.ok || data.error) {
    throw new Error(data.error || "قاعدة البيانات ردّت بحالة " + res.status);
  }
  return data.result;
}

function keyFor(type) {
  return "sky:" + type;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      throw new Error("جسم الطلب ليس JSON صالحاً.");
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error("جسم الطلب ليس JSON صالحاً.");
  }
}

// HGETALL يُعيد مصفوفة مسطّحة [حقل، قيمة، حقل، قيمة...]
function parseHash(flat) {
  const out = [];
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    try {
      out.push(JSON.parse(flat[i + 1]));
    } catch (e) {
      // سجل تالف لا يُسقط البقية
    }
  }
  return out;
}

// ---------------------------------------------------------------- الحماية
//
// طبقتان، وكلتاهما ليستا بديلاً عن قفل الموقع نفسه:
//
//   1) قائمة الأصول المسموحة — تمنع موقعاً آخر من قراءة بياناتك عبر متصفح
//      زائرك. لا تمنع curl أو أي أداة خارج المتصفح.
//   2) مفتاح مشترك اختياري (SKY_API_KEY) — يمنع الفضولي العابر. المفتاح يصل
//      المتصفح فيراه من يفتح أدوات المطوّر، فهو تأخير لا حماية.
//
// الحماية الحقيقية الوحيدة: Vercel → Settings → Deployment Protection.
// فعّلها، وستصبح الطبقتان أدناه دفاعاً في العمق لا خط الدفاع الأول.

const ALLOWED_ORIGINS = [
  "https://qibla-replit.vercel.app",
  "http://localhost:3000",
];

function resolveOrigin(req) {
  const origin = String((req.headers && req.headers.origin) || "");
  if (!origin) return null; // طلب ليس من متصفح (curl، خادم آخر)
  return ALLOWED_ORIGINS.includes(origin) ? origin : false;
}

module.exports = async function handler(req, res) {
  const origin = resolveOrigin(req);

  if (origin === false) {
    return res.status(403).json({ ok: false, error: "أصل غير مصرّح به." });
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Sky-Key");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();

  // المفتاح المشترك يعمل فقط إن ضُبط SKY_API_KEY في متغيرات بيئة Vercel،
  // فلا ينكسر الموقع إن لم تضبطه بعد
  const apiKey = process.env.SKY_API_KEY;
  if (apiKey && String(req.headers["x-sky-key"] || "") !== apiKey) {
    return res.status(401).json({ ok: false, error: "غير مصرّح." });
  }

  try {
    if (req.method === "GET") {
      const type = String((req.query && req.query.type) || "completed");
      if (!ALLOWED_TYPES.includes(type)) {
        return res.status(400).json({ ok: false, error: "نوع غير معروف: " + type });
      }

      const flat = await redis(["HGETALL", keyFor(type)]);
      const records = parseHash(flat);

      // الأحدث أولاً
      records.sort((a, b) =>
        String(b.updatedAt || b.savedAt || "") > String(a.updatedAt || a.savedAt || "") ? 1 : -1,
      );

      return res.status(200).json({ ok: true, records });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const type = String(body.type || "completed");
      const records = Array.isArray(body.records) ? body.records : [];

      if (!ALLOWED_TYPES.includes(type)) {
        return res.status(400).json({ ok: false, error: "نوع غير معروف: " + type });
      }
      if (!records.length) return res.status(200).json({ ok: true, added: 0, updated: 0 });

      for (const r of records) {
        if (!r || !r.recordId) {
          return res.status(400).json({ ok: false, error: "سجل بلا معرّف (recordId)." });
        }
      }

      const key = keyFor(type);

      // نعرف أيها جديد قبل الكتابة، لنُبلّغ برقم دقيق
      const existing = await redis(["HKEYS", key]);
      const known = new Set(Array.isArray(existing) ? existing : []);

      const args = ["HSET", key];
      let added = 0;
      let updated = 0;

      records.forEach((r) => {
        args.push(String(r.recordId), JSON.stringify(r));
        if (known.has(String(r.recordId))) updated++;
        else added++;
      });

      await redis(args);
      return res.status(200).json({ ok: true, added, updated });
    }

    if (req.method === "DELETE") {
      const body = await readBody(req);
      const type = String(body.type || "completed");
      const recordId = String(body.recordId || "").trim();

      if (!ALLOWED_TYPES.includes(type)) {
        return res.status(400).json({ ok: false, error: "نوع غير معروف: " + type });
      }
      if (!recordId) return res.status(400).json({ ok: false, error: "المعرّف مطلوب للحذف." });

      const removed = await redis(["HDEL", keyFor(type), recordId]);
      return res.status(200).json({ ok: true, deleted: Number(removed) || 0 });
    }

    return res.status(405).json({ ok: false, error: "طريقة غير مدعومة: " + req.method });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : "خطأ غير متوقع في الخادم.",
    });
  }
};
