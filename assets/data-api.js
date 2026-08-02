// ============================================================================
// طبقة الوصول للبيانات — المصدر الوحيد للحقيقة هو الخادم
//
// سبب المشكلة السابقة: كان localStorage هو مصدر البيانات، وهو خاص بكل متصفح،
// فلا يرى متصفح ما حفظه آخر.
//
// الآن:
//   • كل قراءة وكتابة تمر عبر /api/records على خادم موقعك.
//   • البيانات تُخزَّن مركزياً، فتظهر على أي متصفح وأي جهاز.
//   • localStorage لم يعد مصدراً، بل ذاكرة مؤقتة (Cache) لغرضين فقط:
//       - عرض فوري عند فتح الصفحة قبل وصول رد الخادم
//       - استمرار العمل عند انقطاع الإنترنت، ثم الرفع عند عودته
//   • مسح ذاكرة المتصفح لا يفقد أي بيانات، لأنها موجودة على الخادم.
// ============================================================================

(function () {
  "use strict";

  const API = "/api/records";
  const CACHE_PREFIX = "sky_cache_";
  const QUEUE_PREFIX = "sky_queue_";

  // ------------------------------------------------------------------ cache

  function cacheKey(type) {
    return CACHE_PREFIX + type;
  }

  function queueKey(type) {
    return QUEUE_PREFIX + type;
  }

  function readCache(type) {
    try {
      const raw = localStorage.getItem(cacheKey(type));
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeCache(type, records) {
    try {
      localStorage.setItem(cacheKey(type), JSON.stringify(records));
    } catch (e) {
      // امتلاء التخزين لا يمنع العمل — الخادم هو المرجع
    }
  }

  // طابور العمليات التي لم تصل الخادم بعد (انقطاع إنترنت مثلاً)
  function readQueue(type) {
    try {
      const raw = localStorage.getItem(queueKey(type));
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeQueue(type, ops) {
    try {
      localStorage.setItem(queueKey(type), JSON.stringify(ops));
    } catch (e) {}
  }

  function enqueue(type, op) {
    const q = readQueue(type);
    // عملية واحدة لكل سجل: الأحدث تلغي الأقدم
    const filtered = q.filter((x) => x.recordId !== op.recordId);
    filtered.push(op);
    writeQueue(type, filtered);
  }

  // ------------------------------------------------------------------ http

  async function request(method, options) {
    const opts = options || {};
    const url = method === "GET" ? API + "?type=" + encodeURIComponent(opts.type) : API;

    const res = await fetch(url, {
      method,
      headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(opts.body),
    });

    let data = null;
    try {
      data = JSON.parse(await res.text());
    } catch (e) {
      throw new Error(
        res.status === 404
          ? "الخادم لا يجد /api/records — تأكد أن الموقع منشور على Vercel وأن مجلد api مرفوع."
          : "رد غير مفهوم من الخادم.",
      );
    }

    if (!res.ok || (data && data.ok === false)) {
      throw new Error((data && data.error) || "الخادم ردّ بحالة " + res.status);
    }
    return data;
  }

  // ------------------------------------------------------------------ API

  // قراءة كل السجلات من الخادم، مع تحديث الذاكرة المؤقتة
  async function list(type) {
    const data = await request("GET", { type });
    const records = data.records || [];
    writeCache(type, records);
    return records;
  }

  // إنشاء أو تعديل — تُكتب في الذاكرة فوراً ثم تُرسل للخادم
  async function save(type, record) {
    const cached = readCache(type);
    const idx = cached.findIndex((r) => r.recordId === record.recordId);
    if (idx >= 0) cached[idx] = record;
    else cached.unshift(record);
    writeCache(type, cached);

    try {
      await request("POST", { body: { type, records: [record] } });
      return { ok: true, synced: true };
    } catch (err) {
      enqueue(type, { action: "save", recordId: record.recordId, record });
      return { ok: true, synced: false, error: err.message };
    }
  }

  async function remove(type, recordId) {
    writeCache(
      type,
      readCache(type).filter((r) => r.recordId !== recordId),
    );

    try {
      await request("DELETE", { body: { type, recordId } });
      return { ok: true, synced: true };
    } catch (err) {
      enqueue(type, { action: "delete", recordId });
      return { ok: true, synced: false, error: err.message };
    }
  }

  // إعادة إرسال ما تعذّر إرساله سابقاً
  async function flush(type) {
    const q = readQueue(type);
    if (!q.length) return { ok: true, sent: 0 };

    const remaining = [];
    let sent = 0;

    for (const op of q) {
      try {
        if (op.action === "delete") {
          await request("DELETE", { body: { type, recordId: op.recordId } });
        } else {
          await request("POST", { body: { type, records: [op.record] } });
        }
        sent++;
      } catch (err) {
        remaining.push(op);
      }
    }

    writeQueue(type, remaining);
    return { ok: remaining.length === 0, sent, pending: remaining.length };
  }

  function cached(type) {
    return readCache(type);
  }

  function pendingCount(type) {
    return readQueue(type).length;
  }

  window.DataAPI = { list, save, remove, flush, cached, pendingCount };
})();
