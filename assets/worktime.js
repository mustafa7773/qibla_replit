// ============================================================================
// أداة حساب وقت العمل
//
// المطلوب: الانطلاق من جامع المهيمن (السيب)، زيارة كل المساجد المُدخلة، والعودة.
// الوقت = زمن الذهاب + مدة العمل داخل كل مسجد + زمن التنقل بينها + زمن العودة.
// عند وجود أكثر من مسجد يُحسب أقصر مسار يمر بها جميعاً.
//
// حساب المسار يتم عبر خدمة OSRM المفتوحة (بلا مفتاح ولا تسجيل)، وتحديداً
// خدمة trip التي تحل مسألة "البائع المتجول" فتُعيد الترتيب الأمثل للمحطات
// مع أزمنة التنقل على الطرق الحقيقية.
// عند تعذّر الوصول للخدمة يُستخدم تقدير احتياطي بمسافة الخط المستقيم.
// ============================================================================

(function () {
  "use strict";

  // اسم نقطة الانطلاق الافتراضية (يظهر في خطة اليوم)
  const ORIGIN_NAME = "جامع المهيمن";

  // الاستراحات الاختيارية: تُضاف بعد محطة يختارها المستخدم، بمدة ثابتة لكل نوع
  const BREAKS = {
    prayer: { name: "وقت الصلاة", minutes: 20, icon: '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c2.5 2 4 3.6 4 5.5A4 4 0 018 8.5C8 6.6 9.5 5 12 3z"/><path d="M4 21v-6a2 2 0 012-2h12a2 2 0 012 2v6"/><path d="M4 21h16"/></svg>' },
    dinner: { name: "وقت العشاء", minutes: 30, icon: '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v8a2 2 0 004 0V3M8 11v10"/><path d="M16 3c-1.5 1.5-2 3-2 5s.7 3 2 3v10"/></svg>' },
  };

  const OSRM_BASE = "https://router.project-osrm.org/trip/v1/driving/";

  // معامل تقريبي لتحويل مسافة الخط المستقيم إلى مسافة طريق فعلية،
  // ومتوسط سرعة للتقدير الاحتياطي فقط عند تعذّر الوصول لخدمة المسارات.
  const FALLBACK_ROAD_FACTOR = 1.35;
  const FALLBACK_SPEED_KMH = 70;

  let mapInstance = null;
  let routeLayerGroup = null;
  let lastRoute = null;

  // ---------- أدوات مساعدة ----------

  function el(id) {
    return document.getElementById(id);
  }

  // ------------------------------------------------------------ تأكيد الحذف
  //
  // بديل confirm() الأصلي، الذي يُجمّد الصفحة، ويظهر بخط النظام لا بهوية
  // الموقع، ويجعل زر التدمير مطابقاً لزر الإلغاء تماماً.
  // هنا: زر أحمر واضح، وEsc للإلغاء، والتركيز يبدأ على "إلغاء" لا على الحذف.
  let pendingConfirm = null;

  function askConfirm(message, okLabel, onConfirm) {
    const box = el("wtConfirm");
    if (!box) {
      // احتياط: إن غاب الحوار لأي سبب لا نحذف بصمت
      if (window.confirm(message)) onConfirm();
      return;
    }
    pendingConfirm = onConfirm;
    el("wtConfirmText").textContent = message;
    el("wtConfirmOk").textContent = okLabel || "حذف";
    box.classList.remove("hidden");
    el("wtConfirmCancel").focus();
  }

  function closeConfirm() {
    pendingConfirm = null;
    const box = el("wtConfirm");
    if (box) box.classList.add("hidden");
  }

  document.addEventListener("DOMContentLoaded", function () {
    const box = el("wtConfirm");
    if (!box) return;

    el("wtConfirmCancel").addEventListener("click", closeConfirm);
    el("wtConfirmOk").addEventListener("click", function () {
      const fn = pendingConfirm;
      closeConfirm();
      if (fn) fn();
    });
    // النقر خارج الصندوق يُلغي، كما هو متوقّع في أي حوار
    box.addEventListener("click", function (e) {
      if (e.target === box) closeConfirm();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !box.classList.contains("hidden")) closeConfirm();
    });
  });

  function showError(message) {
    const box = el("errorBox");
    box.textContent = message;
    box.style.display = "block";
  }

  function clearError() {
    const box = el("errorBox");
    box.textContent = "";
    box.style.display = "none";
  }

  // صياغة عربية صحيحة للمفرد والمثنى والجمع
  function arabicUnit(count, single, dual, plural, many) {
    if (count === 1) return single;
    if (count === 2) return dual;
    if (count >= 3 && count <= 10) return count + " " + plural;
    return count + " " + many;
  }

  function formatDuration(totalMinutes) {
    const mins = Math.round(totalMinutes);
    const h = Math.floor(mins / 60);
    const m = mins % 60;

    const hourText = arabicUnit(h, "ساعة واحدة", "ساعتان", "ساعات", "ساعة");
    const minText = arabicUnit(m, "دقيقة واحدة", "دقيقتان", "دقائق", "دقيقة");

    if (h === 0) return minText;
    if (m === 0) return hourText;
    return hourText + " و" + minText;
  }

  // صيغة مختصرة للبطاقات كي لا يلتف النص على عدة أسطر
  function formatDurationShort(totalMinutes) {
    const mins = Math.round(totalMinutes);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return m + " د";
    if (m === 0) return h + " س";
    return h + " س " + m + " د";
  }

  function formatClock(dateObj) {
    return dateObj.toLocaleTimeString("ar-OM", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ---------- قراءة المدخلات ----------

  function parseMosques() {
    const raw = el("mosquesInput").value.trim();
    if (!raw) throw new Error("أدخل موقع مسجد واحد على الأقل.");

    const datum = el("datum").value;
    const zone = parseInt(el("zone").value, 10);

    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    const mosques = [];

    lines.forEach((line, idx) => {
      // الحقول مفصولة بفاصلة (عربية أو إنجليزية) أو فاصلة منقوطة أو Tab.
      // آخر حقلين هما Easting ثم Northing، وما قبلهما هو الاسم — بهذا الترتيب
      // يبقى الاسم سليماً حتى لو احتوى أرقاماً مثل "ص-24-103".
      let parts = line.split(/[,،;\t]+/).map((p) => p.trim()).filter(Boolean);

      // سطر بلا فواصل: نقبل الفصل بالمسافات (إحداثيتان فقط)
      if (parts.length < 2) {
        parts = line.split(/\s+/).map((p) => p.trim()).filter(Boolean);
      }

      if (parts.length < 2) {
        throw new Error(
          "السطر رقم " + (idx + 1) + " لا يحتوي على إحداثيتين صالحتين (Easting و Northing).",
        );
      }

      const northing = parseFloat(parts[parts.length - 1].replace(/[^\d.\-]/g, ""));
      const easting = parseFloat(parts[parts.length - 2].replace(/[^\d.\-]/g, ""));

      if (!isFinite(easting) || !isFinite(northing)) {
        throw new Error(
          "السطر رقم " + (idx + 1) + " لا يحتوي على إحداثيتين صالحتين (Easting و Northing).",
        );
      }

      const name = parts.slice(0, -2).join(", ").trim() || "مسجد " + (idx + 1);

      const wgs = convertToWGS84(easting, northing, zone, datum);
      if (!isFinite(wgs.lat) || !isFinite(wgs.lon)) {
        throw new Error("تعذّر تحويل إحداثيات السطر رقم " + (idx + 1) + ".");
      }

      mosques.push({ name, easting, northing, lat: wgs.lat, lon: wgs.lon });
    });

    return mosques;
  }

  function parseOrigin() {
    const lat = parseFloat(el("originLat").value);
    const lon = parseFloat(el("originLon").value);
    if (!isFinite(lat) || !isFinite(lon)) {
      throw new Error("إحداثيات نقطة الانطلاق غير صالحة.");
    }
    return { name: ORIGIN_NAME, lat, lon, isBase: true };
  }

  // ---------- حساب المسار ----------

  // يطلب من OSRM أقصر مسار يمر بكل النقاط بدءاً من نقطة الانطلاق وعودةً إليها
  async function solveRouteViaOsrm(stops) {
    const coords = stops.map((s) => s.lon + "," + s.lat).join(";");
    const url =
      OSRM_BASE +
      coords +
      "?source=first&roundtrip=true&geometries=geojson&overview=full";

    const res = await fetch(url);
    if (!res.ok) throw new Error("خدمة المسارات ردّت بحالة " + res.status);

    const data = await res.json();
    if (data.code !== "Ok" || !data.trips || !data.trips.length) {
      throw new Error("تعذّر إيجاد مسار بين المواقع المُدخلة.");
    }

    const trip = data.trips[0];

    // ترتيب المحطات حسب الترتيب الأمثل الذي أعادته الخدمة
    const ordered = stops
      .map((stop, i) => ({ stop, order: data.waypoints[i].waypoint_index }))
      .sort((a, b) => a.order - b.order)
      .map((x) => x.stop);

    // legs[i] = الانتقال من المحطة i إلى المحطة i+1 (وآخر ساق هي العودة للانطلاق)
    const legs = trip.legs.map((leg) => ({
      minutes: leg.duration / 60,
      km: leg.distance / 1000,
    }));

    return {
      ordered,
      legs,
      geometry: trip.geometry ? trip.geometry.coordinates : null,
      source: "osrm",
    };
  }

  // تقدير احتياطي: ترتيب بالجار الأقرب + مسافة خط مستقيم معدَّلة
  function solveRouteFallback(stops) {
    const origin = stops[0];
    const remaining = stops.slice(1);
    const ordered = [origin];

    let current = origin;
    while (remaining.length) {
      let bestIdx = 0;
      let bestKm = Infinity;
      remaining.forEach((cand, i) => {
        const km = haversineKm(current.lat, current.lon, cand.lat, cand.lon);
        if (km < bestKm) {
          bestKm = km;
          bestIdx = i;
        }
      });
      current = remaining.splice(bestIdx, 1)[0];
      ordered.push(current);
    }

    const legs = [];
    for (let i = 0; i < ordered.length; i++) {
      const from = ordered[i];
      const to = ordered[(i + 1) % ordered.length];
      const km = haversineKm(from.lat, from.lon, to.lat, to.lon) * FALLBACK_ROAD_FACTOR;
      legs.push({ km, minutes: (km / FALLBACK_SPEED_KMH) * 60 });
    }

    return { ordered, legs, geometry: null, source: "fallback" };
  }

  // ---------- بناء الجدول الزمني ----------

  function buildSchedule(route, stopMinutes, startTime, breaks) {
    const [sh, sm] = startTime.split(":").map((v) => parseInt(v, 10));
    const clock = new Date();
    clock.setHours(isFinite(sh) ? sh : 8, isFinite(sm) ? sm : 0, 0, 0);

    const chosen = breaks || {};
    const schedule = [];
    let drivingMinutes = 0;
    let breakMinutes = 0;

    // يضيف استراحة (صلاة أو عشاء) بعد المحطة المحددة
    function pushBreak(kind) {
      const def = BREAKS[kind];
      const start = new Date(clock);
      clock.setMinutes(clock.getMinutes() + def.minutes);
      breakMinutes += def.minutes;
      schedule.push({
        isBreak: true,
        kind,
        name: def.name,
        icon: def.icon,
        arrival: start,
        departure: new Date(clock),
        workMinutes: def.minutes,
      });
    }

    // الانطلاق
    schedule.push({
      name: route.ordered[0].name,
      isBase: true,
      departure: new Date(clock),
      label: "الانطلاق",
    });

    // استراحة قبل أول مسجد (المحطة المختارة = "start")
    Object.keys(BREAKS).forEach((kind) => {
      if (chosen[kind] === "start") pushBreak(kind);
    });

    for (let i = 1; i < route.ordered.length; i++) {
      const leg = route.legs[i - 1];
      drivingMinutes += leg.minutes;

      clock.setMinutes(clock.getMinutes() + leg.minutes);
      const arrival = new Date(clock);

      clock.setMinutes(clock.getMinutes() + stopMinutes);
      const departure = new Date(clock);

      schedule.push({
        name: route.ordered[i].name,
        isBase: false,
        order: i,
        arrival,
        departure,
        workMinutes: stopMinutes,
        legMinutes: leg.minutes,
        legKm: leg.km,
        label: "مسجد",
      });

      // استراحة بعد هذا المسجد إن اختيرت له
      Object.keys(BREAKS).forEach((kind) => {
        if (chosen[kind] === String(i)) pushBreak(kind);
      });
    }

    // العودة لنقطة الانطلاق
    const lastLeg = route.legs[route.legs.length - 1];
    drivingMinutes += lastLeg.minutes;
    clock.setMinutes(clock.getMinutes() + lastLeg.minutes);

    schedule.push({
      name: route.ordered[0].name,
      isBase: true,
      arrival: new Date(clock),
      legMinutes: lastLeg.minutes,
      legKm: lastLeg.km,
      label: "العودة",
    });

    const totalKm = route.legs.reduce((sum, l) => sum + l.km, 0);
    const mosqueCount = route.ordered.length - 1;
    const workMinutes = mosqueCount * stopMinutes;

    return {
      schedule,
      drivingMinutes,
      workMinutes,
      breakMinutes,
      totalMinutes: drivingMinutes + workMinutes + breakMinutes,
      totalKm,
      mosqueCount,
    };
  }

  // ---------- عرض النتيجة ----------

  function renderSummary(result) {
    // جملة تلخيصية واضحة أعلى البطاقات
    const endTime = result.schedule[result.schedule.length - 1].arrival;
    // كانت الساعة مكتوبة نصاً ثابتاً فتناقض حقل "بداية الدوام" إن غيّره المستخدم
    const startLabel = formatClock(result.schedule[0].departure);
    el("summaryHeadline").innerHTML =
      "تبدأ " + startLabel + " وتزور <b>" +
      arabicUnit(result.mosqueCount, "مسجداً واحداً", "مسجدين", "مساجد", "مسجداً") +
      "</b>، وتعود إلى " + ORIGIN_NAME + " الساعة <b>" +
      formatClock(endTime) +
      "</b> — أي <b>" +
      formatDuration(result.totalMinutes) +
      "</b> من وقت العمل.";

    const cards = [
      card("عدد المساجد", String(result.mosqueCount), "في المسار"),
      card("زمن التنقل", formatDurationShort(result.drivingMinutes), "في الطريق"),
      card("العمل بالمواقع", formatDurationShort(result.workMinutes), "داخل المساجد"),
    ];

    if (result.breakMinutes > 0) {
      cards.push(card("الاستراحات", formatDurationShort(result.breakMinutes), "صلاة وعشاء"));
    }

    cards.push(
      card("إجمالي اليوم", formatDurationShort(result.totalMinutes), "من الخروج للعودة"),
      card("مسافة المسار", result.totalKm.toFixed(0) + " كم", "ذهاباً وإياباً"),
    );

    el("summaryGrid").innerHTML = cards.join("");

    function card(label, value, note) {
      return (
        '<div class="summary-card"><span class="label">' +
        label +
        '</span><span class="value">' +
        value +
        "</span>" +
        (note ? '<span class="note">' + note + "</span>" : "") +
        "</div>"
      );
    }
  }

  function renderTimeline(result) {
    const rows = [];

    result.schedule.forEach((stop, i) => {
      // ساق التنقل تُعرض بين المحطتين لتكون العلاقة واضحة
      if (stop.legMinutes != null) {
        rows.push(
          '<li class="leg"><span class="leg-icon"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17h14M6.5 17V9.5L8 6h8l1.5 3.5V17"/><circle cx="8" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/></svg></span>' +
            '<span class="leg-text">تنقّل</span>' +
            '<span class="leg-chip">' + formatDuration(stop.legMinutes) + "</span>" +
            '<span class="leg-chip is-dist">' + stop.legKm.toFixed(1) + " كم</span></li>",
        );
      }

      // استراحة (صلاة / عشاء) — صف خاص بلا رقم محطة
      if (stop.isBreak) {
        rows.push(
          '<li class="stop is-break"><div class="stop-rail"><span class="stop-dot">' +
            stop.icon +
            '</span></div><div class="stop-body"><p class="stop-name">' +
            escapeHtml(stop.name) +
            '<span class="stop-tag is-break-tag">استراحة</span></p>' +
            '<p class="stop-meta">من <span class="clock">' +
            formatClock(stop.arrival) +
            '</span> إلى <span class="clock">' +
            formatClock(stop.departure) +
            "</span> · " +
            formatDuration(stop.workMinutes) +
            "</p></div></li>",
        );
        return;
      }

      const isBase = stop.isBase;
      const dotLabel = isBase ? "⌂" : String(stop.order);

      // الاسم قد يجمع رقم الطلب والقرية والولاية مفصولة بـ " — "،
      // نعرض الجزء الأول كعنوان والباقي كسطر فرعي أوضح للقراءة
      const segments = String(stop.name).split(" — ");
      const title = segments[0];
      const subtitle = segments.slice(1).join(" · ");

      let tag = "";
      let meta = "";

      if (stop.label === "الانطلاق") {
        tag = '<span class="stop-tag is-start">الانطلاق</span>';
        meta = 'تخرج الساعة <span class="clock">' + formatClock(stop.departure) + "</span>";
      } else if (stop.label === "العودة") {
        tag = '<span class="stop-tag is-end">نهاية اليوم</span>';
        meta = 'تصل الساعة <span class="clock">' + formatClock(stop.arrival) + "</span>";
      } else {
        // نفس تسمية القائمة المنسدلة، ليطابق ما اخترته للاستراحة
        tag =
          '<span class="stop-tag is-site">موقع العمل ' +
          ordinalLabel(stop.order) +
          "</span>";
        meta =
          'وصول <span class="clock">' +
          formatClock(stop.arrival) +
          '</span> ← عمل ' +
          formatDuration(stop.workMinutes) +
          ' ← مغادرة <span class="clock">' +
          formatClock(stop.departure) +
          "</span>";
      }

      rows.push(
        '<li class="stop' +
          (isBase ? " is-base" : "") +
          '"><div class="stop-rail"><span class="stop-dot">' +
          dotLabel +
          '</span></div><div class="stop-body"><p class="stop-name">' +
          escapeHtml(title) +
          tag +
          "</p>" +
          (subtitle ? '<p class="stop-sub">' + escapeHtml(subtitle) + "</p>" : "") +
          '<p class="stop-meta">' +
          meta +
          "</p></div></li>",
      );
    });

    el("timeline").innerHTML = '<ul class="timeline-list">' + rows.join("") + "</ul>";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderMap(route) {
    if (typeof L === "undefined") {
      throw new Error("مكتبة الخرائط غير متاحة");
    }
    if (!mapInstance) {
      mapInstance = L.map("map");
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(mapInstance);
      routeLayerGroup = L.layerGroup().addTo(mapInstance);
    }

    routeLayerGroup.clearLayers();

    const points = [];
    route.ordered.forEach((stop, i) => {
      points.push([stop.lat, stop.lon]);
      L.marker([stop.lat, stop.lon])
        .bindPopup((i === 0 ? "الانطلاق: " : i + ". ") + stop.name)
        .addTo(routeLayerGroup);
    });

    if (route.geometry) {
      const line = route.geometry.map((c) => [c[1], c[0]]);
      L.polyline(line, { color: "#dfb668", weight: 4, opacity: 0.9 }).addTo(routeLayerGroup);
      mapInstance.fitBounds(L.latLngBounds(line).pad(0.15));
    } else {
      const loop = points.concat([points[0]]);
      L.polyline(loop, {
        color: "#dfb668",
        weight: 3,
        opacity: 0.8,
        dashArray: "6,8",
      }).addTo(routeLayerGroup);
      mapInstance.fitBounds(L.latLngBounds(loop).pad(0.15));
    }

    setTimeout(() => mapInstance.invalidateSize(), 200);
  }

  function buildGoogleMapsUrl(route) {
    const origin = route.ordered[0];
    const stops = route.ordered.slice(1);
    const base = "https://www.google.com/maps/dir/?api=1&travelmode=driving";
    const originParam = "&origin=" + origin.lat + "," + origin.lon;
    const destParam = "&destination=" + origin.lat + "," + origin.lon;
    const waypoints = stops.map((s) => s.lat + "," + s.lon).join("|");
    return (
      base + originParam + destParam + (waypoints ? "&waypoints=" + encodeURIComponent(waypoints) : "")
    );
  }

  // ---------- المساجد المحفوظة من أداة القبلة ----------

  function renderSavedMosques() {
    const store = window.MosqueStore;
    const block = el("savedBlock");
    const empty = el("savedEmpty");
    const list = el("savedList");

    const saved = store ? store.loadAll() : [];

    if (!saved.length) {
      block.classList.add("hidden");
      empty.classList.remove("hidden");
      return;
    }

    block.classList.remove("hidden");
    empty.classList.add("hidden");

    list.innerHTML = saved
      .map((m) => {
        const segments = String(m.name).split(" — ");
        const title = segments[0];

        // بقية أجزاء الاسم (الولاية والتاريخ) تُعرض كسطر فرعي،
        // مع تفادي تكرار أي جزء يطابق العنوان نفسه
        const subParts = segments
          .slice(1)
          .filter((seg) => seg && seg !== title);
        if (!subParts.length && m.governorate && m.governorate !== title) {
          subParts.push(m.governorate);
        }
        const dateStr = window.MosqueStore.formatShortDate(m.savedAt);
        if (dateStr && subParts.indexOf(dateStr) === -1) subParts.push(dateStr);

        const hasGov = !!(m.governorate || segments.length > 2);
        if (!hasGov) subParts.push("بلا ولاية — اضغط زر التعديل");
        const subtitle = subParts.join(" · ");

        return (
          '<div class="saved-item" data-id="' +
          m.id +
          '"><label class="saved-pick"><input type="checkbox" value="' +
          m.id +
          '" /><span class="saved-text"><span class="saved-name">' +
          escapeHtml(title) +
          '</span><span class="saved-sub' +
          (hasGov ? "" : " is-missing") +
          '">' +
          escapeHtml(subtitle) +
          '</span></span></label><span class="saved-coords">' +
          m.easting.toFixed(0) +
          " · " +
          m.northing.toFixed(0) +
          '</span><button type="button" class="icon-btn" data-edit="' +
          m.id +
          '" aria-label="تعديل الاسم والولاية" title="تعديل الاسم والولاية"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg></button>' +
          '<button type="button" class="icon-btn danger" data-delete="' +
          m.id +
          '" aria-label="حذف هذا المسجد" title="حذف هذا المسجد"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button></div>'
        );
      })
      .join("");
  }

  // تحويل صف المسجد إلى وضع التحرير لتعديل الاسم والولاية
  function startEditSaved(id) {
    const store = window.MosqueStore;
    if (!store) return;

    const item = store.loadAll().find((m) => m.id === id);
    if (!item) return;

    const row = el("savedList").querySelector('[data-id="' + id + '"]');
    if (!row) return;

    const segments = String(item.name).split(" — ");
    const dateStr = window.MosqueStore.formatShortDate(item.savedAt);
    // نستبعد الولاية والتاريخ من خانة الاسم لأن لكل منهما مكانه الخاص
    const baseName =
      segments.filter(
        (seg) => seg && seg !== item.governorate && seg !== dateStr,
      )[0] || "";

    row.classList.add("is-editing");
    row.innerHTML =
      '<div class="saved-edit">' +
      '<input type="text" class="edit-name" placeholder="اسم المسجد أو رقم الطلب" value="' +
      escapeHtml(baseName) +
      '" />' +
      '<input type="text" class="edit-gov" placeholder="المحافظة والولاية" value="' +
      escapeHtml(item.governorate || "") +
      '" />' +
      '<div class="edit-actions">' +
      '<button type="button" class="primary subtle edit-save">حفظ</button>' +
      '<button type="button" class="link-btn edit-cancel">إلغاء</button>' +
      "</div></div>";

    row.querySelector(".edit-save").addEventListener("click", () => {
      const name = row.querySelector(".edit-name").value.trim();
      const gov = row.querySelector(".edit-gov").value.trim();
      // الاسم الكامل = الاسم — الولاية — التاريخ (ليظهر صحيحاً في خطة اليوم أيضاً)
      const fullName =
        [name, gov, dateStr].filter(Boolean).join(" — ") || item.name;
      store.updateMeta(id, { name: fullName, governorate: gov });
      renderSavedMosques();
    });

    row.querySelector(".edit-cancel").addEventListener("click", renderSavedMosques);
    row.querySelector(".edit-name").focus();
  }

  function addSelectedSaved() {
    const store = window.MosqueStore;
    if (!store) return;

    const chosenIds = Array.from(
      el("savedList").querySelectorAll('input[type="checkbox"]:checked'),
    ).map((cb) => cb.value);

    if (!chosenIds.length) {
      showError("حدّد مسجداً واحداً على الأقل من القائمة المحفوظة.");
      return;
    }

    clearError();
    const saved = store.loadAll();
    const ta = el("mosquesInput");
    const existing = ta.value.trim();
    const lines = [];

    chosenIds.forEach((id) => {
      const m = saved.find((x) => x.id === id);
      if (!m) return;
      // نتجنّب التكرار إن كان المسجد مضافاً بالفعل
      if (existing.indexOf(m.easting.toFixed(2)) !== -1) return;
      lines.push(m.name + ", " + m.easting.toFixed(2) + ", " + m.northing.toFixed(2));

      // مزامنة نظام الإسناد والنطاق مع أول مسجد محفوظ يحملهما
      if (m.zone && m.zone >= 1 && m.zone <= 60) el("zone").value = String(m.zone);
      if (m.datum === "psd93" || m.datum === "wgs84utm") el("datum").value = m.datum;
    });

    if (!lines.length) {
      toast("المساجد المحددة مضافة بالفعل إلى المسار.");
      return;
    }

    ta.value = existing ? existing + "\n" + lines.join("\n") : lines.join("\n");

    el("savedList")
      .querySelectorAll('input[type="checkbox"]:checked')
      .forEach((cb) => (cb.checked = false));

    renderStopsList();
    toast(
      "أُضيفت " + arabicUnit(lines.length, "محطة واحدة", "محطتان", "محطات", "محطة") + " إلى المسار.",
      "ok",
    );
  }

  // ---------- الاستراحات ----------

  // المحطة المختارة لكل استراحة: "" (بدون) أو "start" أو رقم المحطة
  const chosenBreaks = { prayer: "", dinner: "" };
  let lastRouteForBreaks = null;
  let lastResult = null; // آخر خطة محسوبة — تغذّي "نسخ كنص"

  // ترتيب عربي لمواقع العمل: الأول، الثاني، الثالث...
  const ORDINALS = [
    "الأول",
    "الثاني",
    "الثالث",
    "الرابع",
    "الخامس",
    "السادس",
    "السابع",
    "الثامن",
    "التاسع",
    "العاشر",
  ];

  function ordinalLabel(n) {
    return ORDINALS[n - 1] || "رقم " + n;
  }

  // يبني قائمة اختيار المحطة لكل استراحة، اعتماداً على ترتيب المسار الفعلي
  function renderBreakPicker(route) {
    const stops = route.ordered;

    const options = (selected) => {
      let html =
        '<option value=""' + (selected ? "" : " selected") + ">بدون</option>";
      html +=
        '<option value="start"' +
        (selected === "start" ? " selected" : "") +
        ">قبل موقع العمل الأول</option>";
      for (let i = 1; i < stops.length; i++) {
        html +=
          '<option value="' +
          i +
          '"' +
          (selected === String(i) ? " selected" : "") +
          ">بعد موقع العمل " +
          ordinalLabel(i) +
          "</option>";
      }
      return html;
    };

    el("breakPicker").innerHTML = Object.keys(BREAKS)
      .map((kind) => {
        const def = BREAKS[kind];
        const active = !!chosenBreaks[kind];
        return (
          '<div class="break-card' +
          (active ? " is-active" : "") +
          '"><div class="break-card-head"><span class="break-icon">' +
          def.icon +
          '</span><span class="break-name">' +
          def.name +
          '</span><span class="break-dur">' +
          def.minutes +
          ' دقيقة</span></div>' +
          '<label class="break-field" for="break-' +
          kind +
          '">تُضاف</label>' +
          '<select id="break-' +
          kind +
          '" data-break="' +
          kind +
          '">' +
          options(chosenBreaks[kind]) +
          "</select></div>"
        );
      })
      .join("");
  }

  // إعادة بناء الجدول الزمني بعد تغيير الاستراحات — بلا إعادة حساب المسار
  function rebuildSchedule() {
    if (!lastRouteForBreaks) return;
    const stopMinutes = Math.max(0, parseFloat(el("stopMinutes").value) || 0);
    const startTime = el("startTime").value || "08:00";
    const result = buildSchedule(lastRouteForBreaks, stopMinutes, startTime, chosenBreaks);
    lastResult = result;
    renderSummary(result);
    renderTimeline(result);
  }

  // ---------- التشغيل ----------

  async function compute() {
    clearError();
    const btn = el("computeBtn");

    let origin, mosques;
    try {
      origin = parseOrigin();
      mosques = parseMosques();
    } catch (err) {
      showError(err.message);
      return;
    }

    btn.disabled = true;
    const originalLabel = btn.innerHTML;
    btn.textContent = "جاري حساب المسار...";

    try {
      const stops = [origin].concat(mosques);
      let route;
      let noteText = "";

      try {
        route = await solveRouteViaOsrm(stops);
        noteText =
          "الأزمنة والمسافات محسوبة على الطرق الفعلية عبر خدمة OSRM المفتوحة، ولا تشمل الازدحام المروري.";
      } catch (osrmErr) {
        route = solveRouteFallback(stops);
        noteText =
          "تعذّر الوصول لخدمة المسارات، فاستُخدم تقدير تقريبي بمسافة الخط المستقيم بمتوسط سرعة " +
          FALLBACK_SPEED_KMH +
          " كم/س. الأرقام إرشادية فقط.";
      }

      const stopMinutes = Math.max(0, parseFloat(el("stopMinutes").value) || 0);
      const startTime = el("startTime").value || "08:00";

      const result = buildSchedule(route, stopMinutes, startTime, chosenBreaks);
      lastResult = result;
      lastRoute = route;
      lastRouteForBreaks = route;
      renderBreakPicker(route);

      renderSummary(result);
      renderTimeline(result);
      el("resultPanel").classList.remove("hidden");
      el("wtDetailEmpty").classList.add("hidden");
      el("routeSourceNote").textContent = noteText;

      // الخريطة إضافة توضيحية: لو تعذّر تحميل مكتبتها لا نُسقِط النتيجة كلها
      try {
        renderMap(route);
      } catch (mapErr) {
        el("routeSourceNote").textContent =
          noteText + " (تعذّر عرض الخريطة، والنتائج أعلاه صحيحة.)";
      }

      el("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      showError("حدث خطأ أثناء الحساب: " + (err && err.message ? err.message : err));
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalLabel;
    }
  }

  // ==========================================================================
  //                        واجهة الترتيب الجديد
  // ==========================================================================

  function toast(message, kind) {
    const box = el("wtToast");
    box.className = "toast" + (kind ? " is-" + kind : "");
    box.textContent = message;
    box.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => box.classList.add("hidden"), 4000);
  }

  // ------------------------------------------------------- محطات المسار
  //
  // مربع النص هو مصدر الحقيقة الوحيد: كل ترتيب أو حذف يعيد كتابة أسطره.
  // القائمة أدناه مجرّد عرض له — بهذا لا يوجد مصدران قد يتناقضان.
  const ICON_GRIP =
    '<svg width="14" height="16" fill="currentColor" viewBox="0 0 10 16" aria-hidden="true">' +
    '<circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/>' +
    '<circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/>' +
    '<circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>';

  function stopLines() {
    return el("mosquesInput").value.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  function writeStopLines(lines) {
    el("mosquesInput").value = lines.join("\n");
    renderStopsList();
  }

  function renderStopsList() {
    const list = el("wtStopsList");
    const empty = el("wtStopsEmpty");
    const badge = el("wtStopsBadge");
    const hint = el("wtStopsHint");

    let stops = [];
    try {
      stops = parseMosques();
    } catch (e) {
      stops = [];
    }

    badge.textContent = stops.length
      ? arabicUnit(stops.length, "محطة واحدة", "محطتان", "محطات", "محطة")
      : "لا محطات";
    badge.classList.toggle("is-set", stops.length > 0);

    empty.classList.toggle("hidden", stops.length > 0);
    hint.classList.toggle("hidden", stops.length < 2);

    list.innerHTML = stops
      .map(
        (m, i) =>
          '<li class="stop-row" draggable="true" data-i="' + i + '">' +
          '<span class="grip" aria-hidden="true">' + ICON_GRIP + "</span>" +
          '<span class="stop-index">' + (i + 1) + "</span>" +
          '<span class="stop-label">' + escapeHtml(m.name) +
          '<span class="stop-coords">' + m.lat.toFixed(4) + ", " + m.lon.toFixed(4) +
          "</span></span>" +
          '<span class="stop-move">' +
          '<button type="button" class="icon-btn" data-move="up" data-i="' + i + '" ' +
          (i === 0 ? "disabled " : "") + 'aria-label="تحريك لأعلى">' + ICON_UP + "</button>" +
          '<button type="button" class="icon-btn" data-move="down" data-i="' + i + '" ' +
          (i === stops.length - 1 ? "disabled " : "") + 'aria-label="تحريك لأسفل">' + ICON_DOWN + "</button>" +
          "</span>" +
          '<button type="button" class="icon-btn danger" data-drop="' + i + '" ' +
          'aria-label="إزالة هذه المحطة" title="إزالة">' + ICON_TRASH_SM + "</button></li>",
      )
      .join("");
  }

  const ICON_UP =
    '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M18 15l-6-6-6 6"/></svg>';

  const ICON_DOWN =
    '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M6 9l6 6 6-6"/></svg>';

  const ICON_TRASH_SM =
    '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/>' +
    '<path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>';

  el("wtStopsList").addEventListener("click", function (e) {
    const drop = e.target.closest("[data-drop]");
    if (drop) {
      const lines = stopLines();
      lines.splice(parseInt(drop.getAttribute("data-drop"), 10), 1);
      writeStopLines(lines);
      return;
    }

    // أزرار السهمين بديل السحب: تعمل باللمس وبلوحة المفاتيح، وهو ما لا
    // يوفّره السحب والإفلات وحده
    const move = e.target.closest("[data-move]");
    if (move) {
      const i = parseInt(move.getAttribute("data-i"), 10);
      const dir = move.getAttribute("data-move") === "up" ? -1 : 1;
      const lines = stopLines();
      if (i + dir < 0 || i + dir >= lines.length) return;
      const [row] = lines.splice(i, 1);
      lines.splice(i + dir, 0, row);
      writeStopLines(lines);
      // نُبقي التركيز على نفس الزر بعد إعادة الرسم
      const next = el("wtStopsList").querySelector(
        '[data-move="' + move.getAttribute("data-move") + '"][data-i="' + (i + dir) + '"]',
      );
      if (next) next.focus();
    }
  });

  // ----- السحب والإفلات لإعادة الترتيب -----
  let dragFrom = null;

  el("wtStopsList").addEventListener("dragstart", function (e) {
    const row = e.target.closest(".stop-row");
    if (!row) return;
    dragFrom = parseInt(row.getAttribute("data-i"), 10);
    row.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    // Firefox لا يبدأ السحب إن لم تُضبط بيانات
    e.dataTransfer.setData("text/plain", String(dragFrom));
  });

  el("wtStopsList").addEventListener("dragover", function (e) {
    if (dragFrom === null) return;
    e.preventDefault();
    const row = e.target.closest(".stop-row");
    el("wtStopsList")
      .querySelectorAll(".stop-row")
      .forEach((r) => r.classList.remove("is-over"));
    if (row) row.classList.add("is-over");
  });

  el("wtStopsList").addEventListener("drop", function (e) {
    if (dragFrom === null) return;
    e.preventDefault();
    const row = e.target.closest(".stop-row");
    if (!row) return;
    const to = parseInt(row.getAttribute("data-i"), 10);
    if (to === dragFrom) return;
    const lines = stopLines();
    const [moved] = lines.splice(dragFrom, 1);
    lines.splice(to, 0, moved);
    writeStopLines(lines);
  });

  el("wtStopsList").addEventListener("dragend", function () {
    dragFrom = null;
    el("wtStopsList")
      .querySelectorAll(".stop-row")
      .forEach((r) => r.classList.remove("is-dragging", "is-over"));
  });

  el("mosquesInput").addEventListener("input", renderStopsList);

  // ----- مفتاح مقسّم لمصدر المحطات: خياران ظاهران دائماً، وواحد نشط -----
  document.querySelectorAll(".seg-btn").forEach((tab) => {
    tab.addEventListener("click", function () {
      const target = this.getAttribute("data-tab");
      document.querySelectorAll(".seg-btn").forEach((t) => {
        const on = t === this;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", String(on));
      });
      el("paneSaved").classList.toggle("hidden", target !== "saved");
      el("paneManual").classList.toggle("hidden", target !== "manual");
    });
  });

  // ----- ملخّص الإعدادات في العنوان: تعرف قيمها بلا فتح -----
  function updateSettingsSummary() {
    const start = el("startTime").value || "08:00";
    const mins = el("stopMinutes").value || "60";
    el("wtSettingsSummary").textContent = "تبدأ " + start + " · " + mins + " دقيقة بكل مسجد";
  }

  ["startTime", "stopMinutes", "datum", "zone"].forEach((id) => {
    el(id).addEventListener("change", updateSettingsSummary);
  });
  updateSettingsSummary();

  // ----- نسخ الخطة كنص: تُرسل في واتساب للفريق قبل الخروج للميدان -----
  el("wtCopyPlan").addEventListener("click", async function () {
    const text = planAsText();
    if (!text) {
      toast("احسب المسار أولاً.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("نُسخت الخطة.", "ok");
    } catch (e) {
      // الحافظة محجوبة (اتصال غير آمن أو رفض المستخدم) — نعرض النص لينسخه يدوياً
      window.prompt("انسخ الخطة يدوياً:", text);
    }
  });

  function planAsText() {
    if (!lastResult) return "";
    const lines = ["خطة يوم العمل", ""];
    let n = 0;
    lastResult.schedule.forEach((stop) => {
      if (stop.isBreak) {
        lines.push("• " + stop.name + " — " + formatClock(stop.arrival) + " إلى " + formatClock(stop.departure));
        return;
      }
      if (stop.isOrigin && n > 0) {
        lines.push("العودة إلى " + stop.name + " — " + formatClock(stop.arrival));
        return;
      }
      if (stop.isOrigin) {
        lines.push("الانطلاق من " + stop.name + " — " + formatClock(stop.departure));
        return;
      }
      n++;
      lines.push(n + ". " + stop.name + " — " + formatClock(stop.arrival) + " إلى " + formatClock(stop.departure));
    });
    lines.push("");
    lines.push("الإجمالي: " + formatDuration(lastResult.totalMinutes));
    return lines.join("\n");
  }

  el("wtPrint").addEventListener("click", () => window.print());

  el("computeBtn").addEventListener("click", compute);

  // تغيير أي استراحة يُعيد بناء خطة اليوم فوراً (بلا إعادة حساب المسار)
  el("breakPicker").addEventListener("change", function (e) {
    const sel = e.target.closest("[data-break]");
    if (!sel) return;
    chosenBreaks[sel.getAttribute("data-break")] = sel.value;

    const card = sel.closest(".break-card");
    if (card) card.classList.toggle("is-active", !!sel.value);

    rebuildSchedule();
  });

  // ----- المساجد المحفوظة -----
  renderSavedMosques();

  // وصول مساجد جديدة من المزامنة السحابية يُحدّث القائمة فوراً
  document.addEventListener("mosques:updated", renderSavedMosques);

  el("addSelectedBtn").addEventListener("click", addSelectedSaved);

  // أزرار التعديل والحذف داخل كل صف
  el("savedList").addEventListener("click", function (e) {
    const editBtn = e.target.closest("[data-edit]");
    if (editBtn) {
      e.preventDefault();
      startEditSaved(editBtn.getAttribute("data-edit"));
      return;
    }

    const delBtn = e.target.closest("[data-delete]");
    if (delBtn) {
      e.preventDefault();
      const id = delBtn.getAttribute("data-delete");
      const store = window.MosqueStore;
      if (!store) return;
      const item = store.loadAll().find((m) => m.id === id);
      const label = item ? String(item.name).split(" — ")[0] : "هذا المسجد";
      askConfirm("سيُحذف «" + label + "» من القائمة.", "حذف المسجد", function () {
        store.removeById(id);
        renderSavedMosques();
      });
    }
  });

  el("selectAllSaved").addEventListener("click", function () {
    const boxes = el("savedList").querySelectorAll('input[type="checkbox"]');
    const allChecked = Array.from(boxes).every((b) => b.checked);
    boxes.forEach((b) => (b.checked = !allChecked));
  });

  el("clearSaved").addEventListener("click", function () {
    if (!window.MosqueStore) return;
    const total = window.MosqueStore.loadAll().length;
    if (!total) return;
    askConfirm(
      "سيُمسح " + total + " مسجداً من القائمة المحفوظة، ولا يمكن التراجع.",
      "امسح الكل",
      function () {
        window.MosqueStore.clearAll();
        renderSavedMosques();
      },
    );
  });

  // ملاحظة: window.open مع وسيط خصائص (مثل "noopener") تعامله بعض المتصفحات
  // — خصوصاً Safari — كنافذة منبثقة فتحجبه. النقر على رابط حقيقي لا يُحجب أبداً.
  function openInNewTab(url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // أول رسم لقائمة المحطات (مربع النص قد يحمل قيمة محفوظة من المتصفح)
  renderStopsList();

  el("openMapsBtn").addEventListener("click", function () {
    if (!lastRoute) {
      showError("احسب المسار أولاً قبل فتحه في خرائط Google.");
      return;
    }
    openInNewTab(buildGoogleMapsUrl(lastRoute));
  });
})();
