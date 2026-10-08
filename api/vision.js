// ============================================================================
// قراءة الكروكي بالذكاء الاصطناعي — وسيط خادمي
//
// المتصفح يرسل الصورة إلى هنا، وهذه الدالة تنادي Anthropic بمفتاح مخزَّن
// في متغيّرات بيئة Vercel. المفتاح لا يصل المتصفح إطلاقاً، فلا حاجة
// لمطالبة المستخدم به — وهو مبدأ بقية الخدمات في هذا المشروع.
//
// الإعداد لمرة واحدة:
//   Vercel → Settings → Environment Variables → ANTHROPIC_API_KEY
//   ثم Deployments → ⋯ → Redeploy  (المتغيّرات لا تصل النشر القائم)
//
// CommonJS إلزامي: Vercel يعامل ملفات .js في api/ هكذا ما لم يوجد
// package.json يحدد "type": "module". استخدام export default يُفشل
// بناء الدالة صامتاً فتظهر 404.
// ============================================================================

const MODEL = "claude-sonnet-4-6";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // حد Anthropic للصورة الواحدة
const MAX_MESSAGES = 13;                   // رسالة أولى + 6 جولات تصحيح
const MAX_MESSAGE_CHARS = 6000;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "الطريقة غير مدعومة." });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({
      ok: false,
      error:
        "مفتاح Anthropic غير مضبوط على الخادم. أضف ANTHROPIC_API_KEY في " +
        "إعدادات Vercel ثم أعد النشر.",
    });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { image, mediaType, prompt } = body;

    // وضع المحادثة: مصفوفة رسائل متناوبة (مستخدم ثم مساعد ...) تبدأ برسالة
    // المستخدم الأولى التي تُرفق بها الصورة. بدونها يعمل الطلب كالسابق.
    let messages = null;
    if (Array.isArray(body.messages)) {
      messages = body.messages.map((m) => ({
        role: m && m.role === "assistant" ? "assistant" : "user",
        text: String((m && m.text) || "").slice(0, MAX_MESSAGE_CHARS),
      }));
      const okShape =
        messages.length >= 1 &&
        messages.length <= MAX_MESSAGES &&
        messages.length % 2 === 1 &&
        messages.every((m, i) => m.text && m.role === (i % 2 ? "assistant" : "user"));
      if (!okShape) {
        return res.status(400).json({ ok: false, error: "المحادثة غير صالحة أو طالت أكثر من اللازم." });
      }
    }

    if (!image || (!prompt && !messages)) {
      return res.status(400).json({ ok: false, error: "الطلب ناقص." });
    }
    // طول base64 ≈ ٤/٣ حجم البايتات
    if (image.length * 0.75 > MAX_IMAGE_BYTES) {
      return res.status(413).json({
        ok: false,
        error: "الصورة كبيرة جداً. صغّرها ثم أعد المحاولة.",
      });
    }

    const imageBlock = {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType === "image/png" ? "image/png" : "image/jpeg",
        data: image,
      },
    };
    function buildMessages() {
      if (!messages) {
        return [{ role: "user", content: [imageBlock, { type: "text", text: prompt }] }];
      }
      return messages.map((m, i) => ({
        role: m.role,
        content: i === 0 ? [imageBlock, { type: "text", text: m.text }] : m.text,
      }));
    }

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        messages: buildMessages(),
      }),
    });

    const data = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      const detail =
        (data && data.error && data.error.message) || "سبب غير معروف";
      return res.status(upstream.status).json({
        ok: false,
        error: "تعذّرت القراءة (" + upstream.status + "): " + detail,
      });
    }

    const text = (data.content || [])
      .map((c) => (c.type === "text" ? c.text : ""))
      .filter(Boolean)
      .join("\n");

    return res.status(200).json({ ok: true, text });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "خطأ في الخادم: " + (e && e.message ? e.message : String(e)),
    });
  }
};
