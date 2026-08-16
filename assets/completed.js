// ============================================================================
// طبقة الواجهة لأداة "المساجد المنتهية"
//
// كل المنطق (التحقق، التخزين، المزامنة، الإحصاء) في assets/completed-store.js.
// هذا الملف مسؤول عن العرض والتفاعل فقط.
//
// الرسوم البيانية مرسومة بـ SVG مباشرة بلا أي مكتبة خارجية: أسرع تحميلاً،
// وتتبع نفس ألوان النظام تلقائياً، ولا تضيف اعتمادية جديدة للمشروع.
// ============================================================================

(function () {
  "use strict";

  const store = window.CompletedStore;
  const PAGE_SIZE = 10;

  const MONTHS = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ];

  // حالة العرض فقط — لا تُخزَّن، تُشتق من البيانات عند كل رسم
  const view = {
    filters: { year: "", month: "", governorate: "", search: "" },
    sort: { key: "completionDate", dir: "desc" },
    page: 1,
    editingId: null,
    pendingDeleteId: null,
    busy: false,
  };

  const el = (id) => document.getElementById(id);

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str == null ? "" : String(str);
    return d.innerHTML;
  }

  function formatMoney(n) {
    return (Number(n) || 0).toLocaleString("en-US", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return (
      String(d.getDate()).padStart(2, "0") + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      d.getFullYear()
    );
  }

  function monthLabel(key) {
    const [y, m] = String(key).split("-");
    return MONTHS[parseInt(m, 10) - 1] + " " + y;
  }

  function shortMonth(key) {
    const [, m] = String(key).split("-");
    return MONTHS[parseInt(m, 10) - 1].slice(0, 4);
  }

  // ------------------------------------------------------------- notifications

  let successTimer = null;

  function showError(msgs) {
    const box = el("cmError");
    const list = Array.isArray(msgs) ? msgs : [msgs];
    box.innerHTML = list.map((m) => escapeHtml(m)).join("<br>");
    box.classList.add("show");
    el("cmSuccess").classList.remove("show");
  }

  function clearError() {
    el("cmError").classList.remove("show");
  }

  function showSuccess(msg) {
    const box = el("cmSuccess");
    box.textContent = msg;
    box.classList.add("show");
    clearError();
    clearTimeout(successTimer);
    successTimer = setTimeout(() => box.classList.remove("show"), 5000);
  }

  // يصف ما فعلته الخدمة فعلياً بالجدول، لا مجرد "تم الإرسال"
  function syncSummary(s) {
    if (typeof s.added !== "number" && typeof s.updated !== "number") {
      return "تمت مزامنة " + s.sent + " سجل.";
    }
    const parts = [];
    if (s.added) parts.push("أُضيف " + s.added + " صف");
    if (s.updated) parts.push("حُدّث " + s.updated + " صف");
    if (!parts.length) return "لم يتغيّر أي صف في الجدول.";
    return parts.join(" و") + " في الجدول.";
  }

  // ------------------------------------------------------------- from tool #1

  // يعرض المساجد المحفوظة في أداة القبلة، ويميّز ما أُضيف منها هنا سابقاً
  function fillQiblaPicker() {
    const block = el("cmFromQiblaBlock");
    const sel = el("cmFromQibla");
    // القسم اختياري: غيابه (نسخة HTML أقدم) يجب ألا يُعطّل بقية اللوحة
    if (!block || !sel) return;

    const saved =
      window.MosqueStore && typeof window.MosqueStore.loadAll === "function"
        ? window.MosqueStore.loadAll()
        : [];

    if (!saved.length) {
      block.classList.add("hidden");
      return;
    }
    block.classList.remove("hidden");

    // أسماء المساجد المسجّلة هنا بالفعل، لتمييزها في القائمة
    const already = new Set(
      store.loadAll().map((r) => String(r.mosqueName || "").trim()).filter(Boolean),
    );

    sel.innerHTML =
      '<option value="">— اختر مسجداً —</option>' +
      saved
        .map((m) => {
          const title = String(m.name || "").split(" — ")[0].trim() || "مسجد بلا اسم";
          const gov = window.Governorates
            ? window.Governorates.governorateOf(m.governorate)
            : m.governorate || "";
          const mark = already.has(title) ? " ✓" : "";
          const label = title + (gov ? " — " + gov : "") + mark;
          return '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(label) + "</option>";
        })
        .join("");
  }

  function applyQiblaSelection(id) {
    if (!id || !window.MosqueStore) return;
    const m = window.MosqueStore.loadAll().find((x) => x.id === id);
    if (!m) return;

    const title = String(m.name || "").split(" — ")[0].trim();
    if (title) el("cmName").value = title;

    const gov = window.Governorates
      ? window.Governorates.governorateOf(m.governorate)
      : m.governorate || "";

    if (gov) {
      fillGovernorateSelects();
      const govSel = el("cmGovernorate");
      // المحافظة قادمة من الأداة الأولى وقد لا تكون ضمن القائمة الرسمية
      if (!Array.from(govSel.options).some((o) => o.value === gov)) {
        govSel.insertAdjacentHTML(
          "beforeend",
          '<option value="' + escapeHtml(gov) + '">' + escapeHtml(gov) + "</option>",
        );
      }
      govSel.value = gov;
    }

    clearError();
    // ما تبقّى هو التاريخ والسعر فقط
    el("cmDate").focus();
  }

  // ------------------------------------------------------------- form

  function fillGovernorateSelects() {
    const list = window.Governorates ? window.Governorates.list() : [];
    const opts = list.map((g) => '<option value="' + escapeHtml(g) + '">' + escapeHtml(g) + "</option>").join("");

    const form = el("cmGovernorate");
    const keep = form.value;
    form.innerHTML = '<option value="">اختر المحافظة</option>' + opts;
    if (keep) form.value = keep;

    const filter = el("fGov");
    const keepF = filter.value;
    filter.innerHTML = '<option value="">كل المحافظات</option>' + opts;
    if (keepF) filter.value = keepF;
  }

  function fillPeriodFilters(records) {
    const years = Array.from(
      new Set(records.map((r) => new Date(r.completionDate).getFullYear()).filter((y) => !isNaN(y))),
    ).sort((a, b) => b - a);

    const y = el("fYear");
    const keepY = y.value;
    y.innerHTML =
      '<option value="">كل السنوات</option>' +
      years.map((v) => '<option value="' + v + '">' + v + "</option>").join("");
    if (keepY && years.indexOf(Number(keepY)) !== -1) y.value = keepY;

    const m = el("fMonth");
    if (!m.options.length) {
      m.innerHTML =
        '<option value="">كل الأشهر</option>' +
        MONTHS.map((name, i) => '<option value="' + (i + 1) + '">' + name + "</option>").join("");
    }
  }

  function readForm() {
    return {
      completionDate: el("cmDate").value,
      governorate: el("cmGovernorate").value,
      price: el("cmPrice").value,
      mosqueName: el("cmName").value,
      notes: el("cmNotes").value,
    };
  }

  function resetForm() {
    el("cmDate").value = "";
    el("cmGovernorate").value = "";
    el("cmPrice").value = "";
    el("cmName").value = "";
    el("cmNotes").value = "";
    const picker = el("cmFromQibla");
    if (picker) picker.value = "";
    view.editingId = null;
    el("cmAddBtn").innerHTML =
      '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14m-7-7h14"/></svg> إضافة المسجد';
  }

  function loadIntoForm(record) {
    el("cmDate").value = record.completionDate;
    fillGovernorateSelects();
    el("cmGovernorate").value = record.governorate;
    el("cmPrice").value = record.price;
    el("cmName").value = record.mosqueName || "";
    el("cmNotes").value = record.notes || "";
    view.editingId = record.id;
    el("cmAddBtn").innerHTML =
      '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg> حفظ التعديل';
    el("cmDate").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // منع الإرسال المزدوج: القفل يمنع أي ضغطة ثانية أثناء المعالجة
  async function submitForm() {
    if (view.busy) return;
    view.busy = true;
    const btn = el("cmAddBtn");
    btn.disabled = true;

    try {
      clearError();
      const input = readForm();
      const result = view.editingId ? store.update(view.editingId, input) : store.add(input);

      if (!result.ok) {
        showError(result.errors);
        return;
      }

      const wasEdit = !!view.editingId;
      resetForm();
      render();

      if (result.promise) {
        const r = await result.promise;
        render();
        const base = wasEdit ? "تم حفظ التعديل" : "تمت إضافة المسجد";
        if (r.synced) showSuccess(base + " وحُفظ على الخادم — سيظهر على كل الأجهزة.");
        else showError(base + " محلياً، لكن تعذّر الوصول للخادم: " + r.error + " — سيُعاد الإرسال تلقائياً.");
        return;
      }

      showSuccess(wasEdit ? "تم حفظ التعديل." : "تمت إضافة المسجد.");

      // المزامنة محاولة إضافية لا تُعطّل الحفظ المحلي إن فشلت
      const cfg = store.getSyncConfig();
      if (cfg.endpoint) {
        const s = await store.sync({ records: [result.record] });
        render();
        const base = wasEdit ? "تم حفظ التعديل" : "تمت إضافة المسجد";
        if (s.ok && s.unverified) {
          showSuccess(base + " وأُرسل إلى Excel — تحقّق من الجدول للتأكد من وصوله.");
        } else if (s.ok) {
          showSuccess(base + " — " + syncSummary(s));
        } else {
          showError("حُفظ السجل محلياً، لكن تعذّر إرساله إلى Excel: " + s.error + " — سيُعاد الإرسال عند المزامنة.");
        }
      }
    } finally {
      view.busy = false;
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------- charts (SVG)

  function barChart(container, data, valueKey, formatter) {
    if (!data.length) {
      container.innerHTML = '<p class="chart-empty">لا توجد بيانات لعرضها.</p>';
      return;
    }

    const rows = data.slice(-12);
    const max = Math.max.apply(null, rows.map((d) => d[valueKey])) || 1;
    const W = 100;
    const H = 46;
    const gap = 1.6;
    const barW = Math.max(2, (W - gap * (rows.length - 1)) / rows.length);

    const bars = rows
      .map((d, i) => {
        const h = Math.max(0.6, (d[valueKey] / max) * (H - 10));
        const x = i * (barW + gap);
        const y = H - 8 - h;
        return (
          '<g><title>' + escapeHtml(monthLabel(d.key) + " — " + formatter(d[valueKey])) + "</title>" +
          '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + barW.toFixed(2) +
          '" height="' + h.toFixed(2) + '" rx="0.8" class="bar" />' +
          '<text x="' + (x + barW / 2).toFixed(2) + '" y="' + (H - 2) + '" class="bar-label">' +
          escapeHtml(shortMonth(d.key)) + "</text></g>"
        );
      })
      .join("");

    // تدرّج ذهبي إلى فيروزي كما في التصميم المعتمد
    const gradId = "barGrad_" + Math.random().toString(36).slice(2, 8);
    const defs =
      '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#e8c473"/>' +
      '<stop offset="100%" stop-color="#5fbfa8"/>' +
      "</linearGradient></defs>";

    container.innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" class="chart-svg" role="img" style="--bar-fill:url(#' + gradId + ')">' +
      defs + bars + "</svg>" +
      '<div class="chart-scale"><span>' + formatter(max) + "</span><span>0</span></div>";
  }

  function barListChart(container, data, formatter) {
    if (!data.length) {
      container.innerHTML = '<p class="chart-empty">لا توجد بيانات لعرضها.</p>';
      return;
    }
    const max = Math.max.apply(null, data.map((d) => d.revenue)) || 1;
    container.innerHTML =
      '<ul class="hbar-list">' +
      data
        .slice(0, 8)
        .map((d) => {
          const pct = Math.max(2, (d.revenue / max) * 100);
          return (
            '<li class="hbar"><span class="hbar-name">' + escapeHtml(d.key) + "</span>" +
            '<span class="hbar-track"><span class="hbar-fill" style="width:' + pct.toFixed(1) + '%"></span></span>' +
            '<span class="hbar-val">' + formatter(d.revenue) + "</span></li>"
          );
        })
        .join("") +
      "</ul>";
  }

  function yearChart(container, byYear) {
    if (byYear.length < 2) {
      container.innerHTML =
        '<p class="chart-empty">تظهر المقارنة عند وجود سجلات في أكثر من سنة.</p>';
      return;
    }
    const max = Math.max.apply(null, byYear.map((d) => d.revenue)) || 1;
    container.innerHTML =
      '<ul class="hbar-list">' +
      byYear
        .map((d) => {
          const pct = Math.max(2, (d.revenue / max) * 100);
          return (
            '<li class="hbar"><span class="hbar-name">' + escapeHtml(d.key) + "</span>" +
            '<span class="hbar-track"><span class="hbar-fill" style="width:' + pct.toFixed(1) + '%"></span></span>' +
            '<span class="hbar-val">' + formatMoney(d.revenue) + " ر.ع</span></li>"
          );
        })
        .join("") +
      "</ul>";
  }

  // ------------------------------------------------------------- dashboard

  function renderKpis(s) {
    const cards = [
      { label: "مساجد هذا الشهر", value: String(s.thisMonth.count), note: "منتهية" },
      { label: "إيراد هذا الشهر", value: formatMoney(s.thisMonth.revenue), note: "ر.ع" },
      { label: "مساجد هذه السنة", value: String(s.thisYear.count), note: "منتهية" },
      { label: "إيراد هذه السنة", value: formatMoney(s.thisYear.revenue), note: "ر.ع" },
      { label: "إجمالي المعروض", value: String(s.count), note: "سجل" },
      { label: "إيراد المعروض", value: formatMoney(s.revenue), note: "ر.ع" },
    ];
    el("cmKpis").innerHTML = cards
      .map(
        (c) =>
          '<div class="kpi-card"><span class="kpi-label">' + c.label + "</span>" +
          '<span class="kpi-value">' + escapeHtml(c.value) + "</span>" +
          '<span class="kpi-note">' + c.note + "</span></div>",
      )
      .join("");
  }

  // ------------------------------------------------------------- table

  function sortRecords(records) {
    const { key, dir } = view.sort;
    const mul = dir === "asc" ? 1 : -1;
    return records.slice().sort((a, b) => {
      let x = a[key];
      let y = b[key];
      if (key === "price") {
        x = Number(x) || 0;
        y = Number(y) || 0;
      } else {
        x = String(x || "");
        y = String(y || "");
      }
      if (x < y) return -1 * mul;
      if (x > y) return 1 * mul;
      return 0;
    });
  }

  function renderTable(records) {
    const sorted = sortRecords(records);
    const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    if (view.page > pages) view.page = pages;
    const slice = sorted.slice((view.page - 1) * PAGE_SIZE, view.page * PAGE_SIZE);

    el("cmCount").textContent = sorted.length
      ? "عرض " + slice.length + " من " + sorted.length + " سجل"
      : "";

    el("cmEmpty").classList.toggle("hidden", sorted.length > 0);
    el("cmTable").classList.toggle("hidden", sorted.length === 0);

    el("cmTableBody").innerHTML = slice
      .map((r) => {
        const synced = r.syncState === "synced";
        return (
          "<tr>" +
          '<td class="num">' + formatDate(r.completionDate) + "</td>" +
          "<td>" + escapeHtml(r.governorate) + "</td>" +
          "<td>" + escapeHtml(r.mosqueName || "—") + "</td>" +
          '<td class="num">' + formatMoney(r.price) + "</td>" +
          '<td><span class="pill ' + (synced ? "is-ok" : "is-wait") + '">' +
          (synced ? "مُزامَن" : "بانتظار المزامنة") + "</span></td>" +
          '<td class="row-actions">' +
          '<button type="button" class="icon-btn" data-edit="' + r.id + '" title="تعديل">✎</button>' +
          '<button type="button" class="icon-btn danger" data-del="' + r.id + '" title="حذف">🗑</button>' +
          "</td></tr>"
        );
      })
      .join("");

    // ترقيم الصفحات
    if (pages <= 1) {
      el("cmPagination").innerHTML = "";
    } else {
      let html = '<button type="button" class="page-btn" data-page="' + (view.page - 1) +
        '"' + (view.page === 1 ? " disabled" : "") + ">السابق</button>";
      for (let i = 1; i <= pages; i++) {
        html += '<button type="button" class="page-btn' + (i === view.page ? " is-active" : "") +
          '" data-page="' + i + '">' + i + "</button>";
      }
      html += '<button type="button" class="page-btn" data-page="' + (view.page + 1) +
        '"' + (view.page === pages ? " disabled" : "") + ">التالي</button>";
      el("cmPagination").innerHTML = html;
    }

    // مؤشر عمود الترتيب
    Array.from(document.querySelectorAll("#cmTable th[data-sort]")).forEach((th) => {
      th.classList.toggle("is-active", th.getAttribute("data-sort") === view.sort.key);
      th.setAttribute("data-dir", th.getAttribute("data-sort") === view.sort.key ? view.sort.dir : "");
    });
  }

  // ------------------------------------------------------------- render

  // يشغّل جزءاً من العرض دون أن يُسقط الباقي إن فشل
  function safely(label, fn) {
    try {
      fn();
    } catch (err) {
      console.error("[completed] فشل قسم: " + label, err);
    }
  }

  function render() {
    const all = store.loadAll();
    safely("قوائم المحافظات", fillGovernorateSelects);
    safely("اختيار من أداة القبلة", fillQiblaPicker);
    safely("فلاتر الفترة", () => fillPeriodFilters(all));

    const filtered = store.applyFilters(all, view.filters);
    const s = store.stats(filtered);

    safely("المؤشرات", () => renderKpis(s));
    safely("رسم الإيراد", () =>
      barChart(el("chartRevenue"), s.byMonth, "revenue", (v) => formatMoney(v) + " ر.ع"),
    );
    safely("رسم العدد", () =>
      barChart(el("chartCount"), s.byMonth, "count", (v) => v + " مسجد"),
    );
    safely("رسم المحافظات", () =>
      barListChart(el("chartGov"), s.byGovernorate, (v) => formatMoney(v) + " ر.ع"),
    );
    safely("مقارنة السنوات", () => yearChart(el("chartYear"), s.byYear));
    safely("الجدول", () => renderTable(filtered));

    const pending = store.pendingRecords().length;
    if (window.DataAPI) {
      el("cmSyncStatus").textContent = pending
        ? pending + " تغيير بانتظار الاتصال بالخادم."
        : "كل البيانات محفوظة على الخادم.";
      return;
    }
    const cfg = store.getSyncConfig();
    el("cmSyncStatus").textContent = !cfg.endpoint
      ? "لم يُضبط رابط المزامنة — السجلات محفوظة على هذا الجهاز فقط."
      : pending
      ? pending + " سجل بانتظار الإرسال."
      : cfg.isSiteDefault
      ? "كل السجلات مُزامنة (الرابط من إعدادات الموقع)."
      : "كل السجلات مُزامنة.";
  }

  // ------------------------------------------------------------- export

  // تصدير السجلات المعروضة (بعد الفلاتر) كملف Excel حقيقي قابل للتعديل،
  // بورقة مستقلة لكل شهر وورقة ملخص، مع مجاميع في كل منها.
  function exportToExcel() {
    const rows = store.applyFilters(store.loadAll(), view.filters);
    if (!rows.length) {
      showError("لا توجد سجلات لتصديرها.");
      return;
    }

    try {
      const blob = window.XlsxExport.build(rows);

      const today = new Date();
      const stamp =
        today.getFullYear() + "-" +
        String(today.getMonth() + 1).padStart(2, "0") + "-" +
        String(today.getDate()).padStart(2, "0");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "المساجد المنتهية " + stamp + ".xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showSuccess("تم تصدير " + rows.length + " سجل إلى ملف Excel.");
    } catch (err) {
      showError("تعذّر التصدير: " + (err && err.message ? err.message : err));
    }
  }

  // ------------------------------------------------------------- events

  // يربط حدثاً فقط إن وُجد العنصر — يحمي من اختلاف نسخة HTML عن نسخة JS
  function on(id, event, handler) {
    const node = el(id);
    if (node) node.addEventListener(event, handler);
  }


  function bind() {
    on("cmAddBtn", "click", submitForm);
    on("cmExport", "click", exportToExcel);

    document.addEventListener("mosques:updated", fillQiblaPicker);

    on("cmFromQibla", "change", function () {
      applyQiblaSelection(this.value);
    });

    ["fYear", "fMonth", "fGov"].forEach((id) => {
      on(id, "change", () => {
        view.filters.year = el("fYear").value;
        view.filters.month = el("fMonth").value;
        view.filters.governorate = el("fGov").value;
        view.page = 1;
        render();
      });
    });

    on("fReset", "click", () => {
      el("fYear").value = "";
      el("fMonth").value = "";
      el("fGov").value = "";
      el("cmSearch").value = "";
      view.filters = { year: "", month: "", governorate: "", search: "" };
      view.page = 1;
      render();
    });

    let searchTimer = null;
    on("cmSearch", "input", function () {
      clearTimeout(searchTimer);
      const v = this.value;
      searchTimer = setTimeout(() => {
        view.filters.search = v;
        view.page = 1;
        render();
      }, 180);
    });

    document.querySelectorAll("#cmTable th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-sort");
        if (view.sort.key === key) {
          view.sort.dir = view.sort.dir === "asc" ? "desc" : "asc";
        } else {
          view.sort.key = key;
          view.sort.dir = "asc";
        }
        render();
      });
    });

    on("cmPagination", "click", (e) => {
      const btn = e.target.closest("[data-page]");
      if (!btn || btn.disabled) return;
      view.page = parseInt(btn.getAttribute("data-page"), 10);
      render();
    });

    on("cmTableBody", "click", (e) => {
      const edit = e.target.closest("[data-edit]");
      if (edit) {
        const rec = store.getById(edit.getAttribute("data-edit"));
        if (rec) loadIntoForm(rec);
        return;
      }
      const del = e.target.closest("[data-del]");
      if (del) {
        const rec = store.getById(del.getAttribute("data-del"));
        if (!rec) return;
        view.pendingDeleteId = rec.id;
        el("cmConfirmText").textContent =
          "سيُحذف سجل " + (rec.mosqueName || rec.governorate) + " بتاريخ " + formatDate(rec.completionDate) + ".";
        el("cmConfirm").classList.remove("hidden");
      }
    });

    on("cmConfirmCancel", "click", () => {
      view.pendingDeleteId = null;
      el("cmConfirm").classList.add("hidden");
    });

    on("cmConfirmOk", "click", () => {
      if (view.pendingDeleteId) {
        const out = store.remove(view.pendingDeleteId);
        if (view.editingId === view.pendingDeleteId) resetForm();
        view.pendingDeleteId = null;
        render();
        if (out && out.promise) {
          out.promise.then((r) => {
            render();
            if (r.synced) showSuccess("تم حذف السجل من الخادم.");
            else showError("حُذف محلياً، لكن تعذّر الوصول للخادم: " + r.error);
          });
        } else {
          showSuccess("تم حذف السجل.");
        }
      }
      el("cmConfirm").classList.add("hidden");
    });

    on("cmConfirm", "click", (e) => {
      if (e.target === el("cmConfirm")) {
        view.pendingDeleteId = null;
        el("cmConfirm").classList.add("hidden");
      }
    });

    // فحص يشرح بالضبط أين تتعطل المزامنة
    on("cmDiagBtn", "click", async function () {
      const box = el("cmDiag");
      box.classList.remove("hidden");
      box.textContent = "جاري الفحص...";

      const cfg = store.getSyncConfig();
      const lines = [];
      lines.push("رابط الموقع (config.js): " + ((window.SkyConfig && window.SkyConfig.syncEndpoint) || "(فارغ)"));
      lines.push("الرابط المستخدم فعلياً : " + (cfg.endpoint || "(لا يوجد)"));
      lines.push("مصدره                  : " + (cfg.isSiteDefault ? "إعدادات الموقع" : cfg.endpoint ? "هذا الجهاز" : "—"));
      lines.push("سجلات محلية            : " + store.loadAll().length);
      lines.push("بانتظار الرفع          : " + store.pendingRecords().length);

      if (!cfg.endpoint) {
        lines.push("");
        lines.push("النتيجة: لا يوجد رابط. ضعه في assets/config.js وارفعه.");
        box.textContent = lines.join("\n");
        return;
      }

      const r = await store.pull();
      lines.push("");
      if (r.ok) {
        lines.push("الاتصال    : ناجح ✓");
        lines.push("سجلات الجدول: " + r.total);
        lines.push("جُلب جديد   : " + r.added + " · حُدّث: " + r.updated);
        if (r.total === 0) lines.push("ملاحظة: الجدول فارغ — لم تصل أي سجلات إليه بعد.");
      } else {
        lines.push("الاتصال : فشل ✕");
        lines.push("السبب   : " + r.error);
      }
      box.textContent = lines.join("\n");
      render();
    });

    on("cmSaveEndpoint", "click", () => {
      const res = store.setSyncConfig(el("cmEndpoint").value);
      if (!res.ok) showError(res.error);
      else {
        showSuccess("تم حفظ رابط المزامنة.");
        render();
      }
    });

    on("cmPullNow", "click", async function () {
      if (view.busy) return;
      view.busy = true;
      this.disabled = true;
      try {
        const r = await store.refresh();
        render();
        if (r.ok) showSuccess("تم التحديث من الخادم — " + r.total + " سجل.");
        else showError("تعذّر الاتصال بالخادم: " + r.error);
      } finally {
        view.busy = false;
        this.disabled = false;
      }
    });

    on("cmSyncNow", "click", async function () {
      if (view.busy) return;
      view.busy = true;
      this.disabled = true;
      try {
        if (window.DataAPI) {
          const f = await window.DataAPI.flush("completed");
          await store.refresh();
          render();
          if (f.sent) showSuccess("أُرسل " + f.sent + " تغيير للخادم.");
          else if (f.pending) showError(f.pending + " تغيير ما زال بانتظار الاتصال.");
          else showSuccess("لا توجد تغييرات بانتظار الإرسال.");
          return;
        }
        const s = await store.sync();
        if (s.skipped) showError(s.error);
        else if (s.ok && s.unverified)
          showSuccess("أُرسلت " + s.sent + " سجل — تحقّق من الجدول للتأكد من وصولها.");
        else if (s.ok && !s.sent)
          showSuccess("لا توجد سجلات بانتظار المزامنة.");
        else if (s.ok) showSuccess(syncSummary(s));
        else showError("تعذّرت المزامنة: " + s.error);
        render();
      } finally {
        view.busy = false;
        this.disabled = false;
      }
    });
  }

  // يجلب من الجدول ويعرض النتيجة — يُستخدم عند فتح الصفحة وعند الضغط يدوياً
  async function runPull() {
    const r = await store.pull();
    if (r.skipped) return { handled: false, error: r.error };
    if (!r.ok) return { handled: false, error: r.error };

    render();
    if (r.added || r.updated) {
      const parts = [];
      if (r.added) parts.push("جُلب " + r.added + " سجل جديد");
      if (r.updated) parts.push("حُدّث " + r.updated + " سجل");
      showSuccess(parts.join(" و") + " من الجدول.");
    } else {
      showSuccess("لا جديد في الجدول — كل السجلات محدّثة.");
    }
    return { handled: true };
  }

  // ------------------------------------------------------------- init

  function init() {
    if (!store) return;
    const cfg0 = store.getSyncConfig();
    el("cmEndpoint").value = cfg0.endpoint;
    if (cfg0.isSiteDefault) {
      el("cmEndpoint").placeholder = "مضبوط من إعدادات الموقع — يعمل على كل الأجهزة";
    }
    bind();
    render();

    // فتح الصفحة على أي جهاز يجلب أحدث السجلات من الجدول تلقائياً
    // البيانات تُجلب من الخادم، وهو المصدر الوحيد للحقيقة
    el("cmSyncStatus").textContent = "جاري التحميل من الخادم...";
    store.refresh().then((r) => {
      render();
      if (r.ok) {
        el("cmSyncStatus").textContent = "متصل بالخادم — " + r.total + " سجل.";
      } else {
        el("cmSyncStatus").textContent = "تعذّر الاتصال بالخادم — يُعرض آخر نسخة محفوظة.";
        showError("تعذّر الاتصال بالخادم: " + r.error);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
