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
 * الأداة ترسل المحتوى بنوع text/plain عن قصد (وهو JSON في جوهره) لتفادي طلب
 * التحقق المسبق CORS الذي لا تدعمه Apps Script؛ ولهذا نقرأه بـ JSON.parse.
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

// ⬇⬇ ضع هنا معرّف جدولك (مطلوب إن أنشأت المشروع من script.google.com مباشرة)
// تجده في رابط الجدول بين /d/ و /edit :
// https://docs.google.com/spreadsheets/d/[[ هذا هو المعرّف ]]/edit
var SPREADSHEET_ID = '';

var SHEET_NAME = 'المساجد المنتهية';
var QIBLA_SHEET_NAME = 'مساجد القبلة';

// أعمدة مساجد أداة القبلة (تُزامَن تلقائياً بين كل أجهزتك)
var QIBLA_HEADERS = [
  'Mosque Name',
  'Governorate',
  'Village',
  'Request No',
  'Easting',
  'Northing',
  'Datum',
  'Zone',
  'Latitude',
  'Longitude',
  'Saved At',
  'Record ID',
];

// ترتيب الأعمدة كما تظهر في الجدول.
// Record ID آخر عمود ويُخفى تلقائياً: هو مفتاح منع التكرار، فبدونه يتكرر
// الصف نفسه عند كل إعادة إرسال. مخفي عن النظر لكنه يعمل في الخلفية.
var HEADERS = [
  'Mosque Name',
  'Completion Date',
  'Governorate',
  'Project Price',
  'Notes',
  'Updated At',
  'Record ID',
];

var ID_COLUMN = HEADERS.indexOf('Record ID') + 1;

/**
 * لفحص التركيب: افتح رابط /exec في المتصفح مباشرة.
 * ظهور رسالة الحالة يعني أن النشر تم بنجاح والرابط صحيح.
 */
function doGet(e) {
  try {
    var sheet = getSheet();

    // ?action=list يُعيد كل السجلات، ليقرأها الموقع على أي جهاز
    var action = e && e.parameter ? e.parameter.action : '';
    var type = e && e.parameter ? e.parameter.type : '';

    if (action === 'list' && type === 'qibla') {
      return json({ ok: true, records: readQibla() });
    }
    if (action === 'list') {
      return json({ ok: true, records: readAll(sheet) });
    }

    return json({
      ok: true,
      service: 'sky-tools-completed-mosques',
      spreadsheet: sheet.getParent().getName(),
      sheet: sheet.getName(),
      rows: Math.max(0, sheet.getLastRow() - 1),
      message: 'الخدمة تعمل والجدول متاح. ضع هذا الرابط في خانة رابط المزامنة.',
    });
  } catch (err) {
    return json({
      ok: false,
      error: String(err),
      message: 'الخدمة تعمل لكنها لا تصل إلى الجدول — راجع SPREADSHEET_ID.',
    });
  }
}

/** يقرأ كل صفوف الجدول ويُعيدها كسجلات */
function readAll(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var col = {};
  HEADERS.forEach(function (h, i) {
    col[h] = i;
  });

  return values
    .filter(function (row) {
      return String(row[col['Record ID']]).trim() !== '';
    })
    .map(function (row) {
      return {
        recordId: String(row[col['Record ID']]).trim(),
        mosqueName: String(row[col['Mosque Name']] || ''),
        completionDate: formatDateCell(row[col['Completion Date']]),
        governorate: String(row[col['Governorate']] || ''),
        price: Number(row[col['Project Price']]) || 0,
        notes: String(row[col['Notes']] || ''),
        updatedAt: toIso(row[col['Updated At']]),
      };
    });
}

/** التاريخ قد يعود كنص أو ككائن Date حسب تنسيق الخلية */
function formatDateCell(v) {
  if (v instanceof Date) {
    return (
      v.getFullYear() +
      '-' +
      ('0' + (v.getMonth() + 1)).slice(-2) +
      '-' +
      ('0' + v.getDate()).slice(-2)
    );
  }
  return String(v || '').trim();
}

function toIso(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v || '').trim();
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  // القفل يمنع تداخل طلبين متزامنين على نفس الجدول
  lock.waitLock(30000);

  try {
    var payload = JSON.parse(e.postData.contents);
    var records = payload.records || [];

    // الحذف يصل كطلب POST بحقل action
    if (payload.action === 'delete') {
      return json(deleteRecord(payload.type, payload.recordId));
    }

    // نوع البيانات يحدد الورقة المستهدفة
    if (payload.type === 'qibla') {
      return json(saveQibla(records));
    }
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
        r.mosqueName || '',
        r.completionDate || '',
        r.governorate || '',
        Number(r.price) || 0,
        r.notes || '',
        r.updatedAt || '',
        r.recordId || '',
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
  // إن كان المشروع مرتبطاً بجدول (Extensions ← Apps Script) يعمل getActive.
  // وإن كان مشروعاً منفصلاً فلا بد من المعرّف، وإلا فلن يجد أي جدول ليكتب فيه
  // — وهذا أشيع سبب لظهور "تمت المزامنة" بلا أي صف في الجدول.
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error(
      'لم يُعثر على الجدول. ضع معرّف الجدول في SPREADSHEET_ID أعلى الملف.'
    );
  }

  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  ensureLayout(sheet);
  return sheet;
}

/**
 * يضمن أن الأعمدة بالترتيب المطلوب.
 * إن كان الجدول بالترتيب القديم فيُعاد ترتيب بياناته حسب أسماء الأعمدة —
 * فلا تضيع أي سجل سابق، ويُحذف عمودا Record ID الظاهر و Created At.
 */
function ensureLayout(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  // جدول فارغ: نكتب العناوين فقط
  if (lastRow === 0) {
    writeHeaders(sheet);
    return;
  }

  var current = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h).trim();
  });

  var same =
    current.length === HEADERS.length &&
    HEADERS.every(function (h, i) {
      return current[i] === h;
    });
  if (same) {
    hideIdColumn(sheet);
    return;
  }

  // ترتيب قديم: نُعيد بناء الصفوف حسب اسم كل عمود
  var data = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  var pos = {};
  current.forEach(function (h, i) {
    pos[h] = i;
  });

  var rebuilt = data
    .filter(function (row) {
      return row.join('').trim() !== '';
    })
    .map(function (row) {
      return HEADERS.map(function (h) {
        return pos[h] !== undefined ? row[pos[h]] : '';
      });
    });

  sheet.clear();
  writeHeaders(sheet);
  if (rebuilt.length) {
    sheet.getRange(2, 1, rebuilt.length, HEADERS.length).setValues(rebuilt);
  }
}

function writeHeaders(sheet) {
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  hideIdColumn(sheet);
}

function hideIdColumn(sheet) {
  try {
    sheet.hideColumns(ID_COLUMN);
  } catch (e) {
    // إخفاء العمود تحسين شكلي فقط — لا يمنع عمل الخدمة
  }
}

/** يبني خريطة: معرّف السجل ← رقم صفه، لمنع تكرار الصفوف */
function buildIdIndex(sheet) {
  var index = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return index;

  var ids = sheet.getRange(2, ID_COLUMN, lastRow - 1, 1).getValues();
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


/**
 * اختبار سريع من داخل المحرر:
 * اختر testWrite من قائمة الدوال ثم اضغط Run.
 * إن ظهر صف تجريبي في الجدول فكل شيء سليم، ويمكنك حذفه بعدها.
 */
function testWrite() {
  var sheet = getSheet();
  sheet.appendRow([
    'صف تجريبي — يمكن حذفه',
    '2026-01-01',
    'محافظة مسقط',
    1,
    '',
    new Date().toISOString(),
    'test_' + new Date().getTime(),
  ]);
  Logger.log('تمت الكتابة في: ' + sheet.getParent().getName());
}


/**
 * إعادة ترتيب أعمدة الجدول فوراً بلا انتظار نشر أو مزامنة.
 *
 * الاستخدام: اختر fixLayout من قائمة الدوال أعلى المحرر ثم اضغط Run.
 * تُعيد ترتيب الأعمدة حسب أسمائها، وتحذف Created At، وتُخفي Record ID،
 * دون أن يضيع أي سجل موجود.
 */
function fixLayout() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  Logger.log(
    'تم ضبط الأعمدة في: ' +
      sheet.getParent().getName() +
      ' / ' +
      sheet.getName() +
      ' — عدد السجلات: ' +
      Math.max(0, lastRow - 1)
  );
  Logger.log('الأعمدة الآن: ' + HEADERS.join(' | '));
}


/* ==========================================================================
   مساجد أداة القبلة — ورقة منفصلة بنفس منطق منع التكرار
   ========================================================================== */

function getQiblaSheet() {
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('لم يُعثر على الجدول. ضع معرّف الجدول في SPREADSHEET_ID.');

  var sheet = ss.getSheetByName(QIBLA_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(QIBLA_SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, QIBLA_HEADERS.length).setValues([QIBLA_HEADERS]);
    sheet.getRange(1, 1, 1, QIBLA_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    try {
      sheet.hideColumns(QIBLA_HEADERS.indexOf('Record ID') + 1);
    } catch (e) {}
  }
  return sheet;
}

function saveQibla(records) {
  if (!records.length) return { ok: true, added: 0, updated: 0 };

  var sheet = getQiblaSheet();
  var idCol = QIBLA_HEADERS.indexOf('Record ID') + 1;
  var lastRow = sheet.getLastRow();

  var index = {};
  if (lastRow > 1) {
    var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      var id = String(ids[i][0]).trim();
      if (id) index[id] = i + 2;
    }
  }

  var added = 0;
  var updated = 0;
  var toAppend = [];

  records.forEach(function (r) {
    var row = [
      r.name || '',
      r.governorate || '',
      r.village || '',
      r.requestNo || '',
      r.easting || '',
      r.northing || '',
      r.datum || '',
      r.zone || '',
      r.lat || '',
      r.lon || '',
      r.savedAt || '',
      r.recordId || '',
    ];
    var at = index[r.recordId];
    if (at) {
      sheet.getRange(at, 1, 1, QIBLA_HEADERS.length).setValues([row]);
      updated++;
    } else {
      toAppend.push(row);
      added++;
    }
  });

  if (toAppend.length) {
    sheet
      .getRange(sheet.getLastRow() + 1, 1, toAppend.length, QIBLA_HEADERS.length)
      .setValues(toAppend);
  }
  return { ok: true, added: added, updated: updated };
}

function readQibla() {
  var sheet = getQiblaSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, QIBLA_HEADERS.length).getValues();
  var c = {};
  QIBLA_HEADERS.forEach(function (h, i) {
    c[h] = i;
  });

  return values
    .filter(function (row) {
      return String(row[c['Record ID']]).trim() !== '';
    })
    .map(function (row) {
      return {
        recordId: String(row[c['Record ID']]).trim(),
        name: String(row[c['Mosque Name']] || ''),
        governorate: String(row[c['Governorate']] || ''),
        village: String(row[c['Village']] || ''),
        requestNo: String(row[c['Request No']] || ''),
        easting: Number(row[c['Easting']]) || 0,
        northing: Number(row[c['Northing']]) || 0,
        datum: String(row[c['Datum']] || ''),
        zone: Number(row[c['Zone']]) || null,
        lat: Number(row[c['Latitude']]) || null,
        lon: Number(row[c['Longitude']]) || null,
        savedAt: toIso(row[c['Saved At']]),
      };
    });
}


/**
 * حذف سجل واحد من الورقة المناسبة اعتماداً على معرّفه.
 */
function deleteRecord(type, recordId) {
  var id = String(recordId || '').trim();
  if (!id) return { ok: false, error: 'المعرّف مطلوب للحذف.' };

  var sheet = type === 'qibla' ? getQiblaSheet() : getSheet();
  var headers = type === 'qibla' ? QIBLA_HEADERS : HEADERS;
  var idCol = headers.indexOf('Record ID') + 1;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, deleted: 0 };

  var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]).trim() === id) {
      sheet.deleteRow(i + 2);
      return { ok: true, deleted: 1 };
    }
  }
  return { ok: true, deleted: 0 };
}
