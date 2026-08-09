// ============================================================================
// مزامنة مساجد أداة القبلة بين كل الأجهزة
//
// المساجد التي تحسبها في أداة القبلة كانت محفوظة في متصفح الجهاز فقط، فلا
// تظهر عند فتحك الموقع من جهاز آخر. هذه الوحدة تجعلها تمر عبر قاعدة البيانات
// المركزية للموقع نفسه.
//
// **بلا أي إعداد.** لا رابط تكتبه ولا مفتاح تلصقه: الاتصال يتم مباشرةً مع
// /api/records في نفس النطاق. كان هنا سابقاً مسار بديل عبر Google Apps Script
// يتطلب لصق رابط في كل جهاز — حُذف بالكامل لأنه صار بلا فائدة، ووجوده يوهم
// بأن هناك إعداداً مطلوباً.
//
// تعمل على كل صفحة تستخدم MosqueStore:
//   • عند فتح الصفحة: تجلب أحدث المساجد من الخادم وتدمجها محلياً.
//   • عند حفظ أو تعديل أو حذف مسجد: ترفعه تلقائياً بعد تأخير قصير.
//
// الدمج بالمعرّف، فلا تتكرر السجلات مهما تكررت المزامنة. وما يتعذّر إرساله
// يبقى في طابور DataAPI ويُعاد إرساله عند عودة الاتصال.
// ============================================================================

(function () {
  "use strict";

  const STORE_KEY = "sky_tools_mosques_v1";
  const PUSH_DELAY = 1200;
  const TYPE = "qibla";

  let pushTimer = null;

  function loadLocal() {
    try {
      const list = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function persistLocal(list) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  function toWire(m) {
    return {
      recordId: m.id,
      name: m.name,
      governorate: m.governorate,
      village: m.village,
      requestNo: m.requestNo,
      easting: m.easting,
      northing: m.northing,
      datum: m.datum,
      zone: m.zone,
      lat: m.lat,
      lon: m.lon,
      savedAt: m.savedAt,
    };
  }

  function fromWire(r) {
    return {
      id: r.recordId,
      name: r.name || "مسجد بلا اسم",
      governorate: r.governorate || null,
      village: r.village || null,
      requestNo: r.requestNo || null,
      easting: Number(r.easting) || 0,
      northing: Number(r.northing) || 0,
      datum: r.datum || null,
      zone: r.zone || null,
      lat: isFinite(r.lat) ? r.lat : null,
      lon: isFinite(r.lon) ? r.lon : null,
      savedAt: r.savedAt || new Date().toISOString(),
    };
  }

  function mergeRemote(remote) {
    const local = loadLocal();
    const byId = {};
    local.forEach((m) => {
      byId[m.id] = m;
    });

    let added = 0;
    let updated = 0;

    remote.forEach((incoming) => {
      if (!incoming.id) return;
      const existing = byId[incoming.id];
      if (!existing) {
        local.push(incoming);
        byId[incoming.id] = incoming;
        added++;
      } else if (new Date(incoming.savedAt) > new Date(existing.savedAt || 0)) {
        Object.assign(existing, incoming);
        updated++;
      }
    });

    if (added || updated) {
      local.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
      persistLocal(local);
    }
    return { ok: true, added, updated, total: remote.length };
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    // تأخير بسيط يجمع عدة تعديلات متتابعة في طلب واحد
    pushTimer = setTimeout(() => push(), PUSH_DELAY);
  }

  function hookStore() {
    const store = window.MosqueStore;
    if (!store || store.__cloudHooked) return;

    ["upsert", "updateMeta", "removeById", "clearAll"].forEach((fn) => {
      const original = store[fn];
      if (typeof original !== "function") return;
      store[fn] = function () {
        const result = original.apply(this, arguments);
        schedulePush();
        return result;
      };
    });

    store.__cloudHooked = true;
  }

  // ------------------------------------------------------------------ رفع

  async function push(records) {
    if (!window.DataAPI) return { ok: false, skipped: true };

    const batch = records || loadLocal();
    if (!batch.length) return { ok: true, sent: 0 };

    let sent = 0;
    let lastErr = null;

    for (const m of batch) {
      const r = await window.DataAPI.save(TYPE, toWire(m));
      if (r.synced) sent++;
      else lastErr = r.error;
    }

    return { ok: !lastErr, sent, error: lastErr };
  }

  // ------------------------------------------------------------------ جلب

  async function pull() {
    if (!window.DataAPI) return { ok: false, skipped: true };

    try {
      // نُفرغ ما تعذّر إرساله سابقاً قبل القراءة، فلا يُطمس بنسخة الخادم
      await window.DataAPI.flush(TYPE);
      const remote = await window.DataAPI.list(TYPE);
      return mergeRemote(remote.map(fromWire));
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? err.message : "تعذّر الاتصال بالخادم",
      };
    }
  }

  // ------------------------------------------------------------------ التشغيل

  async function init() {
    hookStore();
    if (!window.DataAPI) return;

    const r = await pull();
    if (r.ok && (r.added || r.updated)) {
      // إعلام الصفحة لتُحدّث ما تعرضه من مساجد
      document.dispatchEvent(
        new CustomEvent("mosques:updated", {
          detail: { added: r.added, updated: r.updated },
        }),
      );
    }
    // رفع أي مسجد محلي لم يصل الخادم بعد
    push();
  }

  window.CloudSync = { push, pull };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
