// ============================================================================
// واجهة أداة "متابعة الطلبات"
//
// المصفوفة عرض لا تخزين: كل خانة نتيجة تصفية على مفتاحَي paid و visited، ولا
// يوجد حقل حالة تُكتب فيه. تبديل مفتاح على البطاقة يمرّ بـ RequestsStore الذي
// يكتب في ذاكرة DataAPI فوراً ثم يرسل للخادم — فالواجهة لا تنتظر الشبكة.
//
// أصناف العرض مأخوذة كما هي من completed.css (stat-cell، conn-badge، toast،
// drawer، chip-btn) ومن style.css (link-btn، error-box، field) — لا تُعرَّف
// هنا ولا في requests.css.
// ============================================================================

(function () {
  "use strict";

  // "done" ليست خانة في اللوحة: اجتماع الدفع والزيارة هو تعريف المسجد
  // المنتهي، ومكانه تبويب السجل. يبقى محسوباً في group() للعدّاد والإحصاء.
  const BUCKETS = ["fresh", "toVisit", "toCollect"];
  const RECENT_QIBLA_LIMIT = 40;

  const state = {
    view: "board", // board = المتابعة · ledger = المساجد المنتهية
    filters: { search: "", governorate: "", ready: null, year: "", month: "" },
    sort: { key: "completedAt", dir: "desc" },
    limit: 25,
    editingId: null,
    payingId: null,
    archiveId: null,
    deleteId: null,
  };

  let toastTimer = null;

  // ---------------------------------------------------------------- helpers

  function $(id) {
    return document.getElementById(id);
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // علامة LRM تمنع الفقرة RTL من قلب موضع الفاصلة العشرية
  function money(n) {
    const v = Number(n) || 0;
    return (
      "\u200e" +
      v.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    );
  }

  function daysText(n) {
    if (n == null) return "";
    if (n === 0) return "اليوم";
    if (n === 1) return "منذ يوم";
    if (n === 2) return "منذ يومين";
    if (n <= 10) return "منذ " + n + " أيام";
    return "منذ " + n + " يوماً";
  }


  const MONTHS_AR = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ];

  function monthLabel(key) {
    const parts = String(key).split("-");
    return (MONTHS_AR[parseInt(parts[1], 10) - 1] || "") + " " + parts[0];
  }

  function shortMonth(key) {
    const parts = String(key).split("-");
    const name = MONTHS_AR[parseInt(parts[1], 10) - 1] || "";
    return name.slice(0, 3);
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const parts = String(iso).slice(0, 10).split("-");
    if (parts.length !== 3) return "—";
    return "\u200e" + parts[2] + "-" + parts[1] + "-" + parts[0];
  }

  // completed.css يعرّف is-error و is-ok فقط
  function toast(msg, kind) {
    const box = $("rqToast");
    if (!box) return;
    box.textContent = msg;
    box.className = "toast" + (kind ? " is-" + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.add("hidden"), 3600);
  }

  // conn-badge يعرّف is-ok و is-wait و is-off
  function setConn(state_, text) {
    const badge = $("rqConn");
    const label = $("rqConnText");
    if (badge) badge.className = "conn-badge" + (state_ ? " is-" + state_ : "");
    if (label) label.textContent = text;
  }

  // نتيجة المخزن تحمل وعد الإرسال — نعكس نجاحه على شارة الاتصال
  function trackSync(result) {
    if (!result || !result.promise) return;
    result.promise
      .then((r) => {
        if (r && r.synced === false) setConn("wait", "محفوظ محلياً — بانتظار الاتصال");
        else setConn("ok", "متصل");
        renderAll();
      })
      .catch(() => setConn("off", "تعذّر الاتصال"));
  }

  // ---------------------------------------------------------------- المحافظات

  function governorateList(records) {
    const out = [];
    const seen = new Set();
    const push = (v) => {
      const s = String(v || "").trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    };

    // Governorates.list() يجمع الرسمية مع ما سجّلته أداة القبلة فعلياً
    if (window.Governorates && typeof window.Governorates.list === "function") {
      try {
        window.Governorates.list().forEach(push);
      } catch (e) {
        // القائمة الرسمية غير متاحة — نكتفي بما في السجلات
      }
    }

    records.forEach((r) => push(r.governorate));
    return out;
  }

  function fillSelect(el, list, placeholder, keep) {
    if (!el) return;
    el.innerHTML =
      '<option value="">' +
      placeholder +
      "</option>" +
      list.map((g) => '<option value="' + esc(g) + '">' + esc(g) + "</option>").join("");
    if (keep && list.indexOf(keep) !== -1) el.value = keep;
  }

  function fillGovernorateSelects(records) {
    const list = governorateList(records);
    fillSelect($("rqFilterGov"), list, "المحافظة: الكل", $("rqFilterGov").value);
    fillSelect($("rqGov"), list, "— اختر —", $("rqGov").value);
  }

  // ---------------------------------------------------------------- المؤشرات

  function renderKpis(stats) {
    const box = $("rqKpis");
    if (!box) return;

    const cards = [
      {
        label: "بانتظار الجاهزية",
        value: String(stats.notReady),
        note: stats.counts.fresh + " طلب جديد",
      },
      {
        label: "دفع ولم يُزَر",
        value: String(stats.counts.toVisit),
        note: stats.counts.toVisit
          ? "أقدمه " + daysText(stats.oldestPrepaidDays)
          : "لا شيء معلّق",
      },
      {
        label: "مستحق التحصيل (ر.ع)",
        value: money(stats.receivable),
        note: stats.counts.toCollect
          ? stats.counts.toCollect + " طلب · أقدمه " + daysText(stats.oldestReceivableDays)
          : "لا مستحقات",
        tone: stats.counts.toCollect ? "is-down" : "",
      },
      {
        label: "مكتمل هذا الشهر",
        value: String(stats.doneThisMonth),
        note: money(stats.revenueThisMonth) + " ر.ع",
        tone: stats.doneThisMonth ? "is-up" : "",
      },
    ];

    box.innerHTML = cards
      .map(
        (c) =>
          '<div class="stat-cell"><span class="stat-cell-label">' +
          esc(c.label) +
          "</span>" +
          '<span class="stat-cell-value">' +
          esc(c.value) +
          "</span>" +
          '<span class="stat-cell-delta ' +
          (c.tone || "") +
          '">' +
          esc(c.note) +
          "</span></div>",
      )
      .join("");
  }

  // ---------------------------------------------------------------- البطاقة

  function metaLine(r, bucket) {
    const bits = [];
    if (r.governorate) bits.push(r.governorate);
    if (r.wilaya && r.wilaya !== r.governorate) bits.push(r.wilaya);

    if (bucket === "toVisit") bits.push("دفع " + daysText(RequestsStore.daysSince(r.paidAt)));
    else if (bucket === "toCollect")
      bits.push("زير " + daysText(RequestsStore.daysSince(r.visitedAt)));
    else if (bucket === "fresh") bits.push(r.ready ? "جاهز للزيارة" : "غير جاهز");
    else if (bucket === "archived" && r.archiveNote) bits.push(r.archiveNote);

    return bits.join(" · ");
  }

  function cardHtml(r, bucket) {
    const amount = r.amount ? '<span class="rq-amount">' + money(r.amount) + "</span>" : "";
    const no = r.mosqueRequestNo ? '<span class="rq-no">' + esc(r.mosqueRequestNo) + "</span>" : "";

    // إدخال المبلغ يحدث في البطاقة نفسها: الدرج كله من أجل رقم واحد مبالغة،
    // ويُفقد المستخدم موضعه في المصفوفة
    if (state.payingId === r.id) {
      return (
        '<article class="rq-card is-paying" data-id="' +
        esc(r.id) +
        '">' +
        '<div class="rq-card-top"><h3>' +
        esc(r.mosqueName || "بلا اسم") +
        "</h3></div>" +
        '<div class="rq-pay">' +
        '<input type="number" class="rq-pay-input textarea-mono" min="0" step="0.001" ' +
        'inputmode="decimal" placeholder="المبلغ (ر.ع)" aria-label="المبلغ المدفوع" ' +
        'value="' +
        (r.amount ? esc(r.amount) : "") +
        '" />' +
        '<button type="button" class="chip-btn" data-act="pay-ok">تأكيد</button>' +
        '<button type="button" class="link-btn" data-act="pay-cancel">إلغاء</button>' +
        "</div></article>"
      );
    }

    let actions;
    if (bucket === "archived") {
      actions =
        '<button type="button" class="link-btn" data-act="unarchive">إعادة</button>' +
        '<button type="button" class="link-btn danger" data-act="delete">حذف</button>';
    } else {
      actions =
        '<button type="button" class="link-btn" data-act="paid">' +
        (r.paid ? "إلغاء الدفع" : "تعليم الدفع") +
        "</button>" +
        '<button type="button" class="link-btn" data-act="visited">' +
        (r.visited ? "إلغاء الزيارة" : "تعليم الزيارة") +
        "</button>" +
        '<button type="button" class="link-btn" data-act="edit">تعديل</button>' +
        '<button type="button" class="link-btn" data-act="archive">أرشفة</button>';
    }

    return (
      '<article class="rq-card" data-id="' +
      esc(r.id) +
      '">' +
      '<div class="rq-card-top"><h3>' +
      esc(r.mosqueName || "بلا اسم") +
      "</h3>" +
      amount +
      "</div>" +
      '<p class="rq-card-meta">' +
      esc(metaLine(r, bucket)) +
      no +
      "</p>" +
      '<div class="rq-card-actions">' +
      actions +
      "</div></article>"
    );
  }

  function renderBucket(id, list, bucket) {
    const box = $(id);
    if (!box) return;
    box.innerHTML = list.length
      ? list.map((r) => cardHtml(r, bucket)).join("")
      : '<p class="rq-bucket-empty">لا شيء هنا</p>';
  }

  // ---------------------------------------------------------------- الرسم

  function visibleGroups() {
    const all = RequestsStore.loadAll();
    const visible = RequestsStore.applyFilters(all, {
      search: state.filters.search,
      governorate: state.filters.governorate,
      ready: state.filters.ready,
    });
    const groups = RequestsStore.group(visible);

    // المؤرشفة تُقرأ من الكل لا من المعروض: فلتر الجاهزية لا معنى له عليها
    groups.archived = RequestsStore.sortForBucket(
      RequestsStore.applyFilters(all, {
        bucket: "archived",
        search: state.filters.search,
        governorate: state.filters.governorate,
      }),
      "archived",
    );

    return { all, visible, groups };
  }

  function setView(view) {
    state.view = view;
    state.limit = 25;

    $("rqViewBoard").classList.toggle("is-active", view === "board");
    $("rqViewLedger").classList.toggle("is-active", view === "ledger");
    $("rqViewBoard").setAttribute("aria-selected", String(view === "board"));
    $("rqViewLedger").setAttribute("aria-selected", String(view === "ledger"));

    // فلاتر كل عرض تخصّه: الجاهزية بلا معنى في السجل، والسنة بلا معنى في المتابعة
    $("rqFilterReady").classList.toggle("hidden", view !== "board");
    $("rqFilterYear").classList.toggle("hidden", view !== "ledger");
    $("rqFilterMonth").classList.toggle("hidden", view !== "ledger");
    $("rqArchiveBox").classList.toggle("hidden", view !== "board");

    $("rqSearch").placeholder =
      view === "board" ? "ابحث بالاسم أو رقم الطلب أو الوكيل" : "ابحث في المساجد المنتهية";

    renderAll();
  }

  function renderAll() {
    const { all, visible, groups } = visibleGroups();

    fillGovernorateSelects(all);

    const completeCount = RequestsStore.ledger(all).length;
    $("rqLedgerCount").textContent = completeCount ? String(completeCount) : "";

    const ledgerView = state.view === "ledger";
    $("rqMatrix").classList.toggle("hidden", ledgerView || !all.length);
    $("rqLedger").classList.toggle("hidden", !ledgerView);

    if (ledgerView) {
      $("rqEmpty").classList.add("hidden");
      renderLedger();
      const filtering =
        state.filters.search || state.filters.governorate || state.filters.year || state.filters.month;
      $("rqReset").classList.toggle("hidden", !filtering);
      return;
    }

    renderKpis(RequestsStore.stats(visible));

    BUCKETS.forEach((b) => {
      const cap = b.charAt(0).toUpperCase() + b.slice(1);
      renderBucket("rqList" + cap, groups[b], b);
      const counter = $("rqCount" + cap);
      if (counter) counter.textContent = String(groups[b].length);
    });

    renderBucket("rqListArchived", groups.archived, "archived");
    const hint = $("rqArchiveHint");
    if (hint) {
      hint.textContent = groups.archived.length ? groups.archived.length + " طلب" : "لا شيء مؤرشف";
    }

    const hasAny = all.length > 0;
    $("rqEmpty").classList.toggle("hidden", hasAny);
    $("rqMatrix").classList.toggle("hidden", !hasAny);

    const filtering =
      state.filters.search || state.filters.governorate || state.filters.ready !== null;
    $("rqReset").classList.toggle("hidden", !filtering);
  }


  // ================================================================ السجل
  //
  // الجدول والرسوم منقولة من أداة المساجد المنتهية المحذوفة، بلا تغيير في
  // شكلها البصري — تغيّر مصدر البيانات فقط: الطلبات المكتملة بدل مخزن ثانٍ.

  const ICON_EDIT =
    '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>';

  const ICON_BACK =
    '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5"/></svg>';

  function ledgerRows() {
    const all = RequestsStore.loadAll();
    const rows = RequestsStore.ledgerFilters(RequestsStore.ledger(all), state.filters);
    const key = state.sort.key;
    const mul = state.sort.dir === "asc" ? 1 : -1;

    return rows.slice().sort((a, b) => {
      let x = a[key];
      let y = b[key];
      if (key === "amount") {
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

  function ledgerRowHtml(r) {
    const phone = ((r.agents && r.agents[0]) || {}).phone || "—";
    return (
      '<tr data-id="' + esc(r.id) + '">' +
      '<td class="mono" data-label="تاريخ الإنجاز">' + formatDate(r.completedAt) + "</td>" +
      '<td class="name" data-label="اسم المسجد">' + esc(r.mosqueName || "—") + "</td>" +
      '<td class="mono" data-label="رقم الطلب">' + esc(r.mosqueRequestNo || "—") + "</td>" +
      '<td data-label="المحافظة">' + esc(r.governorate || "—") + "</td>" +
      '<td class="mono" data-label="هاتف الوكيل">' + esc(phone) + "</td>" +
      '<td class="price" data-label="المبلغ (ر.ع)">' + money(r.amount) + "</td>" +
      '<td class="row-actions col-actions">' +
      '<button type="button" class="icon-btn" data-ledger="edit" data-id="' + esc(r.id) +
      '" aria-label="تعديل السجل" title="تعديل">' + ICON_EDIT + "</button>" +
      '<button type="button" class="icon-btn" data-ledger="reopen" data-id="' + esc(r.id) +
      '" aria-label="إعادة إلى المتابعة" title="إعادة إلى المتابعة">' + ICON_BACK + "</button>" +
      "</td></tr>"
    );
  }

  function fillPeriodFilters(rows) {
    const years = Array.from(new Set(rows.map((r) => (r.completedAt || "").slice(0, 4)).filter(Boolean))).sort().reverse();
    const y = $("rqFilterYear");
    const keepY = y.value;
    y.innerHTML =
      '<option value="">السنة: الكل</option>' +
      years.map((v) => '<option value="' + esc(v) + '">' + esc(v) + "</option>").join("");
    if (years.indexOf(keepY) !== -1) y.value = keepY;

    const m = $("rqFilterMonth");
    if (!m.options.length) {
      m.innerHTML =
        '<option value="">الشهر: الكل</option>' +
        MONTHS_AR.map((n, i) => '<option value="' + String(i + 1).padStart(2, "0") + '">' + n + "</option>").join("");
    }
  }

  function renderLedgerKpis(rows, stats) {
    const box = $("rqKpis");
    const cards = [
      { label: "مساجد هذا الشهر", value: String(stats.thisMonth.count), note: money(stats.thisMonth.revenue) + " ر.ع" },
      { label: "إيراد هذا الشهر (ر.ع)", value: money(stats.thisMonth.revenue), note: stats.thisMonth.count + " مسجداً", tone: stats.thisMonth.count ? "is-up" : "" },
      { label: "إيراد هذه السنة (ر.ع)", value: money(stats.thisYear.revenue), note: stats.thisYear.count + " مسجداً" },
      { label: "متوسط المبلغ (ر.ع)", value: money(stats.average), note: "من " + rows.length + " سجلاً معروضاً" },
    ];
    box.innerHTML = cards
      .map(
        (c) =>
          '<div class="stat-cell"><span class="stat-cell-label">' + esc(c.label) + "</span>" +
          '<span class="stat-cell-value">' + esc(c.value) + "</span>" +
          '<span class="stat-cell-delta ' + (c.tone || "") + '">' + esc(c.note) + "</span></div>",
      )
      .join("");
  }

  // --------------------------------------------------------- الرسوم البيانية

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
          "<g><title>" + esc(monthLabel(d.key) + " — " + formatter(d[valueKey])) + "</title>" +
          '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + barW.toFixed(2) +
          '" height="' + h.toFixed(2) + '" rx="0.8" class="bar" />' +
          '<text x="' + (x + barW / 2).toFixed(2) + '" y="' + (H - 2) + '" class="bar-label">' +
          esc(shortMonth(d.key)) + "</text></g>"
        );
      })
      .join("");

    const gradId = "barGrad_" + Math.random().toString(36).slice(2, 8);
    const defs =
      '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#e8c473"/><stop offset="100%" stop-color="#5fbfa8"/>' +
      "</linearGradient></defs>";

    container.innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" class="chart-svg" role="img" style="--bar-fill:url(#' + gradId + ')">' +
      defs + bars + "</svg>" +
      '<div class="chart-scale"><span>' + formatter(max) + "</span><span>0</span></div>";
  }

  function hbarChart(container, data, formatter, emptyText) {
    if (!data.length) {
      container.innerHTML = '<p class="chart-empty">' + emptyText + "</p>";
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
            '<li class="hbar"><span class="hbar-name">' + esc(d.key) + "</span>" +
            '<span class="hbar-track"><span class="hbar-fill" style="width:' + pct.toFixed(1) + '%"></span></span>' +
            '<span class="hbar-val">' + formatter(d.revenue) + "</span></li>"
          );
        })
        .join("") +
      "</ul>";
  }

  function renderCharts(stats) {
    // لا نرسم ما هو مطويّ — عمل ضائع حتى يُفتح القسم
    if (!$("rqAnalytics").open) return;
    const rial = (v) => money(v) + " ر.ع";
    barChart($("rqChartRevenue"), stats.byMonth, "revenue", rial);
    barChart($("rqChartCount"), stats.byMonth, "count", (v) => v + " مسجد");
    hbarChart($("rqChartGov"), stats.byGovernorate, rial, "لا توجد بيانات لعرضها.");
    hbarChart(
      $("rqChartYear"),
      stats.byYear.length > 1 ? stats.byYear : [],
      rial,
      "تظهر المقارنة عند وجود سجلات في أكثر من سنة.",
    );
  }

  function renderLedger() {
    const all = RequestsStore.loadAll();
    const complete = RequestsStore.ledger(all);
    fillPeriodFilters(complete);

    const rows = ledgerRows();
    const slice = rows.slice(0, state.limit);
    const stats = RequestsStore.ledgerStats(rows);

    renderLedgerKpis(rows, stats);
    $("rqTableBody").innerHTML = slice.map(ledgerRowHtml).join("");

    // صف المجموع يعكس ما بعد الفلترة، فيصير جواباً على سؤال حقيقي
    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    $("rqTableFoot").innerHTML = rows.length
      ? '<tr><td colspan="5" data-label="الإجمالي">مجموع ' + rows.length + " سجلاً" +
        (rows.length !== complete.length ? " (من " + complete.length + ")" : "") + "</td>" +
        '<td class="price" data-label="الإجمالي (ر.ع)">' + money(total) + "</td><td></td></tr>"
      : "";

    $("rqTable").classList.toggle("hidden", !rows.length);

    // الرسالة تفرّق بين "لا سجلات أصلاً" و"الفلتر أخفى كل شيء" — الحل مختلف
    const empty = $("rqLedgerEmpty");
    empty.classList.toggle("hidden", rows.length > 0);
    if (!rows.length) {
      empty.textContent = complete.length
        ? "لا نتائج لهذه الفلاتر. جرّب توسيع النطاق أو مسحها."
        : "لا مساجد منتهية بعد. الطلب يظهر هنا تلقائياً حين يجتمع الدفع والزيارة.";
    }
    $("rqTableCount").textContent = rows.length ? "عرض " + slice.length + " من " + rows.length + " سجل" : "";
    $("rqMore").classList.toggle("hidden", slice.length >= rows.length);

    document.querySelectorAll("#rqTable th[data-sort]").forEach((th) => {
      const active = th.getAttribute("data-sort") === state.sort.key;
      th.classList.toggle("is-active", active);
      th.setAttribute("data-dir", active ? state.sort.dir : "");
    });

    renderCharts(stats);
    renderImportBox();
  }

  // ------------------------------------------------------- استيراد القديم

  let legacyRows = null;

  async function checkLegacy() {
    if (!window.DataAPI) return;
    try {
      legacyRows = await window.DataAPI.list("completed");
    } catch (e) {
      legacyRows = null; // الخادم لا يجيب — نحاول لاحقاً
    }
    renderImportBox();
  }

  function renderImportBox() {
    const box = $("rqImportBox");
    if (!box) return;

    if (!legacyRows || !legacyRows.length) {
      box.classList.add("hidden");
      return;
    }

    const known = new Set(RequestsStore.loadAll().map((r) => String(r.legacyId || "")).filter(Boolean));
    const pending = legacyRows.filter((r) => !known.has(String(r.recordId || "")));

    if (!pending.length) {
      box.classList.add("hidden");
      return;
    }

    box.classList.remove("hidden");
    $("rqImportText").textContent =
      "في قاعدة البيانات " + pending.length +
      " سجلاً من أداة المساجد المنتهية القديمة لم تُنقل بعد. الاستيراد لا يحذف الأصل.";
  }

  function runImport() {
    if (!legacyRows || !legacyRows.length) return;

    const out = RequestsStore.importCompleted(legacyRows);
    if (out.promises.length) {
      Promise.all(out.promises.map((p) => p.catch(() => null))).then(() => {
        renderAll();
        renderImportBox();
      });
    }

    renderAll();
    renderImportBox();
    toast(
      "استُورد " + out.added + " سجلاً" +
        (out.merged ? " ودُمج " + out.merged + " مع طلبات قائمة" : ""),
      "ok",
    );
  }

  // ------------------------------------------------------- اختيار من القبلة

  function fillQiblaPicker() {
    const block = $("rqFromQiblaBlock");
    const sel = $("rqFromQibla");
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

    // الأرقام المسجّلة أصلاً تُعلَّم، فلا يُنشأ طلب مكرر بغير قصد
    const taken = new Set(
      RequestsStore.loadAll()
        .map((r) => RequestsStore.normalizeRequestNo(r.mosqueRequestNo))
        .filter(Boolean),
    );

    sel.innerHTML =
      '<option value="">— اختر مسجداً —</option>' +
      all
        .slice(0, RECENT_QIBLA_LIMIT)
        .map((m) => {
          const dup = taken.has(RequestsStore.normalizeRequestNo(m.requestNo));
          return (
            '<option value="' +
            esc(m.id) +
            '">' +
            esc(m.name || "مسجد بلا اسم") +
            (dup ? " (مسجّل)" : "") +
            "</option>"
          );
        })
        .join("");
  }

  function applyQiblaSelection(id) {
    if (!id || !window.MosqueStore) return;
    const m = window.MosqueStore.loadAll().find((x) => x.id === id);
    if (!m) return;

    if (m.name) $("rqName").value = String(m.name).trim();
    if (m.requestNo) $("rqMosqueNo").value = String(m.requestNo).trim();

    // حقل المحافظة في أداة القبلة يحمل "المحافظة - الولاية" معاً
    const raw = String(m.governorate || "");
    if (raw) {
      const gov = window.Governorates ? window.Governorates.governorateOf(raw) || raw : raw;
      fillGovernorateSelects(RequestsStore.loadAll());
      $("rqGov").value = gov;
      if (raw.includes("-")) $("rqWilaya").value = raw.split("-").pop().trim();
    }

    if (m.agentPhone) $("rqPhone").value = String(m.agentPhone).trim();

    // المسجد محفوظ في أداة القبلة، أي أن زيارته تمّت فعلاً
    $("rqVisited").checked = true;
    $("rqReady").checked = true;
  }

  // ---------------------------------------------------------------- الدرج


  // تاريخ الإنجاز يظهر فقط حين يكون له معنى — أي عند اجتماع المحورين
  function syncCompletedField() {
    const done = $("rqPaid").checked && $("rqVisited").checked;
    $("rqCompletedField").classList.toggle("hidden", !done);
  }

  function openDrawer(record) {
    state.editingId = record ? record.id : null;

    $("rqDrawerTitle").textContent = record ? "تعديل الطلب" : "طلب جديد";
    $("rqSave").textContent = record ? "حفظ التعديل" : "حفظ الطلب";

    $("rqName").value = record ? record.mosqueName : "";
    $("rqMosqueNo").value = record ? record.mosqueRequestNo : "";
    $("rqPhone").value = record && record.agents && record.agents[0] ? record.agents[0].phone || "" : "";
    $("rqWilaya").value = record ? record.wilaya : "";
    $("rqNotes").value = record ? record.notes : "";
    $("rqReady").checked = !!(record && record.ready);
    $("rqPaid").checked = !!(record && record.paid);
    $("rqVisited").checked = !!(record && record.visited);
    $("rqCompletedAt").value = record ? record.completedAt || "" : "";
    syncCompletedField();

    fillGovernorateSelects(RequestsStore.loadAll());
    $("rqGov").value = record ? record.governorate : "";

    // المنتقي للإضافة فقط — عند التعديل الطلب مرتبط أصلاً
    if (record) $("rqFromQiblaBlock").classList.add("hidden");
    else {
      $("rqFromQibla").value = "";
      fillQiblaPicker();
    }

    $("rqError").textContent = "";
    $("rqError").classList.remove("show");

    $("rqDrawer").classList.remove("hidden");
    $("rqDrawerScrim").classList.remove("hidden");
    $("rqName").focus();
  }

  function closeDrawer() {
    $("rqDrawer").classList.add("hidden");
    $("rqDrawerScrim").classList.add("hidden");
    state.editingId = null;
  }

  function readForm() {
    return {
      mosqueName: $("rqName").value,
      mosqueRequestNo: $("rqMosqueNo").value,
      governorate: $("rqGov").value,
      wilaya: $("rqWilaya").value,
      agents: [{ name: "", phone: $("rqPhone").value }],
      ready: $("rqReady").checked,
      paid: $("rqPaid").checked,
      visited: $("rqVisited").checked,
      completedAt: $("rqCompletedAt").value,
      notes: $("rqNotes").value,
    };
  }

  function showErrors(errors) {
    const box = $("rqError");
    box.innerHTML = errors.map((e) => "<div>" + esc(e) + "</div>").join("");
    box.classList.add("show");
  }

  function saveForm() {
    const input = readForm();

    // رقم مكرر يجعل الربط مع أداة القبلة يعلّم السجل الخطأ — عطل صامت
    const no = String(input.mosqueRequestNo || "").trim();
    if (no) {
      const clash = RequestsStore.findByRequestNo(no);
      if (clash && clash.id !== state.editingId) {
        showErrors(["رقم الطلب مستخدم في: " + (clash.mosqueName || "طلب آخر") + "."]);
        return;
      }
    }

    const editing = state.editingId;
    const result = editing ? RequestsStore.update(editing, input) : RequestsStore.add(input);

    if (!result.ok) {
      showErrors(result.errors);
      return;
    }

    trackSync(result);
    closeDrawer();
    renderAll();
    toast(editing ? "حُفظ التعديل" : "أُضيف الطلب", "ok");
  }

  // ---------------------------------------------------------------- الإجراءات


  // البطاقة تختفي من اللوحة عند الاكتمال، فلا بد أن يعرف المستخدم أين ذهبت
  function completionToast(id, fallback) {
    const after = RequestsStore.getById(id);
    return after && RequestsStore.bucketOf(after) === "done"
      ? "اكتمل — نُقل إلى المساجد المنتهية"
      : fallback;
  }

  function onCardAction(id, act) {
    const record = RequestsStore.getById(id);
    if (!record) return;

    if (act === "edit") return openDrawer(record);

    if (act === "paid") {
      // بلا مبلغ يفقد مؤشر التحصيل معناه، فنسأل عنه في البطاقة قبل التعليم
      if (!record.paid && !record.amount) {
        state.payingId = id;
        renderAll();
        focusPayInput();
        return;
      }
      trackSync(RequestsStore.setPaid(id, !record.paid));
      renderAll();
      return toast(completionToast(id, record.paid ? "أُزيلت علامة الدفع" : "سُجّل الدفع"), "ok");
    }

    if (act === "pay-cancel") {
      state.payingId = null;
      return renderAll();
    }

    if (act === "pay-ok") return confirmPayment(id);

    if (act === "visited") {
      trackSync(RequestsStore.setVisited(id, !record.visited));
      renderAll();
      return toast(
        completionToast(id, record.visited ? "أُزيلت علامة الزيارة" : "سُجّلت الزيارة"),
        "ok",
      );
    }

    if (act === "archive") {
      state.archiveId = id;
      $("rqArchiveText").textContent =
        "سيخرج «" + (record.mosqueName || "الطلب") + "» من المصفوفة ويبقى في الأرشيف.";
      $("rqArchiveNote").value = "";
      $("rqArchiveModal").classList.remove("hidden");
      $("rqArchiveNote").focus();
      return;
    }

    if (act === "unarchive") {
      trackSync(RequestsStore.unarchive(id));
      renderAll();
      return toast("أُعيد الطلب", "ok");
    }

    if (act === "delete") {
      state.deleteId = id;
      $("rqDeleteText").textContent =
        "سيُحذف «" +
        (record.mosqueName || "الطلب") +
        "» نهائياً من كل الأجهزة. لا يمكن التراجع.";
      $("rqDeleteModal").classList.remove("hidden");
      return;
    }

  }


  // ------------------------------------------------------- الدفع السريع

  function focusPayInput() {
    const input = document.querySelector(".rq-card.is-paying .rq-pay-input");
    if (input) {
      input.focus();
      input.select();
    }
  }

  function confirmPayment(id) {
    const card = document.querySelector('.rq-card.is-paying[data-id="' + id + '"]');
    const input = card && card.querySelector(".rq-pay-input");
    if (!input) return;

    const raw = String(input.value || "").trim();
    const amount = Number(raw);

    if (raw === "" || !isFinite(amount) || amount <= 0) {
      toast("أدخل مبلغاً صحيحاً أكبر من صفر.", "error");
      input.focus();
      return;
    }
    if (amount > 100000000) {
      toast("المبلغ أكبر من المسموح.", "error");
      input.focus();
      return;
    }

    // المبلغ والدفع في كتابة واحدة — لا حالة وسيطة تُرسل للخادم مرتين
    trackSync(
      RequestsStore.patch(id, { amount: Math.round(amount * 1000) / 1000, paid: true }),
    );
    state.payingId = null;
    renderAll();
    toast(completionToast(id, "سُجّل الدفع"), "ok");
  }

  // ---------------------------------------------------------------- التصدير

  function download(blob, name) {
    const now = new Date();
    const stamp =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name + " " + stamp + ".xlsx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("نُزّل الملف.", "ok");
  }

  // السجل يُصدَّر بمولّد المساجد المنتهية نفسه (ورقة لكل شهر)، والمتابعة
  // بمولّد الحالات. نفس الملفين اللذين كان ينتجهما الموقع قبل الدمج.
  function exportLedger() {
    const rows = ledgerRows();
    if (!rows.length) return toast("لا توجد سجلات لتصديرها.", "error");

    try {
      const blob = window.XlsxExport.build(
        rows.map((r) => ({
          mosqueName: r.mosqueName,
          requestNo: r.mosqueRequestNo,
          completionDate: r.completedAt,
          governorate: r.governorate,
          agentPhone: ((r.agents && r.agents[0]) || {}).phone || "",
          price: r.amount,
          notes: r.notes,
        })),
      );
      download(blob, "المساجد المنتهية");
    } catch (err) {
      toast("تعذّر إنشاء الملف: " + (err && err.message ? err.message : "خطأ غير متوقع"), "error");
    }
  }

  function exportXlsx() {
    if (!window.XlsxExport) return toast("مولّد Excel غير محمّل.", "error");
    if (state.view === "ledger") return exportLedger();

    const { visible, groups } = visibleGroups();
    if (!visible.length && !groups.archived.length) {
      return toast("لا توجد طلبات لتصديرها.", "error");
    }

    try {
      const blob = window.XlsxExport.buildRequests(groups);
      download(blob, "متابعة الطلبات");
    } catch (err) {
      toast("تعذّر إنشاء الملف: " + (err && err.message ? err.message : "خطأ غير متوقع"), "error");
    }
  }

  // ---------------------------------------------------------------- الأحداث

  function wire() {
    $("rqOpenForm").addEventListener("click", () => openDrawer(null));
    $("rqEmptyAdd").addEventListener("click", () => openDrawer(null));
    $("rqDrawerClose").addEventListener("click", closeDrawer);
    $("rqCancel").addEventListener("click", closeDrawer);
    $("rqDrawerScrim").addEventListener("click", closeDrawer);
    $("rqSave").addEventListener("click", saveForm);
    $("rqExport").addEventListener("click", exportXlsx);

    $("rqFromQibla").addEventListener("change", (e) => applyQiblaSelection(e.target.value));

    $("rqViewBoard").addEventListener("click", () => setView("board"));
    $("rqViewLedger").addEventListener("click", () => setView("ledger"));
    $("rqPaid").addEventListener("change", syncCompletedField);
    $("rqVisited").addEventListener("change", syncCompletedField);
    $("rqImportBtn").addEventListener("click", runImport);
    $("rqAnalytics").addEventListener("toggle", () => {
      if ($("rqAnalytics").open) renderLedger();
    });

    $("rqMore").addEventListener("click", () => {
      state.limit += 25;
      renderLedger();
    });

    $("rqFilterYear").addEventListener("change", (e) => {
      state.filters.year = e.target.value;
      renderAll();
    });

    $("rqFilterMonth").addEventListener("change", (e) => {
      state.filters.month = e.target.value;
      renderAll();
    });

    // ترتيب الجدول: نفس العمود يعكس الاتجاه، وعمود جديد يبدأ تنازلياً
    $("rqTable").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-sort]");
      if (!th) return;
      const key = th.getAttribute("data-sort");
      if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      else state.sort = { key, dir: "desc" };
      renderLedger();
    });

    $("rqTableBody").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-ledger]");
      if (!btn) return;
      const record = RequestsStore.getById(btn.dataset.id);
      if (!record) return;

      if (btn.dataset.ledger === "edit") return openDrawer(record);

      // الإعادة للمتابعة تنقض الدفع فقط: الزيارة وقعت فعلاً ولا يصح نقضها
      trackSync(RequestsStore.setPaid(record.id, false));
      renderAll();
      toast("أُعيد إلى مستحق التحصيل", "ok");
    });


    // تفويض واحد لكل البطاقات — لا مستمع لكل زر
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".rq-card [data-act]");
      if (!btn) return;
      onCardAction(btn.closest(".rq-card").dataset.id, btn.dataset.act);
    });

    let searchTimer = null;
    $("rqSearch").addEventListener("input", (e) => {
      const v = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.filters.search = v;
        renderAll();
      }, 180);
    });

    $("rqFilterGov").addEventListener("change", (e) => {
      state.filters.governorate = e.target.value;
      renderAll();
    });

    $("rqFilterReady").addEventListener("change", (e) => {
      const v = e.target.value;
      state.filters.ready = v === "yes" ? true : v === "no" ? false : null;
      renderAll();
    });

    $("rqReset").addEventListener("click", () => {
      state.filters = { search: "", governorate: "", ready: null, year: "", month: "" };
      $("rqSearch").value = "";
      $("rqFilterGov").value = "";
      $("rqFilterReady").value = "";
      $("rqFilterYear").value = "";
      $("rqFilterMonth").value = "";
      renderAll();
    });

    $("rqArchiveCancel").addEventListener("click", () => {
      $("rqArchiveModal").classList.add("hidden");
      state.archiveId = null;
    });

    $("rqArchiveOk").addEventListener("click", () => {
      if (state.archiveId) {
        trackSync(RequestsStore.archive(state.archiveId, $("rqArchiveNote").value));
        toast("أُرشف الطلب", "ok");
      }
      $("rqArchiveModal").classList.add("hidden");
      state.archiveId = null;
      renderAll();
    });

    $("rqDeleteCancel").addEventListener("click", () => {
      $("rqDeleteModal").classList.add("hidden");
      state.deleteId = null;
    });

    $("rqDeleteOk").addEventListener("click", () => {
      if (state.deleteId) {
        const out = RequestsStore.remove(state.deleteId);
        if (out && out.promise) out.promise.catch(() => {});
        toast("حُذف الطلب", "ok");
      }
      $("rqDeleteModal").classList.add("hidden");
      state.deleteId = null;
      renderAll();
    });

    // Enter داخل حقل المبلغ يؤكد — لا حاجة لملاحقة زر صغير على الهاتف
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const input = e.target.closest && e.target.closest(".rq-pay-input");
      if (!input) return;
      e.preventDefault();
      confirmPayment(input.closest(".rq-card").dataset.id);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (state.payingId) {
        state.payingId = null;
        return renderAll();
      }
      if (!$("rqDeleteModal").classList.contains("hidden")) return $("rqDeleteCancel").click();
      if (!$("rqArchiveModal").classList.contains("hidden")) return $("rqArchiveCancel").click();
      if (!$("rqDrawer").classList.contains("hidden")) closeDrawer();
    });

    window.addEventListener("online", () => {
      RequestsStore.refresh().then(renderAll);
    });
  }

  // ---------------------------------------------------------------- الإقلاع

  async function init() {
    if (!window.RequestsStore) return;
    wire();

    // #ledger في الرابط يفتح السجل مباشرة — يخدم الروابط القديمة لصفحة
    // المساجد المنتهية بعد إعادة توجيهها
    setView(location.hash === "#ledger" ? "ledger" : "board");

    setConn("", "جاري الاتصال…");
    const out = await RequestsStore.refresh();
    if (out.ok) {
      const pending = RequestsStore.pendingRecords().length;
      setConn(pending ? "wait" : "ok", pending ? pending + " بانتظار الإرسال" : "متصل");
    } else {
      setConn("off", "غير متصل — البيانات محلية");
    }
    renderAll();
    checkLegacy();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
