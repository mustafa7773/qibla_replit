// ============================================================================
// طبقة البيانات لأداة "متابعة الطلبات"
//
// لماذا كيان مستقل؟
// -----------------
// الطلب يسبق تحديد القبلة زمنياً: من دفع ولم تُنفَّذ زيارته ليس له سجل قبلة
// أصلاً، فلا مكان يحفظه داخل أداة القبلة. ومن لم ينتهِ بعد لا مكان له في أداة
// المساجد المنتهية. فالطلب هو الكيان الأصل، والقبلة والمنتهية مرحلتان منه.
//
// محوران مستقلان لا حقل حالة واحد
// -------------------------------
// paid و visited مفتاحان منفصلان تماماً، والحالة المعروضة مشتقّة من حاصل
// ضربهما (bucketOf). أي حقل مركّب واحد سيتعارض لاحقاً مع ترتيب واقعي لم نتوقعه
// — كأن يدفع الوكيل بعد الزيارة ثم يطلب تعديلاً قبل الإغلاق.
//
// السجل بديل أداة المساجد المنتهية
// --------------------------------
// الطلب الذي اجتمع فيه الدفع والزيارة هو "مسجد منتهٍ" — لا حاجة لسجل ثانٍ في
// أداة أخرى. لذلك يحمل كل طلب حقل completedAt يُكتب تلقائياً عند اكتمال
// المحورين، وهو محور الإحصاء الزمني (كان completionDate في الأداة المحذوفة).
// السجلات القديمة تُستورد بـ importCompleted مع الاحتفاظ بتاريخها الأصلي.
//
// الأرشفة بلا حذف
// ---------------
// archived يُخرج السجل من المصفوفة والمؤشرات فقط. يبقى في فلتر "المؤرشفة"
// وفي ملف Excel بورقة مستقلة مع سبب مكتوب. لا حذف نهائي من هذه الأداة.
// ============================================================================

(function () {
  "use strict";

  const TYPE = "requests";
  const STORAGE_KEY = "sky_requests_v1";
  const MAX_RECORDS = 5000;

  // ---------------------------------------------------------------- utilities

  function newId() {
    return "rq_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function nowIso() {
    return new Date().toISOString();
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

  function str(v) {
    return String(v == null ? "" : v).trim();
  }

  // عدد الأيام منذ تاريخ ISO — تُستخدم لإظهار عمر الاستحقاق على البطاقة
  function daysSince(iso) {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (!isFinite(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
  }

  // تطبيع رقم الطلب للمطابقة: الأرقام العربية إلى لاتينية، وحذف ما ليس رقماً
  // ولا حرفاً — فيتطابق "٤٥/٢٠٢٦" مع "45-2026"
  function normalizeRequestNo(v) {
    return str(v)
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[^0-9a-zA-Z\u0621-\u064a]/g, "")
      .toLowerCase();
  }

  function cleanAgents(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((a) => ({ name: str(a && a.name), phone: str(a && a.phone) }))
      .filter((a) => a.name || a.phone)
      .slice(0, 10);
  }

  // ---------------------------------------------------------------- validation

  // الحقل الإلزامي الوحيد اسم المسجد — الطلب يُسجَّل غالباً أثناء مكالمة
  // هاتفية، وأي حقل إضافي إجباري يدفع المستخدم لتخطّي التسجيل كلياً.
  function validate(input) {
    const errors = [];
    const name = str(input.mosqueName);
    const amountRaw = input.amount === 0 ? "0" : str(input.amount);

    if (!name) errors.push("أدخل اسم المسجد.");
    else if (name.length > 120) errors.push("اسم المسجد أطول من المسموح.");

    if (amountRaw !== "") {
      const amount = Number(amountRaw);
      if (!isFinite(amount)) errors.push("المبلغ يجب أن يكون رقماً.");
      else if (amount < 0) errors.push("المبلغ لا يمكن أن يكون سالباً.");
      else if (amount > 100000000) errors.push("المبلغ أكبر من المسموح.");
    }

    // الدفع بلا مبلغ يُفقد مؤشر التحصيل معناه، فننبّه دون أن نمنع
    if (input.paid && (amountRaw === "" || Number(amountRaw) === 0)) {
      errors.push("حدّدت أنه دفع بلا مبلغ — أدخل المبلغ أو أزل علامة الدفع.");
    }

    return errors;
  }

  function normalize(input) {
    const amountRaw = input.amount === 0 ? "0" : str(input.amount);
    return {
      mosqueName: str(input.mosqueName),
      mosqueRequestNo: str(input.mosqueRequestNo),
      companyRequestNo: str(input.companyRequestNo),
      governorate: str(input.governorate),
      wilaya: str(input.wilaya),
      village: str(input.village),
      agents: cleanAgents(input.agents),
      amount: amountRaw === "" ? 0 : Math.round(Number(amountRaw) * 1000) / 1000,
      paid: !!input.paid,
      visited: !!input.visited,
      completedAt: str(input.completedAt),
      ready: !!input.ready,
      notes: str(input.notes),
    };
  }

  // ---------------------------------------------------------------- wire

  function fromWire(r) {
    return {
      id: r.recordId || r.id,
      legacyId: r.legacyId || "",
      mosqueName: r.mosqueName || "",
      mosqueRequestNo: r.mosqueRequestNo || "",
      companyRequestNo: r.companyRequestNo || "",
      governorate: r.governorate || "",
      wilaya: r.wilaya || "",
      village: r.village || "",
      agents: cleanAgents(r.agents),
      amount: Number(r.amount) || 0,
      paid: !!r.paid,
      paidAt: r.paidAt || "",
      visited: !!r.visited,
      visitedAt: r.visitedAt || "",
      completedAt: r.completedAt || "",
      ready: !!r.ready,
      archived: !!r.archived,
      archivedAt: r.archivedAt || "",
      archiveNote: r.archiveNote || "",
      notes: r.notes || "",
      createdAt: r.createdAt || r.updatedAt || "",
      updatedAt: r.updatedAt || "",
      syncState: "synced",
    };
  }

  function toWire(r) {
    return {
      recordId: r.id,
      legacyId: r.legacyId,
      mosqueName: r.mosqueName,
      mosqueRequestNo: r.mosqueRequestNo,
      companyRequestNo: r.companyRequestNo,
      governorate: r.governorate,
      wilaya: r.wilaya,
      village: r.village,
      agents: r.agents,
      amount: r.amount,
      paid: r.paid,
      paidAt: r.paidAt,
      visited: r.visited,
      visitedAt: r.visitedAt,
      completedAt: r.completedAt,
      ready: r.ready,
      archived: r.archived,
      archivedAt: r.archivedAt,
      archiveNote: r.archiveNote,
      notes: r.notes,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  // ---------------------------------------------------------------- storage

  function loadAll() {
    if (window.DataAPI) {
      return window.DataAPI.cached(TYPE).map(fromWire);
    }
    const list = readJson(STORAGE_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function persist(list) {
    return writeJson(STORAGE_KEY, list.slice(0, MAX_RECORDS));
  }

  function getById(id) {
    return loadAll().find((r) => r.id === id) || null;
  }

  // يُرسل السجل للخادم إن توفّرت طبقة البيانات، وإلا يُحفظ محلياً
  function commit(record, list, idx) {
    if (window.DataAPI) {
      return { ok: true, record, errors: [], promise: window.DataAPI.save(TYPE, toWire(record)) };
    }
    if (idx === -1) list.unshift(record);
    else list[idx] = record;
    if (!persist(list)) return { ok: false, errors: ["تعذّر الحفظ — مساحة التخزين ممتلئة."] };
    return { ok: true, record, errors: [] };
  }


  // تاريخ الإنجاز يُكتب لحظة اكتمال المحورين ولا يُعاد كتابته بعدها، ويُمحى
  // إن نُقض أحدهما — فلا يبقى مسجد في السجل وهو غير منتهٍ فعلاً.
  function stampCompletion(record) {
    const done = record.paid && record.visited;
    if (done && !record.completedAt) {
      const a = record.paidAt || "";
      const b = record.visitedAt || "";
      record.completedAt = ((a > b ? a : b) || nowIso()).slice(0, 10);
    } else if (!done) {
      record.completedAt = "";
    }
    return record;
  }

  function add(input) {
    const errors = validate(input);
    if (errors.length) return { ok: false, errors };

    const clean = normalize(input);
    const ts = nowIso();
    const record = Object.assign({}, clean, {
      id: newId(),
      paidAt: clean.paid ? ts : "",
      visitedAt: clean.visited ? ts : "",
      archived: false,
      archivedAt: "",
      archiveNote: "",
      createdAt: ts,
      updatedAt: ts,
      syncState: "pending",
    });

    return commit(stampCompletion(record), loadAll(), -1);
  }

  function update(id, input) {
    const errors = validate(input);
    if (errors.length) return { ok: false, errors };

    const list = loadAll();
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return { ok: false, errors: ["الطلب غير موجود."] };

    const prev = list[idx];
    const clean = normalize(input);
    const ts = nowIso();

    // التاريخ يُكتب عند أول تعليم فقط، ويُمحى عند إزالة العلامة — فلا يبقى
    // تاريخ دفعٍ معلّقاً على طلب غير مدفوع
    const record = Object.assign({}, prev, clean, {
      paidAt: clean.paid ? prev.paidAt || ts : "",
      visitedAt: clean.visited ? prev.visitedAt || ts : "",
      updatedAt: ts,
      syncState: "pending",
    });

    // تاريخ كتبه المستخدم في النموذج يُحترم، وإلا يُحسب تلقائياً
    if (!clean.completedAt) record.completedAt = prev.completedAt || "";
    return commit(stampCompletion(record), list, idx);
  }

  // تعديل جزئي — يستخدمه تبديل المفاتيح على البطاقة دون المرور بالنموذج كاملاً
  function patch(id, changes) {
    const list = loadAll();
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return { ok: false, errors: ["الطلب غير موجود."] };

    const prev = list[idx];
    const next = Object.assign({}, prev, changes, {
      updatedAt: nowIso(),
      syncState: "pending",
    });

    if ("paid" in changes) {
      next.paid = !!changes.paid;
      next.paidAt = next.paid ? prev.paidAt || next.updatedAt : "";
    }
    if ("visited" in changes) {
      next.visited = !!changes.visited;
      next.visitedAt = next.visited ? prev.visitedAt || next.updatedAt : "";
    }

    return commit(stampCompletion(next), list, idx);
  }

  function setPaid(id, value) {
    return patch(id, { paid: !!value });
  }

  function setVisited(id, value) {
    return patch(id, { visited: !!value });
  }

  function setReady(id, value) {
    return patch(id, { ready: !!value });
  }

  function archive(id, note) {
    return patch(id, { archived: true, archivedAt: nowIso(), archiveNote: str(note) });
  }

  function unarchive(id) {
    return patch(id, { archived: false, archivedAt: "", archiveNote: "" });
  }

  // الحذف النهائي متاح للحالات الاستثنائية فقط (سجل أُنشئ بالخطأ)،
  // والواجهة تُقدّم الأرشفة عليه دائماً
  function remove(id) {
    if (window.DataAPI) {
      return { list: loadAll(), promise: window.DataAPI.remove(TYPE, id) };
    }
    const list = loadAll().filter((r) => r.id !== id);
    persist(list);
    return { list };
  }

  async function refresh() {
    if (!window.DataAPI) return { ok: false, error: "طبقة البيانات غير محمّلة." };
    try {
      await window.DataAPI.flush(TYPE);
      const records = await window.DataAPI.list(TYPE);
      return { ok: true, total: records.length };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : "تعذّر الاتصال بالخادم" };
    }
  }

  function pendingRecords() {
    if (window.DataAPI) {
      return new Array(window.DataAPI.pendingCount(TYPE)).fill(null);
    }
    return loadAll().filter((r) => r.syncState !== "synced");
  }

  // ---------------------------------------------------------------- الحالات

  const BUCKETS = {
    archived: "مؤرشف",
    fresh: "طلب جديد",
    toVisit: "دفع ولم يُزَر",
    toCollect: "مستحق تحصيل",
    done: "مكتمل",
  };

  // الحالة مشتقّة دائماً، ولا تُخزَّن — فلا تتناقض مع المحورين
  function bucketOf(r) {
    if (r.archived) return "archived";
    if (r.paid && r.visited) return "done";
    if (r.paid) return "toVisit";
    if (r.visited) return "toCollect";
    return "fresh";
  }

  // تاريخ إغلاق الطلب: الأحدث بين الدفع والزيارة
  function closedAt(r) {
    if (!r.paid || !r.visited) return "";
    const a = r.paidAt || "";
    const b = r.visitedAt || "";
    return a > b ? a : b;
  }

  // ---------------------------------------------------------------- المطابقة

  // يبحث عن طلب برقم الطلب بنظام المساجد — أساس الربط مع أداة القبلة
  function findByRequestNo(no) {
    const key = normalizeRequestNo(no);
    if (!key) return null;
    return loadAll().find((r) => normalizeRequestNo(r.mosqueRequestNo) === key) || null;
  }

  // يُستدعى من أداة القبلة بعد حفظ مسجد: يُعلّم الزيارة على الطلب المطابق،
  // وإن لم يوجد يُنشئ طلباً جديداً — فلا يوجد بابان لإدخال نفس المسجد.
  function markVisitedFromQibla(data) {
    const d = data || {};
    const existing = findByRequestNo(d.mosqueRequestNo);

    if (existing) {
      if (existing.visited) return { ok: true, record: existing, errors: [], matched: true };
      const out = patch(existing.id, { visited: true });
      out.matched = true;
      return out;
    }

    const out = add({
      mosqueName: d.mosqueName,
      mosqueRequestNo: d.mosqueRequestNo,
      companyRequestNo: d.companyRequestNo,
      governorate: d.governorate,
      wilaya: d.wilaya,
      village: d.village,
      agents: d.agents,
      ready: true,
      visited: true,
    });
    out.matched = false;
    return out;
  }

  // مدخلات جاهزة لـ CompletedStore.add — الأرشفة إلى المنتهية بلا إدخال ثانٍ
  function toCompletedInput(r) {
    const closed = closedAt(r);
    const agent = (r.agents && r.agents[0]) || {};
    return {
      completionDate: (closed || nowIso()).slice(0, 10),
      governorate: r.governorate,
      price: r.amount,
      mosqueName: r.mosqueName,
      requestNo: r.mosqueRequestNo,
      agentPhone: agent.phone || "",
      notes: r.notes,
    };
  }


  // ================================================================ السجل
  //
  // "المساجد المنتهية" لم تعد أداة مستقلة، بل عرضاً على الطلبات المكتملة.
  // محور الإحصاء هنا completedAt لا createdAt: السؤال دائماً "كم أنجزنا في
  // فبراير"، لا "كم طلباً وصلنا في فبراير".

  function ledger(records) {
    return (records || loadAll()).filter((r) => r.paid && r.visited && !r.archived);
  }

  function ledgerFilters(records, filters) {
    const f = filters || {};
    return records.filter((r) => {
      const d = r.completedAt || "";
      if (f.year && d.slice(0, 4) !== String(f.year)) return false;
      if (f.month && d.slice(5, 7) !== String(f.month).padStart(2, "0")) return false;
      if (f.governorate && r.governorate !== f.governorate) return false;
      if (f.search) {
        const q = String(f.search).toLowerCase();
        const agents = (r.agents || []).map((a) => a.name + " " + a.phone).join(" ");
        const hay = [
          r.mosqueName, r.mosqueRequestNo, r.companyRequestNo, r.governorate,
          r.wilaya, r.village, agents, r.notes, d, String(r.amount),
        ].join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  // إحصاءات السجل — نفس أشكال الأداة المحذوفة ليعمل الرسم البياني بلا تعديل
  function ledgerStats(records) {
    const byMonth = {};
    const byYear = {};
    const byGovernorate = {};
    let total = 0;

    records.forEach((r) => {
      const amount = Number(r.amount) || 0;
      total += amount;
      const d = r.completedAt || "";
      const mk = d.slice(0, 7);
      const yk = d.slice(0, 4);

      if (mk) {
        if (!byMonth[mk]) byMonth[mk] = { key: mk, count: 0, revenue: 0 };
        byMonth[mk].count++;
        byMonth[mk].revenue += amount;
      }
      if (yk) {
        if (!byYear[yk]) byYear[yk] = { key: yk, count: 0, revenue: 0 };
        byYear[yk].count++;
        byYear[yk].revenue += amount;
      }
      const g = r.governorate || "غير محدد";
      if (!byGovernorate[g]) byGovernorate[g] = { key: g, count: 0, revenue: 0 };
      byGovernorate[g].count++;
      byGovernorate[g].revenue += amount;
    });

    const sorted = (o) => Object.values(o).sort((a, b) => (a.key < b.key ? -1 : 1));
    const now = new Date();
    const curMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const curYear = String(now.getFullYear());

    return {
      count: records.length,
      revenue: total,
      average: records.length ? total / records.length : 0,
      thisMonth: byMonth[curMonth] || { count: 0, revenue: 0 },
      thisYear: byYear[curYear] || { count: 0, revenue: 0 },
      byMonth: sorted(byMonth),
      byYear: sorted(byYear),
      byGovernorate: Object.values(byGovernorate).sort((a, b) => b.revenue - a.revenue),
    };
  }

  // ================================================ استيراد السجلات القديمة
  //
  // تُقرأ من نوع "completed" في الخادم وتُكتب كطلبات مكتملة. المعرّف الأصلي
  // يُحفظ في legacyId لا في recordId: تكرار الاستيراد لا يُنشئ نسخة ثانية،
  // والمطابقة برقم الطلب تدمج مع طلب قائم بدل إنشاء توأم له.
  //
  // لا يُحذف شيء من sky:completed — يبقى نسخة احتياطية بعد الدمج.

  function importCompleted(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const current = loadAll();

    const byLegacy = new Map();
    const byNo = new Map();
    current.forEach((r) => {
      if (r.legacyId) byLegacy.set(String(r.legacyId), r);
      const no = normalizeRequestNo(r.mosqueRequestNo);
      if (no) byNo.set(no, r);
    });

    const result = { added: 0, merged: 0, skipped: 0, promises: [] };

    list.forEach((row) => {
      const legacyId = String(row.recordId || row.id || "");
      if (legacyId && byLegacy.has(legacyId)) {
        result.skipped++;
        return;
      }

      const no = normalizeRequestNo(row.requestNo);
      const match = no ? byNo.get(no) : null;

      const date = String(row.completionDate || "").slice(0, 10);
      const amount = Number(row.price) || 0;

      if (match) {
        // طلب قائم لنفس الرقم: نكمل نواقصه ولا نطمس ما فيه
        const out = patch(match.id, {
          paid: true,
          visited: true,
          completedAt: match.completedAt || date,
          amount: match.amount || amount,
          legacyId,
        });
        if (out && out.promise) result.promises.push(out.promise);
        result.merged++;
        return;
      }

      const ts = nowIso();
      const record = {
        id: newId(),
        legacyId,
        mosqueName: str(row.mosqueName) || "مسجد بلا اسم",
        mosqueRequestNo: str(row.requestNo),
        companyRequestNo: "",
        governorate: str(row.governorate),
        wilaya: "",
        village: "",
        agents: row.agentPhone ? [{ name: "", phone: str(row.agentPhone) }] : [],
        amount: Math.round(amount * 1000) / 1000,
        paid: true,
        paidAt: date ? date + "T00:00:00.000Z" : ts,
        visited: true,
        visitedAt: date ? date + "T00:00:00.000Z" : ts,
        completedAt: date,
        ready: true,
        archived: false,
        archivedAt: "",
        archiveNote: "",
        notes: str(row.notes),
        createdAt: row.createdAt || ts,
        updatedAt: ts,
        syncState: "pending",
      };

      const out = commit(record, current, -1);
      if (out && out.promise) result.promises.push(out.promise);
      if (no) byNo.set(no, record);
      if (legacyId) byLegacy.set(legacyId, record);
      result.added++;
    });

    return result;
  }

  // ---------------------------------------------------------------- filtering

  function applyFilters(records, filters) {
    const f = filters || {};
    const wantArchived = f.bucket === "archived" || f.includeArchived === true;

    return records.filter((r) => {
      const bucket = bucketOf(r);

      if (!wantArchived && bucket === "archived") return false;
      if (f.bucket && bucket !== f.bucket) return false;
      if (f.governorate && r.governorate !== f.governorate) return false;
      if (f.ready === true && !r.ready) return false;
      if (f.ready === false && r.ready) return false;

      if (f.search) {
        const q = String(f.search).toLowerCase();
        const agents = (r.agents || []).map((a) => a.name + " " + a.phone).join(" ");
        const hay = [
          r.mosqueName,
          r.mosqueRequestNo,
          r.companyRequestNo,
          r.governorate,
          r.wilaya,
          r.village,
          agents,
          r.notes,
          String(r.amount),
        ]
          .join(" ")
          .toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  // الترتيب داخل كل خانة: الأقدم استحقاقاً أولاً — الطلب المدفوع منذ شهر
  // يجب أن يتصدّر قائمة الجدولة، لا أن يختفي تحت طلب اليوم
  function sortForBucket(records, bucket) {
    const stamp = (r) => {
      if (bucket === "toVisit") return r.paidAt || r.createdAt || "";
      if (bucket === "toCollect") return r.visitedAt || r.createdAt || "";
      if (bucket === "done") return closedAt(r) || r.updatedAt || "";
      if (bucket === "archived") return r.archivedAt || r.updatedAt || "";
      return r.createdAt || "";
    };
    const newestFirst = bucket === "done" || bucket === "archived";
    return records.slice().sort((a, b) => {
      const x = stamp(a);
      const y = stamp(b);
      if (x === y) return 0;
      return newestFirst ? (x > y ? -1 : 1) : x < y ? -1 : 1;
    });
  }

  function group(records) {
    const out = { fresh: [], toVisit: [], toCollect: [], done: [], archived: [] };
    records.forEach((r) => out[bucketOf(r)].push(r));
    Object.keys(out).forEach((k) => {
      out[k] = sortForBucket(out[k], k);
    });
    return out;
  }

  // ---------------------------------------------------------------- statistics

  function monthKey(iso) {
    const d = new Date(iso);
    if (!isFinite(d.getTime())) return "";
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function stats(records) {
    const g = group(records);

    const receivable = g.toCollect.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const prepaid = g.toVisit.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    const now = new Date();
    const curMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");

    let doneThisMonth = 0;
    let revenueThisMonth = 0;
    g.done.forEach((r) => {
      if (monthKey(closedAt(r)) === curMonth) {
        doneThisMonth++;
        revenueThisMonth += Number(r.amount) || 0;
      }
    });

    // أقدم استحقاق في كل جانب — الرقم الذي يستحق أن يُرى قبل غيره
    const oldest = (list, field) => {
      let max = 0;
      list.forEach((r) => {
        const d = daysSince(r[field] || r.createdAt);
        if (d != null && d > max) max = d;
      });
      return max;
    };

    return {
      counts: {
        fresh: g.fresh.length,
        toVisit: g.toVisit.length,
        toCollect: g.toCollect.length,
        done: g.done.length,
        archived: g.archived.length,
      },
      active: g.fresh.length + g.toVisit.length + g.toCollect.length,
      notReady: g.fresh.filter((r) => !r.ready).length,
      receivable: Math.round(receivable * 1000) / 1000,
      prepaid: Math.round(prepaid * 1000) / 1000,
      oldestReceivableDays: oldest(g.toCollect, "visitedAt"),
      oldestPrepaidDays: oldest(g.toVisit, "paidAt"),
      doneThisMonth,
      revenueThisMonth: Math.round(revenueThisMonth * 1000) / 1000,
    };
  }

  window.RequestsStore = {
    BUCKETS,
    validate,
    loadAll,
    getById,
    add,
    update,
    patch,
    setPaid,
    setVisited,
    setReady,
    archive,
    unarchive,
    remove,
    refresh,
    pendingRecords,
    bucketOf,
    closedAt,
    daysSince,
    group,
    applyFilters,
    sortForBucket,
    stats,
    ledger,
    ledgerFilters,
    ledgerStats,
    importCompleted,
    findByRequestNo,
    markVisitedFromQibla,
    toCompletedInput,
    normalizeRequestNo,
  };
})();
