/* invoice.js — فاتورة ضريبية بنفس تصميم فاتورة ابتكارات السماء.
 * render(ctx, data, imgs, S) يرسم الصفحة كاملة، وtoPdf يغلّفها في PDF.
 * الإحداثيات بوحدة النقطة (pt) من أعلى يسار صفحة A4. */
(function (root) {
  'use strict';

  var W = 595.2, H = 841.68;
  var GILL = '"Gill Sans MT","Gill Sans","Gill Sans Nova",Calibri,Carlito,"Segoe UI",sans-serif';
  var TAHOMA = 'Tahoma,"Segoe UI",Arial,sans-serif';
  var ARIAL = 'Arial,"Helvetica Neue",Helvetica,"Liberation Sans",sans-serif';
  var MONO = 'SimSun,"Courier New","Liberation Mono",monospace';
  var GRAY = '#969696', NAVY = '#002060', CYAN = '#00B0F0';
  var C_HEAD = '#ECF0F4', C_ROW = '#D8E2EB', C_EDGE = '#C5D3E0';

  // أعمدة الجدول: No · Items · Quantity · Unit Price · Price after discount · SI Total
  var COLS = [41.6, 88.1, 283.8, 338, 414, 502.1, 567.2];
  var T_TOP = 328.7, HEAD_H = 35.4, SUM_H = 17.6;
  var BASE_END = 442.7; // نهاية الجدول في الأصل (بند واحد من سطرين)

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
  function baisa(v) { return Math.round(num(v) * 1000); }
  function fmt(b) { return (b / 1000).toFixed(3); }

  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    return MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
  }

  function compute(data) {
    var rows = (data.items || []).filter(function (it) {
      return (it.desc || '').trim() || num(it.unit) || num(it.price);
    }).map(function (it) {
      var qty = it.qty === '' || it.qty == null ? 1 : num(it.qty);
      var unit = baisa(it.unit);
      var price = (it.price === '' || it.price == null) ? unit : baisa(it.price);
      return { desc: (it.desc || '').trim(), qty: qty, unit: unit, price: price, total: Math.round(qty * price) };
    });
    var sub = rows.reduce(function (s, r) { return s + r.total; }, 0);
    var rate = data.vatRate == null || data.vatRate === '' ? 5 : num(data.vatRate);
    var vat = Math.round(sub * rate / 100);
    return { rows: rows, sub: sub, vat: vat, total: sub + vat };
  }

  function font(ctx, size, o) {
    o = o || {};
    ctx.font = (o.style || '') + ' ' + (o.weight || '') + ' ' + size + 'px ' + (o.family || GILL);
  }

  function txt(ctx, s, x, y, o) {
    o = o || {};
    font(ctx, o.size || 12, o);
    ctx.fillStyle = o.color || '#000';
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = 'middle';
    ctx.direction = o.dir || 'ltr';
    ctx.fillText(s, x, y);
  }

  function wrap(ctx, text, maxW, o) {
    font(ctx, o.size, o);
    var out = [];
    String(text || '').split('\n').forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), line = '';
      if (!words.length) { out.push(''); return; }
      words.forEach(function (w) {
        var t = line ? line + ' ' + w : w;
        if (line && ctx.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
      });
      out.push(line);
    });
    return out;
  }

  function billLines(t) {
    return String(t || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  }

  function rect(ctx, x0, y0, x1, y1, color) {
    ctx.fillStyle = color; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  function render(ctx, data, imgs, S) {
    S = S || 4;
    ctx.save();
    ctx.setTransform(S, 0, 0, S, 0, 0);
    rect(ctx, 0, 0, W, H, '#fff');
    var calc = compute(data);

    /* ---- الترويسة ---- */
    txt(ctx, 'Sky Innovations', 44.8, 81.2, { size: 14, weight: 'bold', family: TAHOMA, color: CYAN });
    txt(ctx, 'ابتكارات السماء', 564.9, 81.2, { size: 14, weight: 'bold', family: TAHOMA, color: CYAN, align: 'right', dir: 'rtl' });
    ['P. O. Box 2537', 'Al Khoud 132', 'Muscat, OMAN'].forEach(function (s, i) {
      txt(ctx, s, 53.4, 107 + i * 17.6, { size: 12 });
    });
    txt(ctx, 'VATIN Reg No = OM1100188171', 44, 159.9, { size: 11, weight: 'bold', color: NAVY });
    txt(ctx, 'Phone: +96894374252', 408.4, 107, { size: 12, weight: 'bold', color: GRAY });
    txt(ctx, 'website:  www.4irt.com', 408.4, 124.6, { size: 12, weight: 'bold', color: GRAY });
    txt(ctx, 'E-mail: sales@4irt.com,', 408.4, 142.2, { size: 12 });
    txt(ctx, '4irt Group', 290, 159.9, { size: 12 });
    txt(ctx, '4iri2t@gmail.com', 402.5, 159.9, { size: 12 });
    if (imgs.logo) ctx.drawImage(imgs.logo, 283.4, 62.1, 101.1, 92.5);
    txt(ctx, 'Tax Invoice', 304.05, 190.4, { size: 18, weight: 'bold', style: 'italic', color: NAVY, align: 'center' });

    /* ---- بيانات الطلب ---- */
    var LBL = { size: 12, weight: 'bold', color: GRAY, align: 'right' };
    var VAL = { size: 12, weight: 'bold' };
    txt(ctx, 'Quote #:', 87, 217.1, LBL);
    txt(ctx, data.quoteNo || '', 91, 217.1, VAL);
    txt(ctx, 'Date:', 87, 276.5, LBL);
    txt(ctx, fmtDate(data.date), 91, 276.5, VAL);
    txt(ctx, 'Customer ID:', 87, 294.4, LBL);
    txt(ctx, data.customerId || '', 91, 294.4, { size: 12, weight: 'bold', family: TAHOMA });
    txt(ctx, 'LOP Ref:', 87, 312.2, LBL);
    txt(ctx, data.lop || '', 91, 312.2, VAL);

    txt(ctx, 'Bill To:', 405, 256, LBL);
    var bl = billLines(data.billTo);
    bl.slice(0, 4).forEach(function (s, i) {
      var sz = 10;
      font(ctx, sz, { weight: 'bold', family: ARIAL });
      var w = ctx.measureText(s).width;
      if (w > 92) sz = Math.max(7, 10 * 92 / w);
      txt(ctx, s, 501.1, 233 + i * 15.1, { size: sz, weight: 'bold', family: ARIAL, align: 'right', dir: 'rtl' });
    });
    txt(ctx, 'TIN  No =', 405, 294.4, LBL);
    txt(ctx, data.tin || '', 408, 294.4, VAL);
    txt(ctx, '| M:  ' + (data.contact || ''), 411.7, 312.2, VAL);

    /* ---- الجدول ---- */
    var itemFont = { size: 10, family: MONO, color: '#333' };
    var descW = COLS[2] - COLS[1] - 14;
    var rows = calc.rows.map(function (r) {
      var lines = wrap(ctx, r.desc, descW, itemFont);
      return { r: r, lines: lines, h: Math.max(28.5, lines.length * 14.7 + 13.8) };
    });
    var y = T_TOP + HEAD_H, itemsTop = y;
    var itemsH = rows.reduce(function (s, x) { return s + x.h; }, 0);
    var sumTop = itemsTop + itemsH;
    var tEnd = sumTop + 2 * SUM_H;

    rect(ctx, COLS[0], T_TOP, COLS[6], T_TOP + HEAD_H, C_HEAD);
    rect(ctx, COLS[0], itemsTop, COLS[6], sumTop, C_ROW);
    rect(ctx, COLS[0], sumTop, COLS[6], sumTop + SUM_H, '#fff');
    rect(ctx, COLS[0], sumTop, COLS[1], sumTop + SUM_H, C_HEAD);
    rect(ctx, COLS[0], sumTop + SUM_H, COLS[3], tEnd, C_ROW);
    rect(ctx, COLS[3], sumTop + SUM_H, COLS[6], tEnd, CYAN);

    // الحدود
    var BLK = '#000', lw = 0.9;
    rect(ctx, COLS[0] - .5, T_TOP - .5, COLS[6] + .5, T_TOP + .4, C_EDGE);
    rect(ctx, COLS[0] - .5, T_TOP, COLS[0] + .4, sumTop + SUM_H, C_EDGE);
    rect(ctx, COLS[6] - .4, T_TOP, COLS[6] + .5, sumTop + SUM_H, C_EDGE);
    rect(ctx, COLS[0] - .5, sumTop + SUM_H, COLS[0] + .4, tEnd, BLK);
    rect(ctx, COLS[6] - .4, sumTop + SUM_H, COLS[6] + .5, tEnd, BLK);
    for (var i = 1; i < 6; i++) rect(ctx, COLS[i] - lw / 2, T_TOP, COLS[i] + lw / 2, tEnd, BLK);
    var hl = [T_TOP + HEAD_H, sumTop, sumTop + SUM_H, tEnd];
    var yy = itemsTop;
    rows.forEach(function (x) { yy += x.h; hl.push(yy); });
    hl.forEach(function (h) { rect(ctx, COLS[0], h - lw / 2, COLS[6], h + lw / 2, BLK); });

    // رأس الجدول
    var HD = { size: 12, weight: 'bold' }, hy2 = 355.7, hy1 = 337.7;
    txt(ctx, 'No.', 44.2, hy2, HD);
    txt(ctx, 'Items', 91, hy2, HD);
    txt(ctx, 'Quantity', COLS[2] + 3, hy2, HD);
    txt(ctx, 'Unit Price', COLS[3] + 3, hy2, HD);
    txt(ctx, 'Price after', COLS[4] + 3, hy1, HD);
    txt(ctx, 'discount', COLS[4] + 3, hy2, HD);
    txt(ctx, 'SI Total', 557.6, hy2, { size: 12, weight: 'bold', align: 'right' });

    // البنود
    var c = function (a, b) { return (COLS[a] + COLS[b]) / 2; };
    y = itemsTop;
    rows.forEach(function (x, idx) {
      var cy = y + x.h / 2, r = x.r, N = { size: 12, align: 'center' };
      txt(ctx, String(idx + 1), c(0, 1), cy, N);
      var top = cy - (x.lines.length - 1) * 7.35;
      x.lines.forEach(function (ln, k) {
        txt(ctx, ln, COLS[1] + 8, top + k * 14.7, itemFont);
      });
      txt(ctx, String(r.qty), c(2, 3), cy, N);
      txt(ctx, 'OMR ' + fmt(r.unit), c(3, 4), cy, N);
      txt(ctx, fmt(r.price), c(4, 5), cy, N);
      txt(ctx, fmt(r.total), c(5, 6), cy, N);
      y += x.h;
    });

    // المجاميع
    var vy = sumTop + SUM_H / 2, gy = sumTop + SUM_H * 1.5;
    txt(ctx, 'VAT =', c(4, 5), vy, { size: 12, align: 'center' });
    txt(ctx, fmt(calc.vat), c(5, 6), vy, { size: 12, align: 'center' });
    txt(ctx, 'Grand', c(3, 4), gy, { size: 12, weight: 'bold', align: 'center' });
    txt(ctx, 'Total =', c(4, 5), gy, { size: 12, weight: 'bold', align: 'center' });
    txt(ctx, fmt(calc.total), c(5, 6), gy, { size: 12, weight: 'bold', align: 'center' });

    /* ---- التذييل ---- */
    var shift = Math.max(0, tEnd - BASE_END);
    var comp = Math.min(Math.max(shift - 36, 0), 50);
    var s2 = shift - comp;
    ctx.save();
    // التذكير + عبارة الأسعار (بلا قص)
    font(ctx, 12, { weight: 'bold' });
    var rw = ctx.measureText('Reminder: ').width;
    txt(ctx, 'Reminder:', 44.5, 470.4 + shift, { size: 12, weight: 'bold', color: GRAY });
    txt(ctx, 'Please include the quote number on your money transfer.', 44.5 + rw, 470.4 + shift, { size: 12, color: GRAY });
    txt(ctx, 'All prices in OMR', 567.2, 470.4 + shift, { size: 14, align: 'right' });

    var FL = { size: 14, weight: 'bold', color: GRAY };
    var labels = ['Bank Name/Branch and Account No:', 'MoF Beneficiary Number =', 'Cheque payment should be payable to'];
    font(ctx, 14, { weight: 'bold' });
    var vx = Math.max(287.4, 44.5 + Math.max.apply(null, labels.map(function (l) { return ctx.measureText(l).width; })) + 8);
    var by = [545, 564.9, 584.6];
    labels.forEach(function (l, i) { txt(ctx, l, 44.5, by[i] + s2, FL); });
    var BV = { size: 14, weight: 'bold' };
    txt(ctx, 'Bank Nizwa/AlKhoud - 004-50003068-001', vx, by[0] + s2, BV);
    txt(ctx, '0012146801', vx, by[1] + s2, BV);
    txt(ctx, 'Sky Innovations or', vx, by[2] + s2, BV);
    font(ctx, 14, { weight: 'bold' });
    var ow = ctx.measureText('Sky Innovations or ').width;
    txt(ctx, 'ابتكارات السماء', vx + ow, by[2] + s2, { size: 14, weight: 'bold', family: TAHOMA, dir: 'rtl' });

    txt(ctx, 'Approved by:', 44.5, 624.3 + s2, FL);
    if (imgs.stamp) ctx.drawImage(imgs.stamp, 243.3, 604.4 + s2, 169.2, 156.4);
    if (imgs.sign) ctx.drawImage(imgs.sign, 68.5, 653.4 + s2, 104.2, 38.1);
    txt(ctx, 'Received by:', 408.6, 664.5 + s2, { size: 14 });
    txt(ctx, '________________________________', 28.7, 689.5 + s2, { size: 12 });
    txt(ctx, 'Sky Innovations', 28.7, 707.2 + s2, { size: 12 });
    ctx.restore();
    txt(ctx, 'Page 1', 297.6, 811.2, { size: 11, align: 'center' });

    ctx.restore();
    return { overflow: 760.8 + s2 > 800, extraLines: Math.max(0, billLines(data.billTo).length - 4) };
  }

  async function toPdf(canvas, title) {
    var blob = await new Promise(function (res) { canvas.toBlob(res, 'image/png'); });
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var doc = await root.PDFLib.PDFDocument.create();
    if (title) doc.setTitle(title);
    var img = await doc.embedPng(bytes);
    var page = doc.addPage([W, H]);
    page.drawImage(img, { x: 0, y: 0, width: W, height: H });
    return doc.save();
  }

  var API = { W: W, H: H, compute: compute, render: render, toPdf: toPdf, fmt: fmt, fmtDate: fmtDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Invoice = API;
})(typeof window !== 'undefined' ? window : globalThis);
