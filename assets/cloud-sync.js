// ============================================================================
// مزامنة مساجد أداة القبلة بين كل الأجهزة
//
// المساجد التي تحسبها في أداة القبلة كانت محفوظة في متصفح الجهاز فقط، فلا
// تظهر عند فتح الموقع من جهاز آخر. هذه الوحدة تجعلها تمر عبر نفس جدول Excel
// المستخدم في أداة "المساجد المنتهية" — بنفس الرابط ونفس الإعداد.
//
// تعمل على كل صفحة تستخدم MosqueStore:
//   • عند فتح الصفحة: تجلب أحدث المساجد من الجدول وتدمجها محلياً.
//   • عند حفظ أو تعديل أو حذف مسجد: ترفعه تلقائياً.
//
// الدمج بالمعرّف، فلا تتكرر السجلات مهما تكررت المزامنة.
// ============================================================================

(function () {
  "use strict";

  const CONFIG_KEY = "sky_completed_sync_config_v1"; // نفس رابط أداة المنتهية
  const STORE_KEY = "sky_tools_mosques_v1";
  const PUSH_DELAY = 1200;

  // نفس منطق أداة المنتهية: رابط الجهاز إن وُجد، وإلا رابط الموقع العام
  function getEndpoint() {
    let local = "";
    try {
      const cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
      local = (cfg && cfg.endpoint) || "";
    } catch (e) {
      local = "";
    }
    const site = (window.SkyConfig && window.SkyConfig.syncEndpoint) || "";
    return local || site;
  }

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

  // ------------------------------------------------------------------ رفع

  async function push(records) {
    const endpoint = getEndpoint();
    if (!endpoint) return { ok: false, skipped: true };

    const batch = records || loadLocal();
    if (!batch.length) return { ok: true, sent: 0 };

    const body = JSON.stringify({
      type: "qibla",
      records: batch.map((m) => ({
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
      })),
    });

    try {
      // نص عادي لتفادي طلب التحقق المسبق الذي لا تدعمه Apps Script
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: body,
        redirect: "follow",
      });
      if (!res.ok) throw new Error("حالة " + res.status);
      return { ok: true, sent: batch.length };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : "تعذّر الرفع" };
    }
  }

  // ------------------------------------------------------------------ جلب

  async function pull() {
    const endpoint = getEndpoint();
    if (!endpoint) return { ok: false, skipped: true };

    try {
      const url =
        endpoint + (endpoint.indexOf("?") === -1 ? "?" : "&") + "action=list&type=qibla";
      const res = await fetch(url, { method: "GET", redirect: "follow" });
      if (!res.ok) throw new Error("حالة " + res.status);

      const payload = JSON.parse(await res.text());
      if (!payload || payload.ok === false) {
        throw new Error((payload && payload.error) || "تعذّرت القراءة");
      }

      const remote = Array.isArray(payload.records) ? payload.records : [];
      const local = loadLocal();
      const byId = {};
      local.forEach((m) => {
        byId[m.id] = m;
      });

      let added = 0;
      let updated = 0;

      remote.forEach((r) => {
        if (!r.recordId) return;
        const incoming = {
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
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : "تعذّر الجلب" };
    }
  }

  // ------------------------------------------------- الرفع التلقائي عند التغيير

  let pushTimer = null;

  function schedulePush() {
    clearTimeout(pushTimer);
    // تأخير بسيط يجمع عدة تعديلات متتابعة في طلب واحد
    pushTimer = setTimeout(() => push(), PUSH_DELAY);
  }

  // يلتف حول دوال المخزن ليرفع أي تغيير تلقائياً، دون تعديل منطقها
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

  // ------------------------------------------------------------------ التشغيل

  async function init() {
    hookStore();
    if (!getEndpoint()) return;

    const r = await pull();
    if (r.ok && (r.added || r.updated)) {
      // إعلام الصفحة لتُحدّث ما تعرضه من مساجد
      document.dispatchEvent(
        new CustomEvent("mosques:updated", { detail: { added: r.added, updated: r.updated } }),
      );
    }
    // رفع أي مسجد محلي لم يصل الجدول بعد
    push();
  }

  window.CloudSync = { push, pull, getEndpoint };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
