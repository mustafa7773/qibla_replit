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

  // ملاحظة: لا يوجد إعداد مزامنة هنا إطلاقاً.
  //
  // refresh() أعلاه يتصل بـ /api/records في نفس النطاق مباشرة، فتعمل المزامنة
  // على أي جهاز بمجرد فتح الموقع. حُذفت من هنا دوال sync/pull/getSyncConfig
  // التي كانت تتطلب لصق رابط Google Apps Script في كل متصفح — لم تعد تُستدعى،
  // ووجودها كان يوهم بأن هناك إعداداً مطلوباً.

  // الأولوية للرابط المضبوط في هذا الجهاز، وإلا فرابط الموقع العام في
  // assets/config.js — وهو ما يجعل المزامنة تعمل على أي جهاز بلا إعداد.
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
  // يجلب السجلات من الجدول ويدمجها محلياً — بهذا تظهر بياناتك على أي جهاز.
  // الدمج بالمعرّف: السجل الموجود يُحدَّث فقط إن كانت نسخة الجدول أحدث،
  // فلا يضيع تعديل محلي لم يُرسل بعد.
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
    refresh,
    pendingRecords,
  };
})();
