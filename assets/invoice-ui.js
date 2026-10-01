/* invoice-ui.js — واجهة الفاتورة: نموذج + معاينة حيّة + تنزيل PDF.
 * تعبئة مسبقة عبر الرابط: ?bill=...&desc=...&unit=...&price=...&qty=...&quote=... */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var S = 4, imgs = {}, LAST = 'sky:invoice:lastQuote';

  function load(src) {
    return new Promise(function (res) {
      var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src;
    });
  }

  function nextQuote() {
    var y = new Date().getFullYear(), last = '';
    try { last = localStorage.getItem(LAST) || ''; } catch (e) {}
    var m = /^(\d{4})\/(\d+)$/.exec(last);
    return y + '/' + (m && +m[1] === y ? +m[2] + 1 : 1);
  }

  function itemRow(it) {
    it = it || {};
    var d = document.createElement('div');
    d.className = 'inv-item';
    d.innerHTML =
      '<label class="d">Items<input class="num f-desc" style="text-align:left"></label>' +
      '<label>Quantity<input class="num f-qty" inputmode="decimal"></label>' +
      '<label>Unit Price<input class="num f-unit" inputmode="decimal"></label>' +
      '<label>Price after discount<input class="num f-price" inputmode="decimal"></label>' +
      '<span></span><button type="button" class="rm">حذف</button>';
    d.querySelector('.f-desc').value = it.desc || '';
    d.querySelector('.f-qty').value = it.qty == null ? 1 : it.qty;
    d.querySelector('.f-unit').value = it.unit || '';
    d.querySelector('.f-price').value = it.price || '';
    d.querySelector('.rm').onclick = function () { d.remove(); draw(); };
    return d;
  }

  function read() {
    var items = Array.prototype.map.call(document.querySelectorAll('.inv-item'), function (r) {
      return {
        desc: r.querySelector('.f-desc').value, qty: r.querySelector('.f-qty').value,
        unit: r.querySelector('.f-unit').value, price: r.querySelector('.f-price').value
      };
    });
    return {
      quoteNo: $('quoteNo').value.trim(), date: $('date').value, billTo: $('billTo').value,
      tin: $('tin').value.trim(), contact: $('contact').value.trim(),
      customerId: $('customerId').value.trim(), lop: $('lop').value.trim(),
      vatRate: $('vatRate').value, items: items
    };
  }

  var cv = $('cv');
  cv.width = Math.round(Invoice.W * S); cv.height = Math.round(Invoice.H * S);

  function draw() {
    var r = Invoice.render(cv.getContext('2d'), read(), imgs, S), w = [];
    if (r.overflow) w.push('عدد البنود كبير وقد يتجاوز الفاتورة حدود الصفحة.');
    if (r.extraLines) w.push('خانة العميل تتسع لـ 4 أسطر فقط، وما زاد لا يُطبع.');
    $('warn').hidden = !w.length; $('warn').textContent = w.join(' ');
  }

  async function download() {
    var d = read();
    var bytes = await Invoice.toPdf(cv, 'Tax Invoice ' + d.quoteNo);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    a.download = 'فاتورة ' + (d.quoteNo || '').replace(/[\\/:*?"<>|]/g, '-') + '.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    try { if (d.quoteNo) localStorage.setItem(LAST, d.quoteNo); } catch (e) {}
  }

  (async function init() {
    var q = new URLSearchParams(location.search);
    $('quoteNo').value = q.get('quote') || nextQuote();
    $('date').value = q.get('date') || new Date().toISOString().slice(0, 10);
    $('billTo').value = q.get('bill') || '';
    $('tin').value = q.get('tin') || '';
    $('contact').value = q.get('contact') || '';
    $('items').appendChild(itemRow({
      desc: q.get('desc') || 'Qibla direction service for a prayer area in shopping centers',
      qty: q.get('qty') || 1, unit: q.get('unit') || '', price: q.get('price') || ''
    }));
    $('addItem').onclick = function () { $('items').appendChild(itemRow()); draw(); };
    $('dl').onclick = download;
    document.querySelector('.inv-form').addEventListener('input', draw);
    var base = 'assets/invoice/';
    imgs.logo = await load(base + 'logo.png');
    imgs.stamp = await load(base + 'stamp.png');
    imgs.sign = await load(base + 'sign.png');
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    draw();
  })();
})();
