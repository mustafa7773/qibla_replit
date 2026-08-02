/**
 * خدمة استقبال سجلات "المساجد المنتهية" وإضافتها كصفوف في جدول أونلاين.
 *
 * لماذا هذه الطريقة؟
 * موقعك يعمل كصفحات ثابتة على GitHub Pages بلا خادم خاص به. وأي مفتاح يُوضع
 * في كود المتصفح يستطيع أي زائر رؤيته. لذلك يبقى المفتاح هنا داخل الخدمة على
 * خادم Google، ولا يُرسل المتصفح سوى بيانات السجل نفسها.
 *
 * ملاحظة: هذا الملف لا يُرفع مع الموقع. يُلصق داخل Google Apps Script.
 *
 * ----------------------------------------------------------------------------
 * خطوات التركيب (خمس دقائق)
 * ----------------------------------------------------------------------------
 * 1) أنشئ جدولاً جديداً على Google Sheets (يُفتح ويُصدَّر كملف Excel متى شئت).
 * 2) من القائمة: Extensions ← Apps Script.
 * 3) امسح ما بداخل المحرر والصق هذا الملف كاملاً.
 * 4) اضغط Deploy ← New deployment ← اختر النوع Web app.
 *      Execute as:      Me
 *      Who has access:  Anyone
 * 5) انسخ الرابط الناتج (ينتهي بـ /exec) وضعه في خانة "رابط المزامنة" بالأداة.
 *
 * الصفوف تُضاف ولا تُستبدل أبداً. وإن تكرر إرسال نفس السجل (ضغطة مزدوجة أو
 * إعادة محاولة بعد انقطاع) يُحدَّث الصف نفسه بدل إضافة صف مكرر، اعتماداً على
 * معرّف السجل الفريد Record ID.
 */

var SHEET_NAME = 'المساجد المنتهية';

var HEADERS = [
  'Record ID',
  'Completion Date',
  'Governorate',
  'Project Price',
  'Mosque Name',
  'Notes',
  'Created At',
  'Updated At',
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  // القفل يمنع تداخل طلبين متزامنين على نفس الجدول
  lock.waitLock(30000);

  try {
    var payload = JSON.parse(e.postData.contents);
    var records = payload.records || [];
    if (!records.length) {
      return json({ ok: true, added: 0, updated: 0 });
    }

    var sheet = getSheet();
    var index = buildIdIndex(sheet);
    var added = 0;
    var updated = 0;
    var toAppend = [];

    records.forEach(function (r) {
      var row = [
        r.recordId || '',
        r.completionDate || '',
        r.governorate || '',
        Number(r.price) || 0,
        r.mosqueName || '',
        r.notes || '',
        r.createdAt || '',
        r.updatedAt || '',
      ];

      var existingRow = index[r.recordId];
      if (existingRow) {
        sheet.getRange(existingRow, 1, 1, HEADERS.length).setValues([row]);
        updated++;
      } else {
        toAppend.push(row);
        added++;
      }
    });

    if (toAppend.length) {
      sheet
        .getRange(sheet.getLastRow() + 1, 1, toAppend.length, HEADERS.length)
        .setValues(toAppend);
    }

    return json({ ok: true, added: added, updated: updated });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/** يبني خريطة: معرّف السجل ← رقم صفه، لمنع تكرار الصفوف */
function buildIdIndex(sheet) {
  var index = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return index;

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i][0]).trim();
    if (id) index[id] = i + 2;
  }
  return index;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
