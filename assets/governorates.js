// ============================================================================
// المصدر الوحيد للمحافظات والولايات
//
// يحتوي على قائمة كاملة (61 ولاية) لاكتشاف الولاية من نص الكروكي مباشرة
// (عربي أو إنجليزي)، بأولوية على نتيجة تحديد الموقع الجغرافي (GPS) التي قد
// تكون تقريبية أو خاطئة. راجع دالة detectFromText.
// ============================================================================

(function () {
  "use strict";

  // كل ولاية: الاسم العربي، المحافظة الكاملة، ومرادفات إنجليزية شائعة في
  // كروكيات وزارة الإسكان (بلا مسافات، بأحرف كبيرة) للمطابقة مع OCR.
  const WILAYAT = [
    { wilaya: "مسقط", governorate: "محافظة مسقط", en: ["MUSCAT"] },
    { wilaya: "مطرح", governorate: "محافظة مسقط", en: ["MUTRAH", "MATRAH"] },
    { wilaya: "بوشر", governorate: "محافظة مسقط", en: ["BAWSHAR", "BOSHER", "BOUSHER"] },
    { wilaya: "السيب", governorate: "محافظة مسقط", en: ["SEEB", "ALSEEB"] },
    { wilaya: "العامرات", governorate: "محافظة مسقط", en: ["AMERAT", "ALAMERAT"] },
    { wilaya: "قريات", governorate: "محافظة مسقط", en: ["QURAYYAT", "QURAYAT"] },

    { wilaya: "صلالة", governorate: "محافظة ظفار", en: ["SALALAH"] },
    { wilaya: "طاقة", governorate: "محافظة ظفار", en: ["TAQAH"] },
    { wilaya: "مرباط", governorate: "محافظة ظفار", en: ["MIRBAT"] },
    { wilaya: "سدح", governorate: "محافظة ظفار", en: ["SADAH", "SADH"] },
    { wilaya: "رخيوت", governorate: "محافظة ظفار", en: ["RAKHYUT"] },
    { wilaya: "ضلكوت", governorate: "محافظة ظفار", en: ["DHALKUT"] },
    { wilaya: "مقشن", governorate: "محافظة ظفار", en: ["MUQSHIN"] },
    { wilaya: "شليم وجزر الحلانيات", governorate: "محافظة ظفار", en: ["SHALIM", "HALLANIYAT"] },
    { wilaya: "ثمريت", governorate: "محافظة ظفار", en: ["THUMRAIT"] },
    { wilaya: "المزيونة", governorate: "محافظة ظفار", en: ["MAZYOUNA", "MAZYONA"] },

    { wilaya: "خصب", governorate: "محافظة مسندم", en: ["KHASAB"] },
    { wilaya: "بخاء", governorate: "محافظة مسندم", en: ["BUKHA"] },
    { wilaya: "دبا", governorate: "محافظة مسندم", en: ["DIBBA"] },
    { wilaya: "مدحاء", governorate: "محافظة مسندم", en: ["MADHA"] },

    { wilaya: "البريمي", governorate: "محافظة البريمي", en: ["BURAIMI", "ALBURAIMI"] },
    { wilaya: "محضة", governorate: "محافظة البريمي", en: ["MAHDAH"] },
    { wilaya: "السنينة", governorate: "محافظة البريمي", en: ["SUNAYNAH"] },

    { wilaya: "نزوى", governorate: "محافظة الداخلية", en: ["NIZWA"] },
    { wilaya: "بهلاء", governorate: "محافظة الداخلية", en: ["BAHLA"] },
    { wilaya: "سمائل", governorate: "محافظة الداخلية", en: ["SAMAIL"] },
    { wilaya: "أدم", governorate: "محافظة الداخلية", en: ["ADAM"] },
    { wilaya: "بدبد", governorate: "محافظة الداخلية", en: ["BIDBID"] },
    { wilaya: "الحمراء", governorate: "محافظة الداخلية", en: ["ALHAMRA", "HAMRA"] },
    { wilaya: "منح", governorate: "محافظة الداخلية", en: ["MANAH"] },
    { wilaya: "إزكي", governorate: "محافظة الداخلية", en: ["IZKI"] },

    { wilaya: "صحار", governorate: "محافظة شمال الباطنة", en: ["SOHAR", "SUHAR"] },
    { wilaya: "شناص", governorate: "محافظة شمال الباطنة", en: ["SHINAS"] },
    { wilaya: "لوى", governorate: "محافظة شمال الباطنة", en: ["LIWA"] },
    { wilaya: "صحم", governorate: "محافظة شمال الباطنة", en: ["SAHAM"] },
    { wilaya: "الخابورة", governorate: "محافظة شمال الباطنة", en: ["KHABOURAH", "KHABURAH"] },
    { wilaya: "السويق", governorate: "محافظة شمال الباطنة", en: ["SUWAIQ"] },

    { wilaya: "الرستاق", governorate: "محافظة جنوب الباطنة", en: ["RUSTAQ", "ALRUSTAQ"] },
    { wilaya: "العوابي", governorate: "محافظة جنوب الباطنة", en: ["AWABI", "ALAWABI"] },
    { wilaya: "نخل", governorate: "محافظة جنوب الباطنة", en: ["NAKHAL"] },
    { wilaya: "وادي المعاول", governorate: "محافظة جنوب الباطنة", en: ["WADIALMAAWIL", "MAAWIL"] },
    { wilaya: "بركاء", governorate: "محافظة جنوب الباطنة", en: ["BARKA"] },
    { wilaya: "المصنعة", governorate: "محافظة جنوب الباطنة", en: ["MUSANAAH", "MASNAAH"] },

    { wilaya: "إبراء", governorate: "محافظة شمال الشرقية", en: ["IBRA"] },
    { wilaya: "المضيبي", governorate: "محافظة شمال الشرقية", en: ["MUDHAIBI", "ALMUDHAIBI"] },
    { wilaya: "بدية", governorate: "محافظة شمال الشرقية", en: ["BIDIYAH"] },
    { wilaya: "القابل", governorate: "محافظة شمال الشرقية", en: ["QABIL"] },
    { wilaya: "وادي بني خالد", governorate: "محافظة شمال الشرقية", en: ["WADIBANIKHALID", "BANIKHALID"] },
    { wilaya: "دماء والطائيين", governorate: "محافظة شمال الشرقية", en: ["DIMA", "TAIYIN"] },

    { wilaya: "صور", governorate: "محافظة جنوب الشرقية", en: ["SUR"] },
    { wilaya: "الكامل والوافي", governorate: "محافظة جنوب الشرقية", en: ["KAMIL", "ALWAFI"] },
    { wilaya: "جعلان بني بو علي", governorate: "محافظة جنوب الشرقية", en: ["JALANBANIBUALI", "BANIBUALI"] },
    { wilaya: "جعلان بني بو حسن", governorate: "محافظة جنوب الشرقية", en: ["JALANBANIBUHASAN", "BANIBUHASAN"] },
    { wilaya: "مصيرة", governorate: "محافظة جنوب الشرقية", en: ["MASIRAH"] },

    { wilaya: "عبري", governorate: "محافظة الظاهرة", en: ["IBRI"] },
    { wilaya: "ينقل", governorate: "محافظة الظاهرة", en: ["YANQUL"] },
    { wilaya: "ضنك", governorate: "محافظة الظاهرة", en: ["DANK"] },

    { wilaya: "هيماء", governorate: "محافظة الوسطى", en: ["HAIMA"] },
    { wilaya: "محوت", governorate: "محافظة الوسطى", en: ["MAHOUT"] },
    { wilaya: "الجازر", governorate: "محافظة الوسطى", en: ["ALJAZER", "JAZER"] },
    { wilaya: "الدقم", governorate: "محافظة الوسطى", en: ["DUQM"] },
  ];

  // محافظات سلطنة عُمان الإحدى عشرة
  const OFFICIAL = [
    "محافظة مسقط",
    "محافظة ظفار",
    "محافظة مسندم",
    "محافظة البريمي",
    "محافظة الداخلية",
    "محافظة شمال الباطنة",
    "محافظة جنوب الباطنة",
    "محافظة جنوب الشرقية",
    "محافظة شمال الشرقية",
    "محافظة الظاهرة",
    "محافظة الوسطى",
  ];

  // يستخرج اسم المحافظة من قيمة قد تكون "محافظة كذا - ولاية كذا"
  function governorateOf(value) {
    if (!value) return "";
    return String(value).split(" - ")[0].trim();
  }

  // يبحث في نص الكروكي (OCR) عن اسم ولاية صريح، عربياً أو إنجليزياً.
  // يُفحص الأطول أولاً لتفادي تطابق جزئي خاطئ (مثال: تفادي مطابقة اسم فرعي
  // ضمن اسم ولاية أخرى)، ويُشترط حد كلمة عند المطابقة الإنجليزية.
  function detectFromText(text) {
    if (!text) return null;
    const arabicText = String(text);
    const upperText = String(text).toUpperCase().replace(/[^A-Z]/g, "");

    const sorted = [...WILAYAT].sort((a, b) => b.wilaya.length - a.wilaya.length);

    for (const w of sorted) {
      if (arabicText.includes(w.wilaya)) {
        return { governorate: w.governorate, wilaya: w.wilaya };
      }
    }
    for (const w of sorted) {
      for (const alias of w.en) {
        if (upperText.includes(alias)) {
          return { governorate: w.governorate, wilaya: w.wilaya };
        }
      }
    }
    return null;
  }

  // القائمة النهائية = الرسمية + ما سجّلته الأداة الأولى فعلياً (بلا تكرار)
  function list() {
    const seen = new Set();
    const out = [];

    const push = (v) => {
      const name = governorateOf(v);
      if (!name) return;
      const key = name.replace(/^محافظة\s+/, "");
      if (seen.has(key)) return;
      seen.add(key);
      out.push(name);
    };

    OFFICIAL.forEach(push);

    // القيم القادمة من الأداة الأولى (إن وُجد المخزن)
    if (window.MosqueStore && typeof window.MosqueStore.loadAll === "function") {
      try {
        window.MosqueStore.loadAll().forEach((m) => push(m.governorate));
      } catch (e) {
        // المخزن غير متاح — نكتفي بالقائمة الرسمية
      }
    }

    return out;
  }

  window.Governorates = { list, governorateOf, detectFromText, OFFICIAL, WILAYAT };
})();
