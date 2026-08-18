// ============================================================================
// تنسيق التاريخ العربي — مصدر واحد
//
// يستخدمه حالياً: assets/pdf-edit.js
// ولتوحيد المصدر مع تقرير Word، استبدل getHijriDateString و
// getArabicGregorianDateString في assets/export.js بنداءَي HijriDate،
// وأضف <script src="assets/hijri.js"> إلى qibla.html قبل export.js.
//
// الصيغة مقيسة من تقرير سليم:
//   السطر الأول:  ٢٤ ذي القعدة ١٤٤٧هـ      (بلا مسافة قبل هـ)
//   السطر الثاني: ١٢ مايو ٢٠٢٦ م           (بمسافة قبل م)
// ============================================================================

(function (global) {
  "use strict";

  const AR_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

  const GREG_MONTHS = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ];

  // Intl يكتب «ذو القعدة»، والتقارير تكتبها «ذي القعدة». نصحّح الاسمين
  // اللذين يختلفان وحدهما، ونترك البقية كما يعطيها التقويم.
  const MONTH_FIX = {
    "ذو القعدة": "ذي القعدة",
    "ذو الحجة": "ذي الحجة",
  };

  function toArabicDigits(value) {
    return String(value).replace(/[0-9]/g, (d) => AR_DIGITS[+d]);
  }

  function toLatinDigits(value) {
    return String(value).replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
  }

  // التقويم الهجري: أم القرى، وهو المعتمد رسمياً في المنطقة.
  // قد يخالف الحساب الفلكي بيوم، لذا تبقى القيمة قابلة للتعديل في الواجهة.
  function hijri(date, opts) {
    const o = opts || {};
    const arabic = o.arabic !== false;
    const suffix = o.suffix === undefined ? "هـ" : o.suffix;
    try {
      const parts = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", {
        day: "numeric", month: "long", year: "numeric",
      }).formatToParts(date);
      const get = (t) => (parts.find((p) => p.type === t) || { value: "" }).value;
      let month = get("month");
      month = MONTH_FIX[month] || month;
      let day = get("day");
      let year = get("year").replace(/[^\d٠-٩]/g, "");   // Intl يلحق « هـ» أحياناً
      if (!arabic) { day = toLatinDigits(day); year = toLatinDigits(year); }
      else { day = toArabicDigits(day); year = toArabicDigits(year); }
      if (!day || !year) return "";
      return day + " " + month + " " + year + suffix;
    } catch (e) {
      return "";
    }
  }

  function gregorian(date, opts) {
    const o = opts || {};
    const arabic = o.arabic !== false;
    const suffix = o.suffix === undefined ? " م" : o.suffix;
    const day = arabic ? toArabicDigits(date.getDate()) : String(date.getDate());
    const year = arabic ? toArabicDigits(date.getFullYear()) : String(date.getFullYear());
    return day + " " + GREG_MONTHS[date.getMonth()] + " " + year + suffix;
  }

  global.HijriDate = { hijri, gregorian, toArabicDigits, toLatinDigits };
})(window);
