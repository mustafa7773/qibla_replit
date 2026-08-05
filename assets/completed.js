// ============================================================================
// طبقة الواجهة لأداة "المساجد المنتهية"
//
// كل المنطق (التحقق، التخزين، المزامنة، الإحصاء) في assets/completed-store.js.
// هذا الملف مسؤول عن العرض والتفاعل فقط، ولا يعرف شيئاً عن الشبكة.
//
// المبدأ الحاكم للصفحة: البيانات هي الصفحة.
//   • الجدول يبدأ فوق حد الشاشة الأولى، والإضافة درج يُفتح عند الطلب.
//   • الفلاتر ملاصقة للجدول الذي تتحكم به، لا في قسم بعيد عنه.
//   • كل رقم في البطاقات مصحوب بمقارنة — الرقم المجرّد لا يجيب "هل هذا جيد؟".
//   • كل حذف قابل للتراجع، وكل خطأ يظهر عند حقله لا في صندوق أسفل الصفحة.
//
// الرسوم البيانية مرسومة بـ SVG مباشرة بلا أي مكتبة خارجية: أسرع تحميلاً،
// وتتبع نفس ألوان النظام تلقائياً، ولا تضيف اعتمادية جديدة للمشروع.
// ============================================================================

(function () {
  "use strict";

  const store = window.CompletedStore;

  // نعرض ٢٥ صفاً ونزيد بنفس المقدار عند الطلب. عشرة صفوف كانت تعني تصفّح
  // صفحات لعشرين سجلاً، و"عرض المزيد" أبسط من شريط أرقام يطول بلا حد.
  const PAGE_SIZE = 25;

  // مفتاح حفظ حالة العرض: تعديل سجل ثم عودة لا يجب أن يمسح فلترك
  const VIEW_KEY = "sky_completed_view_v1";

  const MONTHS = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ];

  // أيقونات SVG بدل الرموز التعبيرية: تلك يرسمها نظام التشغيل فتختلف بين
  // iOS و Windows و Android، ولا تتبع currentColor فلا يتغيّر لونها للخطر
  const ICON_EDIT =
    '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>';

  const ICON_TRASH =
    '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/>' +
    '<path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';

  const view = {
    filters: { year: "", month: "", governorate: "", search: "" },
    sort: { key: "completionDate", dir: "desc" },
    limit: PAGE_SIZE,
    editingId: null,
    pendingDelete: null, // { ids: [], label: "" }
    selected: new Set(),
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

  // --------------------------------------------------------------- التنبيهات
  //
  // شريط واحد أسفل الشاشة لكل الرسائل. أوضح من صندوقين ثابتين في الصفحة،
  // ويظهر في مجال النظر أياً كان موضع التمرير.
  let toastTimer = null;

  function toast(message, opts) {
    const o = opts || {};
    const box = el("cmToast");
    box.className = "toast" + (o.kind ? " is-" + o.kind : "");
    box.textContent = "";
    box.appendChild(document.createTextNode(message));

    if (o.actionLabel && typeof o.action === "function") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = o.actionLabel;
      btn.addEventListener("click", function () {
        hideToast();
        o.action();
      });
      box.appendChild(btn);
    }

    box.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, o.duration || 5000);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    el("cmToast").classList.add("hidden");
  }

  // أخطاء النموذج تُعلَّم على الحقل نفسه. عرضها في صندوق أسفل النموذج يترك
  // المستخدم يمسح الحقول بصرياً بحثاً عن المقصود — وهي فجوة التقييم الكلاسيكية.
  const ERROR_FIELDS = [
    { match: /تاريخ الإنجاز|سنة تاريخ/, id: "cmDate" },
    { match: /المحافظة/, id: "cmGovernorate" },
    { match: /سعر المشروع/, id: "cmPrice" },
  ];

  function clearFieldErrors() {
    document.querySelectorAll("#cmDrawer .field.has-error").forEach((f) => {
      f.classList.remove("has-error");
      const msg = f.querySelector(".field-error");
      if (msg) msg.remove();
    });
    el("cmError").classList.remove("show");
    el("cmError").textContent = "";
  }

  function showFormErrors(messages) {
    clearFieldErrors();
    const list = Array.isArray(messages) ? messages : [messages];
    const unmatched = [];
    let firstField = null;

    list.forEach((msg) => {
      const hit = ERROR_FIELDS.find((f) => f.match.test(msg));
      if (!hit) {
        unmatched.push(msg);
        return;
      }
      const input = el(hit.id);
      const field = input && input.closest(".field");
      if (!field) {
        unmatched.push(msg);
        return;
      }
      field.classList.add("has-error");
      if (!field.querySelector(".field-error")) {
        const span = document.createElement("span");
        span.className = "field-error";
        span.textContent = msg;
        field.appendChild(span);
      }
      if (!firstField) firstField = input;
    });

    if (unmatched.length) {
      const box = el("cmError");
      box.innerHTML = unmatched.map((m) => escapeHtml(m)).join("<br>");
      box.classList.add("show");
    }
    if (firstField) firstField.focus();
  }

  // ------------------------------------------------------------ حفظ حالة العرض
  function saveView() {
    try {
      sessionStorage.setItem(
        VIEW_KEY,
        JSON.stringify({ filters: view.filters, sort: view.sort }),
      );
    } catch (e) {
      // التخزين ممتلئ أو محظور — الحالة تضيع عند التحديث فقط، لا ضرر أكبر
    }
  }

  function restoreView() {
    try {
      const raw = sessionStorage.getItem(VIEW_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.filters) Object.assign(view.filters, saved.filters);
      if (saved.sort) Object.assign(view.sort, saved.sort);
    } catch (e) {
      // حالة تالفة تُتجاهل ونبدأ من الافتراضي
    }
  }

  // ------------------------------------------------------- من أداة القبلة

  // نكتفي بأحدث عشرة: القائمة تُخزَّن بالأحدث أولاً، فالاقتطاع من رأسها يعطي
  // آخر ما عُمل عليه. والبقية تبقى محفوظة ويمكن كتابة اسمها يدوياً.
  const RECENT_QIBLA_LIMIT = 10;

  function fillQiblaPicker() {
    const block = el("cmFromQiblaBlock");
    const sel = el("cmFromQibla");
    if (!block || !sel) return;

    const all =
      window.MosqueStore && typeof window.MosqueStore.loadAll === "function"
        ? window.MosqueStore.loadAll()
        : [];

    if (!all.length) {
      block.classList.add("hidden");
      return;
    }
    block.classList.remove("hidden");

    const saved = all.slice(0, RECENT_QIBLA_LIMIT);
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
          // كلمة صريحة بدل علامة صح: أوضح، ولا يختلف رسمها بين الأنظمة
          const mark = already.has(title) ? " — مُسجَّل" : "";
          const label = title + (gov ? " — " + gov : "") + mark;
          return '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(label) + "</option>";
        })
        .join("");

    const hint = el("cmFromQiblaHint");
    if (hint) {
      const base =
        "يملأ اسم المسجد والمحافظة تلقائياً، فلا يبقى عليك سوى تاريخ الإنجاز والسعر.";
      hint.textContent =
        all.length > RECENT_QIBLA_LIMIT
          ? base + " تعرض القائمة آخر " + RECENT_QIBLA_LIMIT +
            " مساجد فقط من أصل " + all.length + " محفوظة."
          : base;
    }
  }

  function applyQiblaSelection(id) {
    if (!id || !window.MosqueStore) return;
    const m = window.MosqueStore.loadAll().find((x) => x.id === id);
    if (!m) return;

    const title = String(m.name || "").split(" — ")[0].trim();
    if (title) el("cmName").value = title;

    if (m.requestNo) el("cmRequestNo").value = String(m.requestNo).trim();
    if (m.agentPhone) el("cmAgentPhone").value = String(m.agentPhone).trim();

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

    clearFieldErrors();
    el("cmDate").focus();
  }

  // ----------------------------------------------------------------- الدرج

  let lastFocused = null;

  function openDrawer(record) {
    lastFocused = document.activeElement;
    fillGovernorateSelects();
    fillQiblaPicker();
    clearFieldErrors();

    if (record) {
      view.editingId = record.id;
      el("cmDrawerTitle").textContent = "تعديل سجل";
      el("cmAddBtn").textContent = "حفظ التعديل";
      el("cmDate").value = record.completionDate;
      el("cmGovernorate").value = record.governorate;
      el("cmPrice").value = record.price;
      el("cmName").value = record.mosqueName || "";
      el("cmRequestNo").value = record.requestNo || "";
      el("cmAgentPhone").value = record.agentPhone || "";
      el("cmNotes").value = record.notes || "";
    } else {
      view.editingId = null;
      el("cmDrawerTitle").textContent = "إضافة مسجد منتهٍ";
      el("cmAddBtn").textContent = "إضافة المسجد";
      resetFields();
    }

    el("cmDrawerScrim").classList.remove("hidden");
    el("cmDrawer").classList.remove("hidden");
    setTimeout(() => el("cmDate").focus(), 60);
  }

  function closeDrawer() {
    el("cmDrawerScrim").classList.add("hidden");
    el("cmDrawer").classList.add("hidden");
    view.editingId = null;
    // التركيز يعود لمن فتح الدرج، وإلا ضاع مستخدم لوحة المفاتيح في الصفحة
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function resetFields() {
    ["cmDate", "cmPrice", "cmName", "cmRequestNo", "cmAgentPhone", "cmNotes"].forEach(
      (id) => (el(id).value = ""),
    );
    el("cmGovernorate").value = "";
    const picker = el("cmFromQibla");
    if (picker) picker.value = "";
    clearFieldErrors();
  }

  function readForm() {
    return {
      completionDate: el("cmDate").value,
      governorate: el("cmGovernorate").value,
      price: el("cmPrice").value,
      mosqueName: el("cmName").value,
      requestNo: el("cmRequestNo").value,
      agentPhone: el("cmAgentPhone").value,
      notes: el("cmNotes").value,
    };
  }

  // القفل يمنع أي ضغطة ثانية أثناء المعالجة، فلا يُنشأ سجل مكرر
  async function submitForm() {
    if (view.busy) return;
    view.busy = true;
    const btn = el("cmAddBtn");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "جارٍ الحفظ…";

    try {
      const input = readForm();
      const res = view.editingId ? store.update(view.editingId, input) : store.add(input);

      if (!res.ok) {
        showFormErrors(res.errors);
        return;
      }

      const wasEditing = !!view.editingId;
      closeDrawer();
      render();

      if (res.promise) {
        const r = await res.promise;
        render();
        if (r && r.synced === false) {
          toast("حُفظ محلياً، وسيُرسل عند عودة الاتصال.", { kind: "error" });
        } else {
          toast(wasEditing ? "حُفظ التعديل." : "أُضيف المسجد.", { kind: "ok" });
        }
      } else {
        toast(wasEditing ? "حُفظ التعديل." : "أُضيف المسجد.", { kind: "ok" });
      }
    } finally {
      view.busy = false;
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  // ------------------------------------------------------------- الفلاتر

  function fillGovernorateSelects() {
    const list = window.Governorates ? window.Governorates.list() : [];
    const opts = list
      .map((g) => '<option value="' + escapeHtml(g) + '">' + escapeHtml(g) + "</option>")
      .join("");

    const form = el("cmGovernorate");
    const keep = form.value;
    form.innerHTML = '<option value="">اختر المحافظة</option>' + opts;
    if (keep) form.value = keep;

    const filter = el("fGov");
    const keepF = filter.value || view.filters.governorate;
    filter.innerHTML = '<option value="">كل المحافظات</option>' + opts;
    if (keepF) filter.value = keepF;
  }

  function fillPeriodFilters(records) {
    const years = Array.from(
      new Set(records.map((r) => new Date(r.completionDate).getFullYear()).filter((y) => !isNaN(y))),
    ).sort((a, b) => b - a);

    const y = el("fYear");
    const keepY = y.value || view.filters.year;
    y.innerHTML =
      '<option value="">كل السنوات</option>' +
      years.map((v) => '<option value="' + v + '">' + v + "</option>").join("");
    if (keepY && years.indexOf(Number(keepY)) !== -1) y.value = keepY;

    const m = el("fMonth");
    if (!m.options.length) {
      m.innerHTML =
        '<option value="">كل الأشهر</option>' +
        MONTHS.map((name, i) => '<option value="' + (i + 1) + '">' + name + "</option>").join("");
      if (view.filters.month) m.value = view.filters.month;
    }
  }

  // الفلتر المفعَّل يُعلَّم بصرياً: بلا هذا ينسى المستخدم أنه يرى جزءاً من بياناته
  function markActiveFilters() {
    let any = false;
    [["fYear", "year"], ["fMonth", "month"], ["fGov", "governorate"]].forEach(([id, key]) => {
      const on = !!view.filters[key];
      el(id).classList.toggle("is-set", on);
      if (on) any = true;
    });
    if (view.filters.search) any = true;
    el("fReset").classList.toggle("hidden", !any);
  }

  // -------------------------------------------------------------- البطاقات

  // نطاق الفترة السابقة لنفس طول الفترة الحالية، لحساب نسبة التغيّر
  function previousPeriodStats(all) {
    const now = new Date();
    const curM = now.getMonth();
    const curY = now.getFullYear();
    const prev = new Date(curY, curM - 1, 1);

    let count = 0;
    let revenue = 0;
    all.forEach((r) => {
      const d = new Date(r.completionDate);
      if (isNaN(d.getTime())) return;
      if (d.getMonth() === prev.getMonth() && d.getFullYear() === prev.getFullYear()) {
        count++;
        revenue += Number(r.price) || 0;
      }
    });
    return { count, revenue };
  }

  function deltaHtml(current, previous, unitLabel) {
    if (!previous) {
      return current
        ? '<span class="stat-cell-delta">لا مقارنة للشهر الماضي</span>'
        : '<span class="stat-cell-delta">—</span>';
    }
    const pct = ((current - previous) / previous) * 100;
    const up = pct >= 0;
    const arrow = up ? "↑" : "↓";
    const cls = up ? "is-up" : "is-down";
    return (
      '<span class="stat-cell-delta ' + cls + '">' + arrow + " " +
      Math.abs(pct).toFixed(0) + "% عن الشهر الماضي" +
      (unitLabel ? " " + unitLabel : "") + "</span>"
    );
  }

  function renderKpis(filtered, all) {
    const s = store.stats(filtered);
    const allStats = store.stats(all);
    const prev = previousPeriodStats(all);

    const cards = [
      {
        label: "مساجد هذا الشهر",
        value: String(allStats.thisMonth.count),
        delta: deltaHtml(allStats.thisMonth.count, prev.count, ""),
      },
      {
        label: "إيراد هذا الشهر (ر.ع)",
        value: formatMoney(allStats.thisMonth.revenue),
        delta: deltaHtml(allStats.thisMonth.revenue, prev.revenue, ""),
      },
      {
        label: "إيراد هذه السنة (ر.ع)",
        value: formatMoney(allStats.thisYear.revenue),
        delta: '<span class="stat-cell-delta">' + allStats.thisYear.count + " مسجداً</span>",
      },
      {
        label: "متوسط سعر المشروع (ر.ع)",
        value: formatMoney(s.average),
        delta:
          '<span class="stat-cell-delta">' +
          (filtered.length === all.length ? "من كل السجلات" : "من المعروض حالياً") +
          "</span>",
      },
    ];

    el("cmKpis").innerHTML = cards
      .map(
        (c) =>
          '<div class="stat-cell"><span class="stat-cell-label">' + c.label + "</span>" +
          '<span class="stat-cell-value">' + escapeHtml(c.value) + "</span>" +
          c.delta + "</div>",
      )
      .join("");
  }

  // --------------------------------------------------------------- الجدول

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

  function rowHtml(r) {
    const synced = r.syncState === "synced";
    const checked = view.selected.has(r.id);
    return (
      '<tr class="' + (checked ? "is-selected" : "") + '" data-id="' + r.id + '">' +
      '<td class="col-check" data-label="تحديد"><input type="checkbox" data-check="' + r.id + '"' +
      (checked ? " checked" : "") + ' aria-label="تحديد هذا السجل" /></td>' +
      '<td class="mono" data-label="تاريخ الإنجاز">' + formatDate(r.completionDate) + "</td>" +
      '<td class="name" data-label="اسم المسجد">' + escapeHtml(r.mosqueName || "—") +
      (synced ? "" : ' <span class="pill is-wait">بانتظار المزامنة</span>') + "</td>" +
      '<td class="mono" data-label="رقم الطلب">' + escapeHtml(r.requestNo || "—") + "</td>" +
      '<td data-label="المحافظة">' + escapeHtml(r.governorate) + "</td>" +
      '<td class="mono" data-label="هاتف الوكيل">' + escapeHtml(r.agentPhone || "—") + "</td>" +
      '<td class="price" data-label="السعر (ر.ع)">' + formatMoney(r.price) + "</td>" +
      '<td class="row-actions col-actions">' +
      '<button type="button" class="icon-btn" data-edit="' + r.id + '" aria-label="تعديل السجل" title="تعديل">' + ICON_EDIT + "</button>" +
      '<button type="button" class="icon-btn danger" data-del="' + r.id + '" aria-label="حذف السجل" title="حذف">' + ICON_TRASH + "</button>" +
      "</td></tr>"
    );
  }

  function render() {
    const all = store.loadAll();
    fillPeriodFilters(all);
    markActiveFilters();

    const filtered = store.applyFilters(all, view.filters);
    const sorted = sortRecords(filtered);
    const slice = sorted.slice(0, view.limit);

    renderKpis(filtered, all);

    const hasRows = sorted.length > 0;
    el("cmEmpty").classList.toggle("hidden", hasRows);
    el("cmTable").classList.toggle("hidden", !hasRows);

    // نصّ الحالة الفارغة يفرّق بين "لا بيانات أصلاً" و"الفلتر أخفى كل شيء"،
    // فالحل مختلف تماماً في الحالتين
    if (!hasRows) {
      const filtering = all.length > 0;
      el("cmEmptyTitle").textContent = filtering ? "لا نتائج لهذه الفلاتر" : "لا توجد سجلات بعد";
      el("cmEmptyText").textContent = filtering
        ? "جرّب توسيع النطاق أو مسح الفلاتر."
        : "سجّل أول مسجد منتهٍ لتبدأ لوحة الإحصاءات في العمل.";
      el("cmEmptyAdd").textContent = filtering ? "مسح الفلاتر" : "إضافة أول مسجد";
      el("cmEmptyAdd").dataset.mode = filtering ? "reset" : "add";
    }

    el("cmTableBody").innerHTML = slice.map(rowHtml).join("");

    // صف المجموع يعكس ما بعد الفلترة: فلترة "فبراير + الظاهرة" تصير جواباً
    // فورياً على سؤال حقيقي — كم قبضنا من الظاهرة في فبراير؟
    const total = sorted.reduce((s, r) => s + (Number(r.price) || 0), 0);
    el("cmTableFoot").innerHTML = hasRows
      ? '<tr><td class="col-check"></td>' +
        '<td colspan="5" data-label="الإجمالي">مجموع ' + sorted.length + " سجلاً" +
        (sorted.length !== all.length ? " (من " + all.length + ")" : "") + "</td>" +
        '<td class="price" data-label="الإجمالي (ر.ع)">' + formatMoney(total) + "</td>" +
        "<td></td></tr>"
      : "";

    el("cmCount").textContent = hasRows
      ? "عرض " + slice.length + " من " + sorted.length + " سجل"
      : "";

    el("cmMore").classList.toggle("hidden", slice.length >= sorted.length);

    document.querySelectorAll("#cmTable th[data-sort]").forEach((th) => {
      const active = th.getAttribute("data-sort") === view.sort.key;
      th.classList.toggle("is-active", active);
      th.setAttribute("data-dir", active ? view.sort.dir : "");
    });

    syncBulkBar(sorted);
    renderCharts(filtered);
    renderConnection();
  }

  // ------------------------------------------------------- الاختيار المتعدد

  function syncBulkBar(visibleRows) {
    // نُسقط أي معرّف اختفى من العرض، فلا يُحذف سجل لا يراه المستخدم
    const visibleIds = new Set(visibleRows.map((r) => r.id));
    Array.from(view.selected).forEach((id) => {
      if (!visibleIds.has(id)) view.selected.delete(id);
    });

    const n = view.selected.size;
    el("cmBulk").classList.toggle("hidden", n === 0);
    if (n) el("cmBulkCount").textContent = n === 1 ? "سجل واحد محدَّد" : n + " سجلات محدَّدة";

    const shown = Array.from(document.querySelectorAll("#cmTableBody tr[data-id]"));
    const allChecked = shown.length > 0 && shown.every((tr) => view.selected.has(tr.dataset.id));
    const box = el("cmCheckAll");
    box.checked = allChecked;
    box.indeterminate = n > 0 && !allChecked;
  }

  function selectedRecords() {
    return store.loadAll().filter((r) => view.selected.has(r.id));
  }

  // --------------------------------------------------------------- الحذف

  function askDelete(ids, label) {
    view.pendingDelete = { ids, label };
    el("cmConfirmText").textContent =
      ids.length === 1 ? "سيُحذف سجل " + label + "." : "سيُحذف " + ids.length + " سجلاً.";
    el("cmConfirmOk").textContent = ids.length === 1 ? "حذف السجل" : "حذف " + ids.length + " سجلات";
    el("cmConfirm").classList.remove("hidden");
    el("cmConfirmCancel").focus();
  }

  function closeConfirm() {
    view.pendingDelete = null;
    el("cmConfirm").classList.add("hidden");
  }

  function performDelete() {
    const job = view.pendingDelete;
    if (!job) return;
    closeConfirm();

    // نحتفظ بنسخ كاملة قبل الحذف: مساح متعب قد يضغط الحذف على الصف الخطأ
    const snapshots = job.ids.map((id) => store.getById(id)).filter(Boolean);
    const promises = [];

    job.ids.forEach((id) => {
      const out = store.remove(id);
      if (out && out.promise) promises.push(out.promise);
      view.selected.delete(id);
    });

    render();

    const finish = () => {
      render();
      toast(
        snapshots.length === 1 ? "حُذف السجل." : "حُذف " + snapshots.length + " سجلاً.",
        {
          actionLabel: "تراجع",
          duration: 10000,
          action: () => restoreSnapshots(snapshots),
        },
      );
    };

    if (promises.length) Promise.all(promises).then(finish, finish);
    else finish();
  }

  // التراجع يعيد الإضافة بنفس البيانات. المعرّف الجديد يختلف عن القديم —
  // وهذا مقبول: المهم أن البيانات لا تضيع.
  function restoreSnapshots(snapshots) {
    const promises = [];
    let failed = 0;

    snapshots.forEach((snap) => {
      const res = store.add({
        completionDate: snap.completionDate,
        governorate: snap.governorate,
        price: snap.price,
        mosqueName: snap.mosqueName,
        requestNo: snap.requestNo,
        agentPhone: snap.agentPhone,
        notes: snap.notes,
      });
      if (!res.ok) failed++;
      else if (res.promise) promises.push(res.promise);
    });

    const done = () => {
      render();
      if (failed) toast("تعذّر استرجاع " + failed + " سجلاً.", { kind: "error" });
      else toast("استُرجعت السجلات.", { kind: "ok" });
    };

    if (promises.length) Promise.all(promises).then(done, done);
    else done();
  }

  // ------------------------------------------------------------- التصدير

  function downloadXlsx(rows, suffix) {
    if (!rows.length) {
      toast("لا توجد سجلات لتصديرها.", { kind: "error" });
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
      a.download = "المساجد المنتهية " + (suffix ? suffix + " " : "") + stamp + ".xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("نُزّل الملف — " + rows.length + " سجلاً.", { kind: "ok" });
    } catch (err) {
      toast("تعذّر إنشاء الملف: " + (err && err.message ? err.message : "خطأ غير متوقع"), {
        kind: "error",
      });
    }
  }

  // ---------------------------------------------------------- حالة الاتصال

  function renderConnection(state, text) {
    const badge = el("cmConn");
    if (!state) return;
    badge.className = "conn-badge is-" + state;
    el("cmConnText").textContent = text;
  }

  // --------------------------------------------------------------- التحميل
  //
  // بلا هذا يبقى الجدول فارغاً أثناء الجلب ثم يظهر فجأة، فتبدو الصفحة معطّلة
  // على شبكة ميدانية بطيئة — فيضغط المستخدم تحديث ويعيد الدورة.
  function showSkeleton() {
    if (store.loadAll().length) return; // عندنا نسخة محفوظة — نعرضها بدل الهيكل
    el("cmEmpty").classList.add("hidden");
    el("cmTable").classList.remove("hidden");
    el("cmTableBody").setAttribute("aria-busy", "true");
    el("cmTableBody").innerHTML = Array.from({ length: 5 })
      .map(
        () =>
          '<tr class="is-skeleton" aria-hidden="true">' +
          Array.from({ length: 8 }).map(() => "<td><span></span></td>").join("") +
          "</tr>",
      )
      .join("");
  }

  function hideSkeleton() {
    el("cmTableBody").removeAttribute("aria-busy");
  }

  // ------------------------------------------------------------- الرسوم

  function renderCharts(filtered) {
    // لا نرسم ما هو مطويّ — الرسم عمل ضائع حتى يُفتح القسم
    if (!el("cmAnalytics").open) return;
    const s = store.stats(filtered);
    barChart(el("chartRevenue"), s.byMonth, "revenue", (v) => formatMoney(v) + " ر.ع");
    barChart(el("chartCount"), s.byMonth, "count", (v) => v + " مسجد");
    barListChart(el("chartGov"), s.byGovernorate, (v) => formatMoney(v) + " ر.ع");
    yearChart(el("chartYear"), s.byYear);
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

  // ------------------------------------------------------------- الربط

  function bind() {
    el("cmOpenForm").addEventListener("click", () => openDrawer(null));
    el("cmDrawerClose").addEventListener("click", closeDrawer);
    el("cmCancel").addEventListener("click", closeDrawer);
    el("cmDrawerScrim").addEventListener("click", closeDrawer);
    el("cmAddBtn").addEventListener("click", submitForm);

    el("cmEmptyAdd").addEventListener("click", function () {
      if (this.dataset.mode === "reset") resetFilters();
      else openDrawer(null);
    });

    el("cmFromQibla").addEventListener("change", function () {
      applyQiblaSelection(this.value);
    });

    document.addEventListener("mosques:updated", fillQiblaPicker);

    // Enter داخل الدرج يحفظ، وEsc يغلق — توقّع أساسي في أي نموذج
    el("cmDrawer").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName === "INPUT") {
        e.preventDefault();
        submitForm();
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!el("cmConfirm").classList.contains("hidden")) closeConfirm();
      else if (!el("cmDrawer").classList.contains("hidden")) closeDrawer();
    });

    // الفلاتر
    [["fYear", "year"], ["fMonth", "month"], ["fGov", "governorate"]].forEach(([id, key]) => {
      el(id).addEventListener("change", function () {
        view.filters[key] = this.value;
        view.limit = PAGE_SIZE;
        saveView();
        render();
      });
    });

    el("fReset").addEventListener("click", resetFilters);

    let searchTimer = null;
    el("cmSearch").addEventListener("input", function () {
      const v = this.value;
      clearTimeout(searchTimer);
      // تأخير قصير: بلا هذا تُعاد الرسوم والجدول عند كل حرف
      searchTimer = setTimeout(() => {
        view.filters.search = v;
        view.limit = PAGE_SIZE;
        saveView();
        render();
      }, 180);
    });

    el("cmMore").addEventListener("click", function () {
      view.limit += PAGE_SIZE;
      render();
    });

    // الترتيب
    document.querySelectorAll("#cmTable th[data-sort]").forEach((th) => {
      th.addEventListener("click", function () {
        const key = this.getAttribute("data-sort");
        if (view.sort.key === key) {
          view.sort.dir = view.sort.dir === "asc" ? "desc" : "asc";
        } else {
          view.sort.key = key;
          view.sort.dir = "asc";
        }
        saveView();
        render();
      });
    });

    // صفوف الجدول
    el("cmTableBody").addEventListener("change", function (e) {
      const box = e.target.closest("[data-check]");
      if (!box) return;
      const id = box.getAttribute("data-check");
      if (box.checked) view.selected.add(id);
      else view.selected.delete(id);
      render();
    });

    el("cmTableBody").addEventListener("click", function (e) {
      const edit = e.target.closest("[data-edit]");
      if (edit) {
        const rec = store.getById(edit.getAttribute("data-edit"));
        if (rec) openDrawer(rec);
        return;
      }
      const del = e.target.closest("[data-del]");
      if (del) {
        const rec = store.getById(del.getAttribute("data-del"));
        if (!rec) return;
        askDelete([rec.id], (rec.mosqueName || rec.governorate) + " بتاريخ " + formatDate(rec.completionDate));
      }
    });

    el("cmCheckAll").addEventListener("change", function () {
      const shown = Array.from(document.querySelectorAll("#cmTableBody tr[data-id]"));
      if (this.checked) shown.forEach((tr) => view.selected.add(tr.dataset.id));
      else shown.forEach((tr) => view.selected.delete(tr.dataset.id));
      render();
    });

    // الاختيار المتعدد
    el("cmBulkClear").addEventListener("click", function () {
      view.selected.clear();
      render();
    });

    el("cmBulkExport").addEventListener("click", function () {
      downloadXlsx(selectedRecords(), "مختارة");
    });

    el("cmBulkDelete").addEventListener("click", function () {
      const ids = Array.from(view.selected);
      if (ids.length) askDelete(ids, "");
    });

    // الحذف
    el("cmConfirmCancel").addEventListener("click", closeConfirm);
    el("cmConfirmOk").addEventListener("click", performDelete);
    el("cmConfirm").addEventListener("click", function (e) {
      if (e.target === this) closeConfirm();
    });

    // التصدير
    el("cmExport").addEventListener("click", function () {
      downloadXlsx(store.applyFilters(store.loadAll(), view.filters), "");
    });

    // الرسوم تُرسم عند فتح القسم فقط
    el("cmAnalytics").addEventListener("toggle", function () {
      if (this.open) renderCharts(store.applyFilters(store.loadAll(), view.filters));
    });
  }

  function resetFilters() {
    view.filters = { year: "", month: "", governorate: "", search: "" };
    view.limit = PAGE_SIZE;
    el("fYear").value = "";
    el("fMonth").value = "";
    el("fGov").value = "";
    el("cmSearch").value = "";
    saveView();
    render();
  }

  // --------------------------------------------------------------- الإقلاع

  function init() {
    if (!store) return;

    restoreView();
    el("cmSearch").value = view.filters.search || "";

    fillGovernorateSelects();
    bind();
    render();

    renderConnection("wait", "جاري التحميل…");
    showSkeleton();

    store.refresh().then((r) => {
      hideSkeleton();
      render();
      if (r.ok) renderConnection("ok", "متصل — " + r.total + " سجل");
      else {
        renderConnection("off", "غير متصل");
        toast("تعذّر الاتصال بالخادم — يُعرض آخر نسخة محفوظة.", { kind: "error" });
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
