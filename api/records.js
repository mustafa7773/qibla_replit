// ============================================================================
// /api/records — نقطة النهاية المركزية لكل بيانات الموقع
//
// لماذا هذا الملف موجود؟
// كانت البيانات تُحفظ في localStorage داخل متصفح كل جهاز، فلا يراها أي متصفح
// آخر. هذه الدالة تعمل على خادم Vercel وتجعل التخزين مركزياً: كل الأجهزة
// تقرأ وتكتب في المكان نفسه.
//
// أين تُخزَّن البيانات فعلياً؟
// في جدول Google Sheets عبر خدمة Apps Script. عنوان الخدمة يُقرأ من متغيّر
// بيئة على الخادم (SHEET_ENDPOINT) ولا يصل المتصفح إطلاقاً — فلا يُكشف أي سر،
// ولا تحدث مشاكل CORS لأن المتصفح يخاطب نطاق موقعك نفسه.
//
// الإعداد المطلوب مرة واحدة في Vercel:
//   Settings → Environment Variables → أضف:
//     Name : SHEET_ENDPOINT
//     Value: https://script.google.com/macros/s/.../exec
//   ثم أعد النشر (Redeploy).
//
// العمليات:
//   GET    /api/records?type=completed|qibla   → قراءة كل السجلات
//   POST   /api/records   { type, records }    → إنشاء أو تحديث (Upsert)
//   DELETE /api/records   { type, recordId }   → حذف سجل
// ============================================================================

const ALLOWED_TYPES = ["completed", "qibla"];

function endpoint() {
  const url = process.env.SHEET_ENDPOINT;
  if (!url) {
    throw new Error(
      "SHEET_ENDPOINT غير مضبوط. أضفه في Vercel → Settings → Environment Variables ثم أعد النشر.",
    );
  }
  return url;
}

// يقرأ جسم الطلب سواء وصل مُحلّلاً أو كنص خام
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

// يخاطب خدمة الجدول. يُرسل نصاً عادياً لأن Apps Script لا تدعم preflight،
// ويُحوّل أي رد غير JSON إلى رسالة مفهومة بدل خطأ غامض.
async function callSheet(payload, method, query) {
  const base = endpoint();
  const url = method === "GET" ? base + (base.includes("?") ? "&" : "?") + query : base;

  const res = await fetch(url, {
    method: method === "GET" ? "GET" : "POST",
    headers: method === "GET" ? undefined : { "Content-Type": "text/plain;charset=utf-8" },
    body: method === "GET" ? undefined : JSON.stringify(payload),
    redirect: "follow",
  });

  const raw = await res.text();

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    if (/<html|accounts\.google|sign ?in/i.test(raw)) {
      throw new Error(
        'خدمة الجدول طلبت تسجيل دخول. في نشر Apps Script اضبط "Who has access" على Anyone.',
      );
    }
    throw new Error("رد غير مفهوم من خدمة الجدول (ليس JSON).");
  }

  if (!res.ok) throw new Error("خدمة الجدول ردّت بحالة " + res.status);
  if (data && data.ok === false) throw new Error(data.error || "خدمة الجدول رفضت الطلب.");

  return data;
}

export default async function handler(req, res) {
  // الواجهة على نفس النطاق، لكن نسمح بالقراءة من أي أصل لتسهيل الاختبار
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      const type = String(req.query.type || "completed");
      if (!ALLOWED_TYPES.includes(type)) {
        return res.status(400).json({ ok: false, error: "نوع غير معروف: " + type });
      }
      const q = type === "qibla" ? "action=list&type=qibla" : "action=list";
      const data = await callSheet(null, "GET", q);
      return res.status(200).json({ ok: true, records: data.records || [] });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const type = String(body.type || "completed");
      const records = Array.isArray(body.records) ? body.records : [];

      if (!ALLOWED_TYPES.includes(type)) {
        return res.status(400).json({ ok: false, error: "نوع غير معروف: " + type });
      }
      if (!records.length) return res.status(200).json({ ok: true, added: 0, updated: 0 });

      // تحقق من الحد الأدنى للسلامة قبل الكتابة
      for (const r of records) {
        if (!r || !r.recordId) {
          return res.status(400).json({ ok: false, error: "سجل بلا معرّف (recordId)." });
        }
      }

      const data = await callSheet({ type, records }, "POST");
      return res.status(200).json({
        ok: true,
        added: data.added || 0,
        updated: data.updated || 0,
      });
    }

    if (req.method === "DELETE") {
      const body = await readBody(req);
      const type = String(body.type || "completed");
      const recordId = String(body.recordId || "").trim();

      if (!ALLOWED_TYPES.includes(type)) {
        return res.status(400).json({ ok: false, error: "نوع غير معروف: " + type });
      }
      if (!recordId) return res.status(400).json({ ok: false, error: "المعرّف مطلوب للحذف." });

      const data = await callSheet({ type, action: "delete", recordId }, "POST");
      return res.status(200).json({ ok: true, deleted: data.deleted || 0 });
    }

    return res.status(405).json({ ok: false, error: "طريقة غير مدعومة: " + req.method });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : "خطأ غير متوقع في الخادم.",
    });
  }
}
