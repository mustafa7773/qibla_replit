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

  const BUCKETS = ["fresh", "toVisit", "toCollect", "done"];
  const RECENT_QIBLA_LIMIT = 40;

  const state = {
    filters: { search: "", governorate: "", ready: null },
    editingId: null,
    payingId: null,
    archiveId: null,
    deleteId: null,
    agents: [],
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
        (bucket === "done"
          ? '<button type="button" class="link-btn is-gold" data-act="complete">نقل للمنتهية</button>'
          : "") +
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

  function renderAll() {
    const { all, visible, groups } = visibleGroups();

    fillGovernorateSelects(all);
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

  // ---------------------------------------------------------------- الوكلاء

  function agentRowHtml(a, i) {
    return (
      '<div class="rq-agent-row" data-index="' +
      i +
      '">' +
      '<input type="text" class="rq-agent-name" placeholder="الاسم" value="' +
      esc(a.name) +
      '" aria-label="اسم الوكيل" />' +
      '<input type="tel" class="rq-agent-phone textarea-mono" inputmode="tel" placeholder="الهاتف" value="' +
      esc(a.phone) +
      '" aria-label="هاتف الوكيل" />' +
      '<button type="button" class="icon-btn" data-act="drop-agent" aria-label="حذف الوكيل">' +
      '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      "</button></div>"
    );
  }

  function renderAgents() {
    const box = $("rqAgents");
    if (box) box.innerHTML = state.agents.map(agentRowHtml).join("");
  }

  function collectAgents() {
    return Array.from(document.querySelectorAll("#rqAgents .rq-agent-row")).map((row) => ({
      name: row.querySelector(".rq-agent-name").value,
      phone: row.querySelector(".rq-agent-phone").value,
    }));
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
    if (m.companyRequestNo) $("rqCompanyNo").value = String(m.companyRequestNo).trim();
    if (m.village) $("rqVillage").value = String(m.village).trim();

    // حقل المحافظة في أداة القبلة يحمل "المحافظة - الولاية" معاً
    const raw = String(m.governorate || "");
    if (raw) {
      const gov = window.Governorates ? window.Governorates.governorateOf(raw) || raw : raw;
      fillGovernorateSelects(RequestsStore.loadAll());
      $("rqGov").value = gov;
      if (raw.includes("-")) $("rqWilaya").value = raw.split("-").pop().trim();
    }

    if (m.agentPhone) {
      state.agents = [{ name: "", phone: String(m.agentPhone).trim() }];
      renderAgents();
    }

    // المسجد محفوظ في أداة القبلة، أي أن زيارته تمّت فعلاً
    $("rqVisited").checked = true;
    $("rqReady").checked = true;
  }

  // ---------------------------------------------------------------- الدرج

  function openDrawer(record) {
    state.editingId = record ? record.id : null;
    state.agents =
      record && record.agents.length ? record.agents.slice() : [{ name: "", phone: "" }];

    $("rqDrawerTitle").textContent = record ? "تعديل الطلب" : "طلب جديد";
    $("rqSave").textContent = record ? "حفظ التعديل" : "حفظ الطلب";

    $("rqName").value = record ? record.mosqueName : "";
    $("rqMosqueNo").value = record ? record.mosqueRequestNo : "";
    $("rqCompanyNo").value = record ? record.companyRequestNo : "";
    $("rqWilaya").value = record ? record.wilaya : "";
    $("rqVillage").value = record ? record.village : "";
    $("rqAmount").value = record && record.amount ? record.amount : "";
    $("rqNotes").value = record ? record.notes : "";
    $("rqReady").checked = !!(record && record.ready);
    $("rqPaid").checked = !!(record && record.paid);
    $("rqVisited").checked = !!(record && record.visited);

    fillGovernorateSelects(RequestsStore.loadAll());
    $("rqGov").value = record ? record.governorate : "";

    // المنتقي للإضافة فقط — عند التعديل الطلب مرتبط أصلاً
    if (record) $("rqFromQiblaBlock").classList.add("hidden");
    else {
      $("rqFromQibla").value = "";
      fillQiblaPicker();
    }

    renderAgents();
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
      companyRequestNo: $("rqCompanyNo").value,
      governorate: $("rqGov").value,
      wilaya: $("rqWilaya").value,
      village: $("rqVillage").value,
      amount: $("rqAmount").value,
      agents: collectAgents(),
      ready: $("rqReady").checked,
      paid: $("rqPaid").checked,
      visited: $("rqVisited").checked,
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
      return toast(record.paid ? "أُزيلت علامة الدفع" : "سُجّل الدفع", "ok");
    }

    if (act === "pay-cancel") {
      state.payingId = null;
      return renderAll();
    }

    if (act === "pay-ok") return confirmPayment(id);

    if (act === "visited") {
      trackSync(RequestsStore.setVisited(id, !record.visited));
      renderAll();
      return toast(record.visited ? "أُزيلت علامة الزيارة" : "سُجّلت الزيارة", "ok");
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

    if (act === "complete") return sendToCompleted(record);
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
    toast("سُجّل الدفع", "ok");
  }

  // نقل المكتمل إلى أداة المساجد المنتهية ثم أرشفته هنا — إدخال واحد لا اثنان
  function sendToCompleted(record) {
    if (!window.CompletedStore) return toast("أداة المساجد المنتهية غير محمّلة", "error");

    const input = RequestsStore.toCompletedInput(record);
    const errors = window.CompletedStore.validate(input);
    if (errors.length) {
      toast(errors[0], "error");
      return openDrawer(record);
    }

    const added = window.CompletedStore.add(input);
    if (!added.ok) return toast(added.errors[0] || "تعذّر النقل", "error");
    if (added.promise) added.promise.catch(() => {});

    trackSync(RequestsStore.archive(record.id, "نُقل إلى المساجد المنتهية"));
    renderAll();
    toast("نُقل إلى المساجد المنتهية", "ok");
  }

  // ---------------------------------------------------------------- التصدير

  function exportXlsx() {
    if (!window.XlsxExport || typeof window.XlsxExport.buildRequests !== "function") {
      return toast("مولّد Excel غير محمّل.", "error");
    }

    const { visible, groups } = visibleGroups();
    if (!visible.length && !groups.archived.length) {
      return toast("لا توجد طلبات لتصديرها.", "error");
    }

    try {
      const blob = window.XlsxExport.buildRequests(groups);
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
      a.download = "متابعة الطلبات " + stamp + ".xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("نُزّل الملف.", "ok");
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

    $("rqAddAgent").addEventListener("click", () => {
      state.agents = collectAgents();
      state.agents.push({ name: "", phone: "" });
      renderAgents();
    });

    $("rqAgents").addEventListener("click", (e) => {
      const btn = e.target.closest('[data-act="drop-agent"]');
      if (!btn) return;
      const idx = Number(btn.closest(".rq-agent-row").dataset.index);
      state.agents = collectAgents().filter((_, i) => i !== idx);
      if (!state.agents.length) state.agents = [{ name: "", phone: "" }];
      renderAgents();
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
      state.filters = { search: "", governorate: "", ready: null };
      $("rqSearch").value = "";
      $("rqFilterGov").value = "";
      $("rqFilterReady").value = "";
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

    // الذاكرة المؤقتة تُعرض فوراً — لا شاشة فارغة بانتظار الخادم
    renderAll();

    setConn("", "جاري الاتصال…");
    const out = await RequestsStore.refresh();
    if (out.ok) {
      const pending = RequestsStore.pendingRecords().length;
      setConn(pending ? "wait" : "ok", pending ? pending + " بانتظار الإرسال" : "متصل");
    } else {
      setConn("off", "غير متصل — البيانات محلية");
    }
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
