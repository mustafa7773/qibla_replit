// ============================================================================
// مولّد ملفات Excel حقيقية (.xlsx)
//
// يبني الملف بصيغة OOXML مباشرةً باستخدام PizZip (وهي أصلاً ضمن مكتبات المشروع)،
// فلا نضيف أي اعتمادية جديدة. الملف الناتج قابل للتعديل والحفظ في Excel كأي ملف
// عادي — على عكس CSV الذي لا يحمل تنسيقاً ولا يدعم أوراقاً متعددة.
//
// بنية الملف:
//   • ورقة "الملخص"  : إجمالي كل شهر وعدد مساجده، ثم المجموع الكلي، ويليه
//                      جدول توزيع المحافظات في نفس الورقة.
//   • ورقة لكل شهر    : تفاصيل مساجده مع صف مجموع في نهايتها.
//
// الأوراق للأشهر فقط — لا ورقة مستقلة لكل محافظة.
//
// التنسيق: رأس ملوّن مثبّت، حدود، عرض أعمدة مضبوط، تنسيق عملة، واتجاه RTL.
// ============================================================================

(function () {
  "use strict";

  const MONTHS = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ];

  // فهارس الأنماط كما تُعرَّف في styles.xml أدناه
  const S = {
    DEFAULT: 0,
    HEADER: 1,
    TEXT: 2,
    MONEY: 3,
    TOTAL_LABEL: 4,
    TOTAL_MONEY: 5,
    TITLE: 6,
    COUNT: 7,
  };

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function colName(i) {
    let s = "";
    let n = i;
    while (n >= 0) {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    }
    return s;
  }

  // خلية نصية (نستخدم النص المضمّن لتفادي جدول النصوص المشترك)
  function cellText(ref, value, style) {
    if (value === "" || value == null) {
      return '<c r="' + ref + '" s="' + style + '"/>';
    }
    return (
      '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
      esc(value) +
      "</t></is></c>"
    );
  }

  function cellNumber(ref, value, style) {
    return '<c r="' + ref + '" s="' + style + '"><v>' + (Number(value) || 0) + "</v></c>";
  }

  // يبني ورقة كاملة من صفوف معرَّفة كـ [{v, style, num}]
  function buildSheet(rows, widths) {
    const cols = widths
      .map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>')
      .join("");

    const body = rows
      .map((cells, r) => {
        const rowNum = r + 1;
        const inner = cells
          .map((c, i) => {
            const ref = colName(i) + rowNum;
            return c && c.num
              ? cellNumber(ref, c.v, c.style || S.DEFAULT)
              : cellText(ref, c ? c.v : "", (c && c.style) || S.DEFAULT);
          })
          .join("");
        return '<row r="' + rowNum + '">' + inner + "</row>";
      })
      .join("");

    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView rightToLeft="1" workbookViewId="0">' +
      '<pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/>' +
      "</sheetView></sheetViews>" +
      '<sheetFormatPr defaultRowHeight="18"/>' +
      "<cols>" + cols + "</cols>" +
      "<sheetData>" + body + "</sheetData>" +
      "</worksheet>"
    );
  }

  function stylesXml() {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      // تنسيق عملة بثلاث خانات عشرية كما هو معتمد في الريال العُماني
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.000"/></numFmts>' +
      '<fonts count="4">' +
      '<font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="14"/><color rgb="FF1F3864"/><name val="Calibri"/></font>' +
      "</fonts>" +
      '<fills count="4">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF2E3C4"/><bgColor indexed="64"/></patternFill></fill>' +
      "</fills>" +
      '<borders count="2">' +
      "<border><left/><right/><top/><bottom/><diagonal/></border>" +
      '<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right>' +
      '<top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>' +
      "</borders>" +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="8">' +
      // 0 default
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      // 1 header
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      // 2 text
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
      // 3 money
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      // 4 total label
      '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
      // 5 total money
      '<xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      // 6 title
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
      // 7 count
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      "</cellXfs>" +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      "</styleSheet>"
    );
  }

  // أسماء أوراق Excel: 31 حرفاً كحد أقصى وبلا الرموز : \ / ? * [ ]
  function safeSheetName(name, used) {
    let base = String(name).replace(/[:\\\/\?\*\[\]]/g, "-").slice(0, 31) || "ورقة";
    let out = base;
    let i = 2;
    while (used.has(out)) {
      const suffix = " (" + i + ")";
      out = base.slice(0, 31 - suffix.length) + suffix;
      i++;
    }
    used.add(out);
    return out;
  }

  function monthLabel(key) {
    const [y, m] = String(key).split("-");
    return MONTHS[parseInt(m, 10) - 1] + " " + y;
  }

  /**
   * يبني ملف xlsx ويُعيده كـ Blob.
   * records: [{ mosqueName, completionDate, governorate, price, notes }]
   */
  function build(records) {
    if (typeof window.PizZip === "undefined") {
      throw new Error("مكتبة الضغط غير محمّلة (PizZip).");
    }

    // تجميع السجلات حسب الشهر
    const byMonth = {};
    records.forEach((r) => {
      const d = new Date(r.completionDate);
      const key = isNaN(d.getTime())
        ? "غير محدد"
        : d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      (byMonth[key] = byMonth[key] || []).push(r);
    });

    const monthKeys = Object.keys(byMonth).sort();
    const used = new Set();
    const sheets = [];

    // ---------------------------------------------------- ورقة الملخص
    const summaryRows = [];
    summaryRows.push([{ v: "ملخص المساجد المنتهية", style: S.TITLE }]);
    summaryRows.push([
      { v: "الشهر", style: S.HEADER },
      { v: "عدد المساجد", style: S.HEADER },
      { v: "الإجمالي (ر.ع)", style: S.HEADER },
    ]);

    let grandTotal = 0;
    let grandCount = 0;

    monthKeys.forEach((k) => {
      const list = byMonth[k];
      const sum = list.reduce((s, r) => s + (Number(r.price) || 0), 0);
      grandTotal += sum;
      grandCount += list.length;
      summaryRows.push([
        { v: k === "غير محدد" ? k : monthLabel(k), style: S.TEXT },
        { v: list.length, style: S.COUNT, num: true },
        { v: sum, style: S.MONEY, num: true },
      ]);
    });

    summaryRows.push([
      { v: "المجموع الكلي", style: S.TOTAL_LABEL },
      { v: grandCount, style: S.TOTAL_LABEL, num: true },
      { v: grandTotal, style: S.TOTAL_MONEY, num: true },
    ]);

    // جدول ثانٍ في نفس الورقة: توزيع المساجد على المحافظات
    const byGov = {};
    records.forEach((r) => {
      const g = r.governorate || "غير محدد";
      (byGov[g] = byGov[g] || []).push(r);
    });

    const govKeys = Object.keys(byGov).sort(
      (a, b) =>
        byGov[b].reduce((s, r) => s + (Number(r.price) || 0), 0) -
        byGov[a].reduce((s, r) => s + (Number(r.price) || 0), 0),
    );

    summaryRows.push([]);
    summaryRows.push([{ v: "التوزيع حسب المحافظة", style: S.TITLE }]);
    summaryRows.push([
      { v: "المحافظة", style: S.HEADER },
      { v: "عدد المساجد", style: S.HEADER },
      { v: "الإجمالي (ر.ع)", style: S.HEADER },
    ]);

    govKeys.forEach((g) => {
      const list = byGov[g];
      summaryRows.push([
        { v: g, style: S.TEXT },
        { v: list.length, style: S.COUNT, num: true },
        { v: list.reduce((s, r) => s + (Number(r.price) || 0), 0), style: S.MONEY, num: true },
      ]);
    });

    summaryRows.push([
      { v: "المجموع الكلي", style: S.TOTAL_LABEL },
      { v: grandCount, style: S.TOTAL_LABEL, num: true },
      { v: grandTotal, style: S.TOTAL_MONEY, num: true },
    ]);

    sheets.push({
      name: safeSheetName("الملخص", used),
      xml: buildSheet(summaryRows, [22, 14, 18]),
    });

    // ---------------------------------------------------- ورقة لكل شهر
    monthKeys.forEach((k) => {
      const list = byMonth[k].slice().sort((a, b) =>
        String(a.completionDate) < String(b.completionDate) ? -1 : 1,
      );

      const rows = [];
      rows.push([{ v: k === "غير محدد" ? k : monthLabel(k), style: S.TITLE }]);
      rows.push([
        { v: "اسم المسجد", style: S.HEADER },
        { v: "رقم الطلب بنظام المساجد", style: S.HEADER },
        { v: "تاريخ الإنجاز", style: S.HEADER },
        { v: "المحافظة", style: S.HEADER },
        { v: "هاتف الوكيل", style: S.HEADER },
        { v: "السعر (ر.ع)", style: S.HEADER },
        { v: "ملاحظات", style: S.HEADER },
      ]);

      let sum = 0;
      list.forEach((r) => {
        sum += Number(r.price) || 0;
        rows.push([
          { v: r.mosqueName || "—", style: S.TEXT },
          // رقم الطلب والهاتف نصّان لا رقمان: الأصفار البادئة تُحفظ،
          // ولا يحوّلهما Excel لصيغة علمية
          { v: r.requestNo || "", style: S.COUNT },
          { v: r.completionDate || "", style: S.COUNT },
          { v: r.governorate || "", style: S.TEXT },
          { v: r.agentPhone || "", style: S.COUNT },
          { v: Number(r.price) || 0, style: S.MONEY, num: true },
          { v: r.notes || "", style: S.TEXT },
        ]);
      });

      rows.push([
        { v: "المجموع (" + list.length + " مسجد)", style: S.TOTAL_LABEL },
        { v: "", style: S.TOTAL_LABEL },
        { v: "", style: S.TOTAL_LABEL },
        { v: "", style: S.TOTAL_LABEL },
        { v: "", style: S.TOTAL_LABEL },
        { v: sum, style: S.TOTAL_MONEY, num: true },
        { v: "", style: S.TOTAL_LABEL },
      ]);

      sheets.push({
        name: safeSheetName(k === "غير محدد" ? k : monthLabel(k), used),
        xml: buildSheet(rows, [30, 20, 15, 26, 16, 15, 30]),
      });
    });

    // ملاحظة: لا نُنشئ ورقة مستقلة لكل محافظة — الأوراق للأشهر فقط.
    // توزيع المحافظات يبقى كجدول ضمن ورقة "الملخص" أعلاه.

    // ---------------------------------------------------- تجميع الملف
    const zip = new window.PizZip();

    const sheetRefs = sheets
      .map((s, i) => '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>')
      .join("");

    const sheetRels = sheets
      .map(
        (s, i) =>
          '<Relationship Id="rId' + (i + 1) +
          '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
          (i + 1) + '.xml"/>',
      )
      .join("");

    const overrides = sheets
      .map(
        (s, i) =>
          '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
          '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      )
      .join("");

    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        overrides +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>",
    );

    zip.file(
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    );

    zip.file(
      "xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        "<sheets>" + sheetRefs + "</sheets></workbook>",
    );

    zip.file(
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheetRels +
        '<Relationship Id="rId' + (sheets.length + 1) +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>",
    );

    zip.file("xl/styles.xml", stylesXml());
    sheets.forEach((s, i) => zip.file("xl/worksheets/sheet" + (i + 1) + ".xml", s.xml));

    return zip.generate({
      type: "blob",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      compression: "DEFLATE",
    });
  }

  window.XlsxExport = { build };
})();
