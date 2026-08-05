// ============================================================================
// طبقة البيانات لأداة "المساجد المنتهية"
//
// معمارية التخزين
// ---------------
// الموقع يعمل كصفحات ثابتة (GitHub Pages) بلا خادم خاص به. ولأن أي مفتاح أو
// كلمة سر تُوضع في كود المتصفح تكون مكشوفة لأي زائر، فإن الاتصال المباشر بـ
// Microsoft Graph من المتصفح غير آمن هنا.
//
// لذلك الطبقة تعمل بنمط "المحلي أولاً ثم المزامنة":
//   1) كل سجل يُحفظ فوراً في المتصفح — فلا تضيع البيانات أبداً حتى بلا إنترنت.
//   2) ثم يُرسل إلى رابط مزامنة يضبطه المستخدم بنفسه (Google Apps Script أو
//      Power Automate أو Azure Function). المفاتيح تبقى داخل تلك الخدمة على
//      الخادم ولا تظهر في المتصفح إطلاقاً.
//   3) ما يفشل إرساله يبقى في طابور ويُعاد إرساله لاحقاً تلقائياً.
//
// منع التكرار: لكل سجل معرّف ثابت (id) يُرسل مع الطلب، فإن تكرر الإرسال بسبب
// ضغطة مزدوجة أو إعادة محاولة، تتعرّف الخدمة على المعرّف ولا تضيف صفاً جديداً.
// ============================================================================

(function () {
  "use strict";

  const STORAGE_KEY = "sky_completed_mosques_v1";
  const CONFIG_KEY = "sky_completed_sync_config_v1";
  const MAX_RECORDS = 5000;

  // ---------------------------------------------------------------- utilities

  function newId() {
    return (
      "cm_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------- validation

  // يتحقق من صحة السجل ويُعيد قائمة الأخطاء بلغة المستخدم
  function validate(input) {
    const errors = [];
    const date = String(input.completionDate || "").trim();
    const gov = String(input.governorate || "").trim();
    const priceRaw = String(input.price === 0 ? "0" : input.price || "").trim();

    if (!date) {
      errors.push("أدخل تاريخ الإنجاز.");
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime())) {
      errors.push("تاريخ الإنجاز غير صالح.");
    } else {
      const d = new Date(date);
      const year = d.getFullYear();
      if (year < 2000 || year > 2100) errors.push("سنة تاريخ الإنجاز خارج النطاق المقبول.");
    }

    if (!gov) errors.push("اختر المحافظة.");

    if (priceRaw === "") {
      errors.push("أدخل سعر المشروع.");
    } else {
      const price = Number(priceRaw);
      if (!isFinite(price)) errors.push("سعر المشروع يجب أن يكون رقماً.");
      else if (price < 0) errors.push("سعر المشروع لا يمكن أن يكون سالباً.");
      else if (price > 100000000) errors.push("سعر المشروع أكبر من المسموح.");
    }

    return errors;
  }

  // يحوّل مدخلات النموذج إلى سجل نظيف جاهز للتخزين
  function normalize(input) {
    return {
      completionDate: String(input.completionDate).trim(),
      governorate: String(input.governorate).trim(),
      price: Math.round(Number(input.price) * 1000) / 1000,
      mosqueName: String(input.mosqueName || "").trim(),
      requestNo: String(input.requestNo || "").trim(),
      agentPhone: String(input.agentPhone || "").trim(),
      notes: String(input.notes || "").trim(),
    };
  }

  // ---------------------------------------------------------------- storage

  // المصدر الآن هو ما جلبه DataAPI من الخادم (مخزّن مؤقتاً محلياً)
  function loadAll() {
    if (window.DataAPI) {
      return window.DataAPI.cached("completed").map(fromWire);
    }
    const list = readJson(STORAGE_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  // تحويل بين شكل السجل على الخادم وشكله في الواجهة
  function fromWire(r) {
    return {
      id: r.recordId || r.id,
      completionDate: r.completionDate || "",
      governorate: r.governorate || "",
      price: Number(r.price) || 0,
      mosqueName: r.mosqueName || "",
      // السجلات القديمة لا تحمل هذين الحقلين، فتُقرأ كنص فارغ
      requestNo: r.requestNo || "",
      agentPhone: r.agentPhone || "",
      notes: r.notes || "",
      createdAt: r.createdAt || r.updatedAt || "",
      updatedAt: r.updatedAt || "",
      syncState: "synced",
    };
  }

  function toWire(r) {
    return {
      recordId: r.id,
      completionDate: r.completionDate,
      governorate: r.governorate,
      price: r.price,
      mosqueName: r.mosqueName,
      requestNo: r.requestNo,
      agentPhone: r.agentPhone,
      notes: r.notes,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  function persist(list) {
    return writeJson(STORAGE_KEY, list.slice(0, MAX_RECORDS));
  }

  function getById(id) {
    return loadAll().find((r) => r.id === id) || null;
  }

  // يضيف سجلاً جديداً — يُعيد { ok, record, errors }
  function add(input) {
    const errors = validate(input);
    if (errors.length) return { ok: false, errors };

    const clean = normalize(input);
    const record = Object.assign({}, clean, {
      id: newId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncState: "pending",
    });

    if (window.DataAPI) {
      // يُكتب محلياً فوراً ثم يُرسل للخادم — الوعد يُحلّ بعد محاولة الإرسال
      return {
        ok: true,
        record,
        errors: [],
        promise: window.DataAPI.save("completed", toWire(record)),
      };
    }

    const list = loadAll();
    list.unshift(record);
    if (!persist(list)) {
      return { ok: false, errors: ["تعذّر الحفظ — مساحة التخزين ممتلئة."] };
    }
    return { ok: true, record, errors: [] };
  }

  function update(id, input) {
    const errors = validate(input);
    if (errors.length) return { ok: false, errors };

    const list = loadAll();
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return { ok: false, errors: ["السجل غير موجود."] };

    list[idx] = Object.assign({}, list[idx], normalize(input), {
      updatedAt: new Date().toISOString(),
      syncState: "pending",
    });

    if (window.DataAPI) {
      return {
        ok: true,
        record: list[idx],
        errors: [],
        promise: window.DataAPI.save("completed", toWire(list[idx])),
      };
    }

    if (!persist(list)) return { ok: false, errors: ["تعذّر حفظ التعديل."] };
    return { ok: true, record: list[idx], errors: [] };
  }

  function remove(id) {
    if (window.DataAPI) {
      const p = window.DataAPI.remove("completed", id);
      return { list: loadAll(), promise: p };
    }
    const list = loadAll().filter((r) => r.id !== id);
    persist(list);
    return list;
  }

  // تحميل السجلات من الخادم — تُستدعى عند فتح الصفحة
  async function refresh() {
    if (!window.DataAPI) return { ok: false, error: "طبقة البيانات غير محمّلة." };
    try {
      await window.DataAPI.flush("completed");
      const records = await window.DataAPI.list("completed");
      return { ok: true, total: records.length };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : "تعذّر الاتصال بالخادم" };
    }
  }

  // ---------------------------------------------------------------- sync

  // الأولوية للرابط المضبوط في هذا الجهاز، وإلا فرابط الموقع العام في
  // assets/config.js — وهو ما يجعل المزامنة تعمل على أي جهاز بلا إعداد.
  function getSyncConfig() {
    const cfg = readJson(CONFIG_KEY, {});
    const local = (cfg && cfg.endpoint) || "";
    const site = (window.SkyConfig && window.SkyConfig.syncEndpoint) || "";
    return { endpoint: local || site, isSiteDefault: !local && !!site };
  }

  function setSyncConfig(endpoint) {
    const url = String(endpoint || "").trim();
    if (url && !/^https:\/\//i.test(url)) {
      return { ok: false, error: "الرابط يجب أن يبدأ بـ https://" };
    }
    writeJson(CONFIG_KEY, { endpoint: url });
    return { ok: true };
  }

  function markSynced(ids, state) {
    const list = loadAll();
    let changed = false;
    list.forEach((r) => {
      if (ids.indexOf(r.id) !== -1 && r.syncState !== state) {
        r.syncState = state;
        changed = true;
      }
    });
    if (changed) persist(list);
  }

  function pendingRecords() {
    if (window.DataAPI) {
      const n = window.DataAPI.pendingCount("completed");
      return new Array(n).fill(null);
    }
    return loadAll().filter((r) => r.syncState !== "synced");
  }

  // يرسل السجلات غير المُزامنة إلى الرابط المُعرَّف — يُعيد { ok, sent, error }
  async function sync(options) {
    const opts = options || {};
    const { endpoint } = getSyncConfig();
    if (!endpoint) return { ok: false, skipped: true, error: "لم يُضبط رابط المزامنة." };

    const batch = opts.records || pendingRecords();
    if (!batch.length) return { ok: true, sent: 0 };

    const body = JSON.stringify({
      source: "sky-tools-completed-mosques",
      // المعرّف يمنع تكرار الصفوف عند إعادة الإرسال
      records: batch.map((r) => ({
        recordId: r.id,
        completionDate: r.completionDate,
        governorate: r.governorate,
        price: r.price,
        mosqueName: r.mosqueName,
        notes: r.notes,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    });

    const ids = batch.map((r) => r.id);

    try {
      // مهم: نوع المحتوى "نص عادي" وليس JSON.
      // إرساله كـ application/json يجعل المتصفح يُرسل طلب تحقق مسبق (preflight)
      // وهو ما لا تدعمه خدمة Google Apps Script، فيفشل الطلب برسالة
      // "Failed to fetch". المحتوى نفسه يبقى JSON ويُقرأ في الخدمة بـ JSON.parse.
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: body,
        redirect: "follow",
      });

      if (!res.ok) throw new Error("الخدمة ردّت بحالة " + res.status);

      // مهم: Apps Script تردّ بحالة 200 حتى عند فشلها داخلياً، ورسالة الخطأ
      // تكون داخل جسم الرد. لذلك لا يكفي فحص الحالة — نفحص المحتوى نفسه.
      let payload = null;
      try {
        payload = JSON.parse(await res.text());
      } catch (e) {
        payload = null;
      }

      if (payload && payload.ok === false) {
        const rejection = new Error(payload.error || "الخدمة رفضت السجلات");
        // رفض صريح من الخدمة — لا معنى لإعادة الإرسال بلا قراءة الرد
        rejection.definitive = true;
        throw rejection;
      }

      markSynced(ids, "synced");
      return {
        ok: true,
        sent: batch.length,
        added: payload ? payload.added : undefined,
        updated: payload ? payload.updated : undefined,
        // إن تعذّرت قراءة الرد فلا يمكننا تأكيد الكتابة فعلياً
        unverified: !payload,
      };
    } catch (err) {
      // رفض صريح من الخدمة (وصل الطلب لكنها لم تكتب) — نُبلغ السبب ولا نُعيد
      if (err && err.definitive) {
        markSynced(ids, "pending");
        return { ok: false, sent: 0, error: err.message };
      }

      // خطأ شبكة أو CORS: الطلب قد لا يكون وصل أصلاً. محاولة أخيرة بلا قراءة
      // الرد — يصل الطلب فعلاً لكن المتصفح يمنعنا من رؤية نتيجته.
      try {
        await fetch(endpoint, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: body,
        });
        markSynced(ids, "synced");
        return {
          ok: true,
          sent: batch.length,
          unverified: true,
        };
      } catch (err2) {
        markSynced(ids, "pending");
        return {
          ok: false,
          sent: 0,
          error: err && err.message ? err.message : "تعذّر الإرسال",
        };
      }
    }
  }

  // يجلب السجلات من الجدول ويدمجها محلياً — بهذا تظهر بياناتك على أي جهاز.
  // الدمج بالمعرّف: السجل الموجود يُحدَّث فقط إن كانت نسخة الجدول أحدث،
  // فلا يضيع تعديل محلي لم يُرسل بعد.
  async function pull() {
    const { endpoint } = getSyncConfig();
    if (!endpoint) return { ok: false, skipped: true, error: "لم يُضبط رابط المزامنة." };

    try {
      const url = endpoint + (endpoint.indexOf("?") === -1 ? "?" : "&") + "action=list";
      const res = await fetch(url, { method: "GET", redirect: "follow" });
      if (!res.ok) throw new Error("الخدمة ردّت بحالة " + res.status);

      const raw = await res.text();
      let payload = null;
      try {
        payload = JSON.parse(raw);
      } catch (e) {
        // رد غير JSON = صفحة HTML من Google، وسببها غالباً أن النشر مضبوط على
        // "Anyone with Google account" بدل "Anyone" فيُعاد توجيهنا لصفحة دخول
        const looksLikeLogin = /<html|accounts\.google|sign in|تسجيل الدخول/i.test(raw);
        throw new Error(
          looksLikeLogin
            ? 'الخدمة طلبت تسجيل دخول. في النشر اضبط "Who has access" على Anyone.'
            : "رد غير مفهوم من الخدمة (ليس JSON).",
        );
      }
      if (!payload || payload.ok === false) {
        throw new Error((payload && payload.error) || "تعذّرت قراءة الجدول");
      }

      const remote = Array.isArray(payload.records) ? payload.records : [];
      const local = loadAll();
      const byId = {};
      local.forEach((r) => {
        byId[r.id] = r;
      });

      let added = 0;
      let updated = 0;

      remote.forEach((r) => {
        if (!r.recordId) return;
        const existing = byId[r.recordId];

        const incoming = {
          id: r.recordId,
          completionDate: String(r.completionDate || "").trim(),
          governorate: String(r.governorate || "").trim(),
          price: Number(r.price) || 0,
          mosqueName: String(r.mosqueName || "").trim(),
          requestNo: String(r.requestNo || "").trim(),
          agentPhone: String(r.agentPhone || "").trim(),
          notes: String(r.notes || "").trim(),
          updatedAt: r.updatedAt || new Date().toISOString(),
          createdAt: (existing && existing.createdAt) || r.updatedAt || new Date().toISOString(),
          syncState: "synced",
        };

        if (!existing) {
          local.push(incoming);
          byId[incoming.id] = incoming;
          added++;
          return;
        }

        // تعديل محلي لم يُرسل بعد له الأولوية
        if (existing.syncState !== "synced") return;

        if (new Date(incoming.updatedAt) > new Date(existing.updatedAt || 0)) {
          Object.assign(existing, incoming);
          updated++;
        }
      });

      if (added || updated) {
        local.sort((a, b) => (a.completionDate < b.completionDate ? 1 : -1));
        persist(local);
      }

      return { ok: true, added, updated, total: remote.length };
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? err.message : "تعذّر جلب السجلات",
      };
    }
  }

  // ---------------------------------------------------------------- filtering

  function applyFilters(records, filters) {
    const f = filters || {};
    return records.filter((r) => {
      if (f.year && String(new Date(r.completionDate).getFullYear()) !== String(f.year)) return false;
      if (f.month) {
        const m = String(new Date(r.completionDate).getMonth() + 1).padStart(2, "0");
        if (m !== String(f.month).padStart(2, "0")) return false;
      }
      if (f.governorate && r.governorate !== f.governorate) return false;
      if (f.search) {
        const q = String(f.search).toLowerCase();
        const hay = [
          r.mosqueName,
          r.governorate,
          r.requestNo,
          r.agentPhone,
          r.notes,
          r.completionDate,
          String(r.price),
        ]
          .join(" ")
          .toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  // ---------------------------------------------------------------- statistics

  function monthKey(dateStr) {
    const d = new Date(dateStr);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  // يحسب كل الإحصاءات دفعة واحدة من مجموعة سجلات
  function stats(records) {
    const byMonth = {};
    const byYear = {};
    const byGovernorate = {};
    let total = 0;

    records.forEach((r) => {
      const price = Number(r.price) || 0;
      total += price;

      const mk = monthKey(r.completionDate);
      if (!byMonth[mk]) byMonth[mk] = { key: mk, count: 0, revenue: 0 };
      byMonth[mk].count++;
      byMonth[mk].revenue += price;

      const yk = String(new Date(r.completionDate).getFullYear());
      if (!byYear[yk]) byYear[yk] = { key: yk, count: 0, revenue: 0 };
      byYear[yk].count++;
      byYear[yk].revenue += price;

      const g = r.governorate || "غير محدد";
      if (!byGovernorate[g]) byGovernorate[g] = { key: g, count: 0, revenue: 0 };
      byGovernorate[g].count++;
      byGovernorate[g].revenue += price;
    });

    const sortKey = (o) => Object.values(o).sort((a, b) => (a.key < b.key ? -1 : 1));

    const now = new Date();
    const curMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const curYear = String(now.getFullYear());

    return {
      count: records.length,
      revenue: total,
      average: records.length ? total / records.length : 0,
      thisMonth: byMonth[curMonth] || { count: 0, revenue: 0 },
      thisYear: byYear[curYear] || { count: 0, revenue: 0 },
      byMonth: sortKey(byMonth),
      byYear: sortKey(byYear),
      byGovernorate: Object.values(byGovernorate).sort((a, b) => b.revenue - a.revenue),
    };
  }

  window.CompletedStore = {
    validate,
    loadAll,
    getById,
    add,
    update,
    remove,
    applyFilters,
    stats,
    getSyncConfig,
    setSyncConfig,
    sync,
    pull,
    refresh,
    pendingRecords,
  };
})();
