// ============================================================================
// تعديل حالة تقرير قبلة صادر (PDF)
//
// لا يُعاد بناء التقرير: نفتح الملف الأصلي ونستبدل خانات الاختيار وحدها.
// المربع الجديد ليس شكلاً مرسوماً بل نسخة من مربع موجود في التقرير نفسه،
// مقيسة من الصفحة المرسومة، فيخرج مطابقاً لبقية المربعات.
//
// ملاحظة: تقارير القالب الحالي تخرج بخاناتها صحيحة من أداة القبلة مباشرة.
// هذه الصفحة للتقارير القديمة، ولتحديث حالة تقرير صدر سابقاً.
// ============================================================================

(function () {
  const { PDFDocument, rgb } = PDFLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const SCALE = 2;               // دقة العرض على الشاشة
  const CLONE = 6;               // دقة اقتطاع صور المربعات من الأصل
  const CHECKED = '\uF052';      // مربع معلَّم في خط Wingdings 2
  const BOXY = /[\uE000-\uF8FF\u2610\u2611\u25A1\u25A0\u2612]/;

  let originalBytes = null;      // الملف الأصلي كما رُفع — لا يُعدَّل أبداً
  let boxes = [];                // خانات الاختيار المكتشفة
  let stamps = [];               // علامات أضافها المستخدم بالنقر
  let pages = [];                // أبعاد كل صفحة
  let pageCanvases = [];         // الصفحات الأصلية مرسومة بدقة عالية
  let textRows = [];             // مواضع أسطر النص في كل صفحة
  let addMode = false;
  let fileName = 'تقرير';

  const $ = (id) => document.getElementById(id);
  const drop = $('dropzone'), fileInput = $('fileInput'), err = $('errorBox'),
        stages = $('stages'), status = $('workStatus'),
        loadStatus = $('loadStatus'), preview = $('preview'),
        choicesPanel = $('choicesPanel'), previewPanel = $('previewPanel');

  const show = (el, on) => el.classList.toggle('hidden', !on);
  const say = (el, html) => {
    el.innerHTML = html || '';
    el.classList.toggle('show', !!html);
  };
  const fail = (msg) => {
    err.textContent = msg || '';
    err.classList.toggle('show', !!msg);
  };

  // ---------- رفع الملف ----------
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('drag');
    if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', (e) => { if (e.target.files[0]) load(e.target.files[0]); });

  document.getElementById('clearFileBtn').addEventListener('click', () => {
    originalBytes = null; boxes = []; stamps = []; pages = []; textRows = [];
    fileInput.value = '';
    stages.innerHTML = '';
    show(preview, false); show(choicesPanel, false); show(previewPanel, false);
    say(status, ''); say(loadStatus, ''); fail('');
  });

  async function load(file) {
    fail('');
    if (file.type !== 'application/pdf') {
      fail('الملف ليس بصيغة PDF. اختر تقرير قبلة صادراً من الأداة.');
      return;
    }
    fileName = file.name.replace(/\.pdf$/i, '');
    $('fileName').textContent = file.name;
    show(preview, true);
    say(loadStatus, '<span class="spinner"></span> جاري قراءة التقرير...');
    try {
      originalBytes = new Uint8Array(await file.arrayBuffer());
      boxes = []; stamps = []; pages = []; textRows = [];
      await detect();
      findGroups();
      renderControls();
      show(choicesPanel, true);
      show(previewPanel, true);
      await refresh();
      say(loadStatus, '');
    } catch (e) {
      say(loadStatus, '');
      fail('تعذّرت قراءة الملف: ' + (e.message || e));
    }
  }

  // ---------- اكتشاف خانات الاختيار ----------
  // مربعات القالب مرسومة بخط Wingdings 2، فتأتي من pdf.js كعناصر نصية
  // مستقلة تحوي محرفاً واحداً في نطاق الخطوط الخاصة. نلتقطها بمواضعها.
  async function detect() {
    const doc = await pdfjsLib.getDocument({ data: originalBytes.slice() }).promise;
    pageCanvases = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      pages.push({ w: vp.width, h: vp.height });

      // نسخة عالية الدقة من الصفحة الأصلية: منها نقتطع صورة المربع
      // المعلَّم أو الفارغ كما رسمه Word بخط Wingdings، فتخرج الخانة
      // المعدَّلة مطابقة تماماً لبقية الخانات بدل شكل متجه مرسوم يدوياً.
      const hi = page.getViewport({ scale: CLONE });
      const cv = document.createElement('canvas');
      cv.width = hi.width; cv.height = hi.height;
      await page.render({ canvasContext: cv.getContext('2d'), viewport: hi }).promise;
      pageCanvases.push(cv);

      const content = await page.getTextContent();
      const rowsY = [];
      for (const item of content.items) {
        if (!(item.str || '').trim()) continue;
        const tt = pdfjsLib.Util.transform(vp.transform, item.transform);
        const fhh = Math.hypot(tt[2], tt[3]);
        if (fhh < 4) continue;
        const top = tt[5] - fhh * 0.85;
        const w = item.width > 0 ? item.width : fhh;
        let row = rowsY.find((r) => Math.abs(r.y - top) < fhh * 0.6);
        if (!row) { row = { y: top, h: fhh, items: [] }; rowsY.push(row); }
        row.items.push({ x: tt[4], w });
      }
      rowsY.sort((a, b) => a.y - b.y);
      textRows.push(rowsY);

      for (const item of content.items) {
        const s = (item.str || '').trim();
        if (s.length === 0 || s.length > 2 || !BOXY.test(s)) continue;
        const t = pdfjsLib.Util.transform(vp.transform, item.transform);
        const fh = Math.hypot(t[2], t[3]);
        if (fh < 4) continue;
        boxes.push({
          page: p - 1,
          x: t[4],                    // يسار المحرف، أعلى الصفحة = 0
          yTop: t[5] - fh * 0.85,
          w: item.width > 0 ? item.width : fh,
          h: fh,
          was: s.indexOf(CHECKED) >= 0 || s.indexOf('\u2611') >= 0 || s.indexOf('\u2612') >= 0,
          now: null,
        });
      }
    }
    refineAll();
    boxes.forEach((b) => { b.now = b.was; });
    say(status, boxes.length
      ? 'عُثر على ' + boxes.length + ' خانة في التقرير.'
      : 'لم يُعثر على خانات — استخدم «إضافة علامة بالنقر».');
  }

  // ---------- بناء نسخة معدّلة ----------
  // بلا هامش: القصاصة حدود المربع بالضبط. أي هامش يلتقط طرف الحرف
  // المجاور للمصدر فينتقل ملصقاً بجانب المربع الجديد.
  const PAD = 0;

  // --------------------------------------------------------------------
  // قياس صندوق الحبر الفعلي
  // موضع المحرف المستنتج من بيانات النص تقريبي: يزيح المسح عن المربع
  // الملصوق فيبدو مربعان. لذا نقيس المربع من الصفحة المرسومة نفسها —
  // نبحث في نافذة صغيرة حوله عن كتلة البكسلات الداكنة الأقرب إلى مربع.
  // --------------------------------------------------------------------
  function refine(box) {
    const cv = pageCanvases[box.page];
    const ctx = cv.getContext('2d');
    const wx = Math.max(0, Math.round((box.x - box.w * 0.35) * CLONE));
    const wy = Math.max(0, Math.round((box.yTop - box.h * 0.6) * CLONE));
    const ww = Math.min(cv.width - wx, Math.round(box.w * 1.7 * CLONE));
    const wh = Math.min(cv.height - wy, Math.round(box.h * 2.2 * CLONE));
    if (ww < 4 || wh < 4) return false;

    const d = ctx.getImageData(wx, wy, ww, wh).data;
    const lum = new Float32Array(ww * wh);
    for (let i = 0; i < ww * wh; i++) {
      lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    }
    const sorted = Float32Array.from(lum).sort();
    const bright = sorted[Math.floor(sorted.length * 0.75)];
    const cut = bright - 60;

    const seen = new Uint8Array(ww * wh);
    const cx = ww / 2, cy = wh / 2;
    const target = box.h * CLONE;
    let best = null;
    const comps = [];

    for (let p0 = 0; p0 < ww * wh; p0++) {
      if (seen[p0] || lum[p0] >= cut) continue;
      let x0 = ww, x1 = -1, y0 = wh, y1 = -1, n = 0;
      const cells = [];
      const stack = [p0];
      seen[p0] = 1;
      while (stack.length) {
        const q = stack.pop();
        const qx = q % ww, qy = (q - qx) / ww;
        cells.push(q);
        n++;
        if (qx < x0) x0 = qx; if (qx > x1) x1 = qx;
        if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
        const nb = [q - 1, q + 1, q - ww, q + ww];
        for (const r of nb) {
          if (r < 0 || r >= ww * wh || seen[r] || lum[r] >= cut) continue;
          if ((r === q - 1 && qx === 0) || (r === q + 1 && qx === ww - 1)) continue;
          seen[r] = 1;
          stack.push(r);
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      comps.push({ x0, y0, x1, y1, n });
      if (n < 8 || bw < target * 0.35 || bh < target * 0.35) continue;
      if (bw > target * 1.8 || bh > target * 1.8) continue;
      const square = Math.abs(bw / bh - 1);
      const dist = Math.hypot((x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy) / target;
      const score = square * 2 + dist;
      if (!best || score < best.score) best = { score, x0, y0, bw, bh, cells, ww };
    }
    if (!best) return false;

    box.ix = wx / CLONE + best.x0 / CLONE;
    box.iy = wy / CLONE + best.y0 / CLONE;
    box.iw = best.bw / CLONE;
    box.ih = best.bh / CLONE;
    // القناع = كل بكسل داكن داخل حدود المربع، لا كتلته المتصلة وحدها:
    // علامة الصح كتلة منفصلة عن الإطار، فلو اقتصرنا على الإطار بقيت
    // العلامة القديمة ظاهرة تحت الجديدة. وما خارج الحدود — كحرف مجاور —
    // يبقى بمنأى عن الطلاء.
    // حدود المسح: نبدأ من الإطار ونتمدد سطراً سطراً ما دام فيه حبر،
    // ونقف عند أول فراغ أبيض. فتُلتقط شظايا المحرف الملاصقة له مهما
    // صغرت، ويحول الفراغ بيننا وبين الحرف المجاور دون بلوغه.
    const GAP = Math.max(2, Math.round(target * 0.06));   // فراغ يُعدّ فاصلاً
    const LIMIT = Math.round(target * 0.5);               // سقف التمدد
    const dark = (x, y) => x >= 0 && y >= 0 && x < ww && y < wh && lum[y * ww + x] < cut;
    let ex0 = best.x0, ey0 = best.y0;
    let ex1 = best.x0 + best.bw - 1, ey1 = best.y0 + best.bh - 1;

    const grow = (axis, dir) => {
      let blank = 0;
      for (let step = 0; step < LIMIT; step++) {
        const at = axis === 'x' ? (dir < 0 ? ex0 - 1 : ex1 + 1) : (dir < 0 ? ey0 - 1 : ey1 + 1);
        let any = false;
        if (axis === 'x') {
          for (let y = ey0; y <= ey1 && !any; y++) any = dark(at, y);
        } else {
          for (let x = ex0; x <= ex1 && !any; x++) any = dark(x, at);
        }
        blank = any ? 0 : blank + 1;
        if (blank > GAP) return;
        if (axis === 'x') { if (dir < 0) ex0--; else ex1++; }
        else { if (dir < 0) ey0--; else ey1++; }
      }
    };
    grow('x', -1); grow('x', 1); grow('y', -1); grow('y', 1);
    // نتراجع عن الفراغ الذي عبرناه بحثاً عن حبر
    const trim = (axis, dir) => {
      for (let step = 0; step < LIMIT; step++) {
        const at = axis === 'x' ? (dir < 0 ? ex0 : ex1) : (dir < 0 ? ey0 : ey1);
        let any = false;
        if (axis === 'x') {
          for (let y = ey0; y <= ey1 && !any; y++) any = dark(at, y);
        } else {
          for (let x = ex0; x <= ex1 && !any; x++) any = dark(x, at);
        }
        if (any) return;
        if (axis === 'x') { if (dir < 0) ex0++; else ex1--; }
        else { if (dir < 0) ey0++; else ey1--; }
      }
    };
    trim('x', -1); trim('x', 1); trim('y', -1); trim('y', 1);

    // ارتفاع الإطار وحده: أطول تتابع داكن في العمود الأيسر من حدود
    // المربع. طرف علامة الصح يبرز أعلى ويميناً ولا يمتد يسار الإطار،
    // فهذا القياس صالح للمربعين معاً — به نوحّد الحجم مهما اختلف
    // حجم خط الصف الذي جاء منه المصدر.
    (function () {
      const col = best.x0;
      let run = 0, bestRun = 0, start = 0, bestStart = 0;
      for (let y = best.y0; y < best.y0 + best.bh; y++) {
        if (lum[y * ww + col] < cut) {
          if (run === 0) start = y;
          run++;
          if (run > bestRun) { bestRun = run; bestStart = start; }
        } else run = 0;
      }
      box.fh = (bestRun || best.bh) / CLONE;
      box.fy0 = ((bestRun ? bestStart : best.y0) - best.y0) / CLONE;

      // عرض الإطار من الصف السفلي: الحافة السفلى للإطار وحده،
      // والبروز في الأعلى يميناً فلا يفسدها.
      const row = best.y0 + best.bh - 1;
      let r2 = 0, b2 = 0, st2 = 0, bs2 = 0;
      for (let x = best.x0; x < best.x0 + best.bw; x++) {
        if (lum[row * ww + x] < cut) {
          if (r2 === 0) st2 = x;
          r2++;
          if (r2 > b2) { b2 = r2; bs2 = st2; }
        } else r2 = 0;
      }
      box.fw = (b2 || best.bw) / CLONE;
      box.fx0 = ((b2 ? bs2 : best.x0) - best.x0) / CLONE;
    })();

    box.ex = (wx + ex0) / CLONE;
    box.ey = (wy + ey0) / CLONE;
    box.ew = (ex1 - ex0 + 1) / CLONE;
    box.eh = (ey1 - ey0 + 1) / CLONE;
    box.mask = { w: best.bw, h: best.bh, set: new Uint8Array(best.bw * best.bh) };
    for (let j = 0; j < best.bh; j++) {
      for (let i = 0; i < best.bw; i++) {
        if (lum[(best.y0 + j) * ww + (best.x0 + i)] < cut) {
          box.mask.set[j * best.bw + i] = 1;
        }
      }
    }
    return true;
  }

  function refineAll() {
    boxes.forEach((b) => {
      if (!refine(b)) {
        b.ix = b.x; b.iy = b.yTop; b.iw = b.w; b.ih = b.h;
        b.ex = b.x; b.ey = b.yTop; b.ew = b.w; b.eh = b.h;
        b.fh = b.h; b.fy0 = 0; b.fw = b.w; b.fx0 = 0;
      }
      b.ink = b.virtual ? null : inkOf(b);
    });
  }

  // لون خلفية الخلية حول المربع: عيّنة من إطار حوله، نأخذ شريحتها الفاتحة
  // كي لا يفسدها حرف نص مجاور.

  // لون حبر المربع كما هو في الوثيقة: متوسط أغمق ربع من بكسلاته.
  // صفوف القالب تستعمل زرقاً مختلفاً (002060 للجاهزية · 0070C0 للحالة)،
  // فنلوّن المربع المستنسخ بلون هدفه لا بلون مصدره.
  function inkOf(box) {
    const cv = pageCanvases[box.page];
    const x = Math.max(0, Math.round(box.ix * CLONE));
    const y = Math.max(0, Math.round(box.iy * CLONE));
    const w = Math.min(cv.width - x, Math.round(box.iw * CLONE));
    const h = Math.min(cv.height - y, Math.round(box.ih * CLONE));
    if (w < 2 || h < 2) return null;
    const d = cv.getContext('2d').getImageData(x, y, w, h).data;
    const px = [];
    for (let k = 0; k < d.length; k += 4) {
      px.push([d[k], d[k + 1], d[k + 2], 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]]);
    }
    px.sort((a, b) => a[3] - b[3]);
    const take = Math.max(1, Math.round(px.length * 0.12));
    const sum = [0, 0, 0];
    for (let i = 0; i < take; i++) for (let c = 0; c < 3; c++) sum[c] += px[i][c];
    return sum.map((v) => Math.round(v / take));
  }

  function bgOf(box) {
    const cv = pageCanvases[box.page];
    const ctx = cv.getContext('2d');
    // إطار ضيق ملاصق للمربع: أبعد منه يلامس الصف المجاور فيلتقط لونه
    const m = box.ih * 0.28;
    const x = Math.max(0, Math.round((box.ix - m) * CLONE));
    const y = Math.max(0, Math.round((box.iy - m) * CLONE));
    const w = Math.min(cv.width - x, Math.round((box.iw + m * 2) * CLONE));
    const h = Math.min(cv.height - y, Math.round((box.ih + m * 2) * CLONE));
    if (w < 2 || h < 2) return [255, 255, 255];
    const d = ctx.getImageData(x, y, w, h).data;
    // اللون الأكثر تكراراً على الإطار هو الخلفية، مهما جاوره من حبر
    const tally = new Map();
    const edge = Math.max(1, Math.round(Math.min(w, h) * 0.14));
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (i > edge && i < w - edge && j > edge && j < h - edge) continue;
        const k = (j * w + i) * 4;
        const key = (d[k] >> 3) * 4096 + (d[k + 1] >> 3) * 64 + (d[k + 2] >> 3);
        const cur = tally.get(key);
        if (cur) { cur.n++; }
        else tally.set(key, { n: 1, c: [d[k], d[k + 1], d[k + 2]] });
      }
    }
    let best = null;
    const comps = [];
    tally.forEach((v) => { if (!best || v.n > best.n) best = v; });
    return best ? best.c : [255, 255, 255];
  }

  // ننسخ المحرف بخلفية شفافة: كل بكسل يُقاس بعتامته مقابل خلفية مصدره،
  // فينتقل الحبر وحده ولا ينتقل لون صف إلى صف آخر.
  function cropGlyph(box, tint, boost) {
    const cv = pageCanvases[box.page];
    const bg = bgOf(box);
    const m = box.ih * PAD;
    const sx = Math.max(0, (box.ix - m) * CLONE);
    const sy = Math.max(0, (box.iy - m) * CLONE);
    const sw = (box.iw + m * 2) * CLONE;
    const sh = (box.ih + m * 2) * CLONE;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(sw));
    out.height = Math.max(1, Math.round(sh));
    const octx = out.getContext('2d');
    octx.drawImage(cv, sx, sy, sw, sh, 0, 0, out.width, out.height);
    const img = octx.getImageData(0, 0, out.width, out.height);
    const d = img.data;
    // العتامة تُقاس ببُعد البكسل عن الخلفية منسوباً إلى بُعد الحبر عنها.
    // قياسها بالإضاءة وحدها كان يبخسها لأن حبر القالب أزرق لا أسود،
    // فيخرج المربع الملصوق شاحباً.
    const ink = box.ink || [0, 0, 0];
    const span = Math.max(
      1,
      Math.hypot(ink[0] - bg[0], ink[1] - bg[1], ink[2] - bg[2]),
    );
    for (let k = 0; k < d.length; k += 4) {
      const dist = Math.hypot(d[k] - bg[0], d[k + 1] - bg[1], d[k + 2] - bg[2]);
      const a = Math.max(0, Math.min(1, dist / span));
      if (a < 0.02) { d[k + 3] = 0; continue; }
      for (let c = 0; c < 3; c++) {
        const v = tint ? tint[c] : ink[c];
        d[k + c] = Math.max(0, Math.min(255, Math.round(v)));
      }
      d[k + 3] = Math.round((boost ? Math.min(1, a * boost) : a) * 255);
    }
    octx.putImageData(img, 0, 0);
    return out.toDataURL('image/png');
  }


  // قناع مسح بشكل المربع القديم بالضبط: بكسلاته وحدها، متمددة قليلاً
  // لابتلاع حواف التنعيم، ومعتمة تماماً فلا يبقى منه طيف.
  const ERASE_GROW = 3;
  function eraseMaskPNG(box, bg) {
    const m = box.mask;
    const R = ERASE_GROW;
    const w = m.w + R * 2, h = m.h + R * 2;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let j = 0; j < m.h; j++) {
      for (let i = 0; i < m.w; i++) {
        if (!m.set[j * m.w + i]) continue;
        for (let dj = -R; dj <= R; dj++) {
          for (let di = -R; di <= R; di++) {
            if (di * di + dj * dj > R * R) continue;
            const k = ((j + R + dj) * w + (i + R + di)) * 4;
            d[k] = bg[0]; d[k + 1] = bg[1]; d[k + 2] = bg[2]; d[k + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return out.toDataURL('image/png');
  }

  function pickSource(target, wantChecked) {
    const same = boxes.filter((b) => !b.virtual && b.was === wantChecked);
    if (!same.length) return null;
    const onPage = same.filter((b) => b.page === target.page);
    const pool = onPage.length ? onPage : same;
    // نفضّل مربعاً بلون حبر وحجم مقاربين للهدف، ثم الأقرب رأسياً.
    const score = (b) => {
      const dc = target.ink && b.ink
        ? Math.hypot(...[0, 1, 2].map((c) => target.ink[c] - b.ink[c])) / 40
        : 0;
      const ds = Math.abs(b.fh - target.fh) / Math.max(0.01, target.fh) * 8;
      return dc + ds + Math.abs(b.iy - target.iy) / 400;
    };
    return pool.slice().sort((a, b) => score(a) - score(b))[0];
  }


  // مقاس الإطار المرجعي: يُؤخذ من أقرب مربع فارغ في الوثيقة. حدود
  // المربع المعلَّم يزيحها بروز علامة الصح فلا تصلح مقياساً، أما الفارغ
  // فحدوده إطاره تماماً. بهذا يخرج المربعان بحجم واحد.
  function refFrame(target) {
    const clean = boxes.filter((b) => !b.virtual && b.was === false && b.fh);
    if (!clean.length) return target.fh;
    return clean.slice().sort(
      (a, b) => Math.abs(a.iy - target.iy) - Math.abs(b.iy - target.iy),
    )[0].fh;
  }

  async function build() {
    const pdf = await PDFDocument.load(originalBytes.slice());
    const list = pdf.getPages();
    const cache = new Map();
    let missing = false;

    const paste = async (target, source, erase) => {
      const tint = target.ink || source.ink || null;
      const key = boxes.indexOf(source) + '|' + (tint ? tint.join(',') : '');
      let img = cache.get(key);
      if (!img) {
        img = await pdf.embedPng(cropGlyph(source, tint));
        cache.set(key, img);
      }
      const page = list[target.page];
      const H = page.getSize().height;
      // نلصق المربع بمقاسه الطبيعي كما هو في الوثيقة، لا بمقاس هدفه:
      // حدود المربع المعلَّم أكبر لأن طرف علامة الصح يبرز فوقه، فالقياس
      // إليها كان يكبّر المربع الفارغ. نحاذي بالحافتين اليسرى والسفلى
      // لأنهما للإطار وحده، والبروز في الأعلى يميناً.
      // نكبّر أو نصغّر المصدر حتى يساوي إطاره إطار الهدف، ثم نطابق
      // مركزَي الإطارين أفقياً ورأسياً. المركز أثبت من الحافة: بروز
      // علامة الصح يزيح حدود المربع المعلَّم دون أن يزيح إطاره.
      const k = refFrame(target) / source.fh;
      const cx = target.ix + target.fx0 + target.fw / 2;
      const cy = target.iy + target.fy0 + target.fh / 2;
      const left = cx - (source.fx0 + source.fw / 2) * k;
      const top = cy - (source.fy0 + source.fh / 2) * k;
      const rect = {
        x: left,
        y: H - (top + source.ih * k),
        width: source.iw * k,
        height: source.ih * k,
      };
      if (erase) {
        // نطلي حدود المربع المقيسة كاملة بلون خلفيته. القناع بالشكل ترك
        // حواف التنعيم الفاتحة حول العلامة القديمة فبقي منها طيف؛ والحدود
        // هنا حدود المحرف نفسه، فلا يقع فيها حرف مجاور.
        const bg = bgOf(target);
        const g = 2 / CLONE;
        page.drawRectangle({
          x: target.ex - g,
          y: H - (target.ey + target.eh + g),
          width: target.ew + g * 2,
          height: target.eh + g * 2,
          color: rgb(bg[0] / 255, bg[1] / 255, bg[2] / 255),
        });
      }
      page.drawImage(img, rect);
    };

    for (const b of boxes) {
      if (b.now === b.was) continue;
      const src = pickSource(b, b.now);
      if (!src) { missing = true; continue; }
      await paste(b, src, !b.virtual);
    }

    const tick = boxes.find((b) => !b.virtual && b.was === true);
    for (const st of stamps) {
      if (!tick) { missing = true; break; }
      await paste(
        { page: st.page, ix: st.x, iy: st.yTop, iw: st.size, ih: st.size },
        tick, false,
      );
    }

    if (missing) {
      fail('لا يوجد في التقرير مربع بالحالة المطلوبة لاستنساخه، فتُركت بعض الخانات كما هي.');
    }
    return pdf.save();
  }

  // ---------- المعاينة ----------
  // نعيد عرض الملف بعد التعديل لا قبله، فما تراه هو ما سيُنزَّل بالضبط.
  let busy = false;
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      fail('');
      const bytes = await build();
      const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      stages.innerHTML = '';
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

        const stage = document.createElement('div');
        stage.className = 'stage' + (addMode ? ' is-adding' : '');
        stage.appendChild(canvas);
        stage.dataset.page = p - 1;
        stages.appendChild(stage);

        boxes.forEach((b, i) => {
          if (b.page !== p - 1) return;
          const m = document.createElement('button');
          m.className = 'box-mark' + (b.now ? ' is-set' : '');
          m.title = b.now ? 'معلَّمة — انقر لإزالة العلامة' : 'فارغة — انقر للتعليم';
          m.style.cssText = `right:${(vp.width - (b.ix + b.iw) * SCALE) / vp.width * 100}%;
            top:${b.iy * SCALE / vp.height * 100}%;
            width:${b.iw * SCALE / vp.width * 100}%;
            height:${b.ih * SCALE / vp.height * 100}%;`;
          m.addEventListener('click', (e) => {
            e.stopPropagation();
            boxes[i].now = !boxes[i].now;
            renderControls();
            refresh();
          });
          stage.appendChild(m);
        });

        stamps.forEach((s, i) => {
          if (s.page !== p - 1) return;
          const m = document.createElement('button');
          m.className = 'box-mark is-added';
          m.title = 'علامة مضافة — انقر لحذفها';
          m.style.cssText = `right:${(vp.width - (s.x + s.size) * SCALE) / vp.width * 100}%;
            top:${s.yTop * SCALE / vp.height * 100}%;
            width:${s.size * SCALE / vp.width * 100}%;
            height:${s.size * SCALE / vp.height * 100}%;`;
          m.addEventListener('click', (e) => {
            e.stopPropagation();
            stamps.splice(i, 1);
            refresh();
          });
          stage.appendChild(m);
        });

        stage.addEventListener('click', (e) => {
          if (!addMode) return;
          const r = stage.getBoundingClientRect();
          const size = 9;
          stamps.push({
            page: p - 1,
            x: (e.clientX - r.left) / r.width * pages[p - 1].w - size / 2,
            yTop: (e.clientY - r.top) / r.height * pages[p - 1].h - size / 2,
            size,
          });
          refresh();
        });
      }
      lastBytes = bytes;
    } catch (e) {
      fail('تعذّر بناء الملف المعدّل: ' + (e.message || e));
    }
    busy = false;
  }

  let lastBytes = null;

  // ---------- المجموعتان ----------
  // نستنتج الصفوف هندسياً: مربعات بارتفاع متقارب تنتمي إلى صف واحد.
  // صف حالة طلب الخدمة هو الوحيد بثلاث خانات، وترتيبها يمنة إلى يسرة:
  // أولي ثم جاهز ثم مكتمل. وصفا الجاهزية مفردان تحته: الأعلى «غير جاهز».
  let groups = { status: [], ready: [] };

  function findGroups() {
    const rows = [];
    boxes.forEach((b, i) => {
      const row = rows.find((r) => b.page === r.page && Math.abs(r.y - b.yTop) < b.h * 0.8);
      if (row) row.idx.push(i);
      else rows.push({ page: b.page, y: b.yTop, idx: [i] });
    });
    rows.sort((a, b) => a.page - b.page || a.y - b.y);

    const three = rows.filter((r) => r.idx.length === 3).pop();
    groups.status = three
      ? three.idx.slice().sort((a, b) => boxes[b].x - boxes[a].x)   // يمين ← يسار
      : [];

    const singles = rows.filter((r) => r.idx.length === 1 && (!three || r.y > three.y));
    if (singles.length >= 2) {
      groups.ready = singles.slice(-2).map((r) => r.idx[0]);        // أعلى ثم أسفل
    } else if (singles.length === 1) {
      // القالب يرسم مربعاً واحداً فقط في هذا الصف، والسطر الثاني
      // «جاهز للشروع بالبناء» بلا مربع. ننشئ له خانة افتراضية على
      // السطر التالي بالمحاذاة نفسها؛ عند اختيارها يُلصق مربع معلَّم
      // مستنسخ من الوثيقة في موضعها.
      const real = boxes[singles[0].idx[0]];
      const rows = textRows[real.page] || [];
      const row1 = rows.find((r) => Math.abs(r.y - real.yTop) < real.h * 0.9);
      const row2 = rows.find((r) => r.y > real.yTop + real.h * 0.4);
      if (row2) {
        // المحاذاة الأفقية نفسها التي للمربع الحقيقي فوقه: الصف عمود
        // واحد، والقصاصة بلا هامش فلا تمس نص السطر.
        boxes.push({
          page: real.page,
          ix: real.ix,
          iy: real.iy + (row2.y - (row1 ? row1.y : real.yTop)),
          iw: real.iw, ih: real.ih, ink: real.ink,
          fh: real.fh, fy0: real.fy0, fw: real.fw, fx0: real.fx0,
          was: false, now: false, virtual: true,
        });
        groups.ready = [singles[0].idx[0], boxes.length - 1];
      } else {
        groups.ready = [singles[0].idx[0]];
      }
    } else {
      groups.ready = [];
    }
  }

  function renderGroup(el, idx, labels, note) {
    el.innerHTML = '';
    if (idx.length < labels.length) {
      const n = document.createElement('span');
      n.className = 'choice-note';
      n.textContent = note;
      el.appendChild(n);
      if (!idx.length) return;
    }
    idx.forEach((boxIndex, k) => {
      const btn = document.createElement('button');
      btn.textContent = labels[k] || 'خانة ' + (k + 1);
      btn.type = 'button';
      btn.className = 'choice' + (boxes[boxIndex].now ? ' is-on' : '');
      btn.addEventListener('click', () => {
        idx.forEach((j) => { boxes[j].now = false; });
        boxes[boxIndex].now = true;
        renderControls();
        refresh();
      });
      el.appendChild(btn);
    });
  }

  function renderControls() {
    renderGroup($('groupStatus'), groups.status, ['أولي', 'جاهز', 'مكتمل'],
      'لم يُعثر على صف الحالة الثلاثي — عيّن الخانات بالنقر على المعاينة.');
    renderGroup($('groupReady'), groups.ready,
      ['غير جاهز للبناء', 'جاهز للشروع بالبناء'],
      'خانة واحدة فقط ظاهرة في هذا الصف — أضف الثانية بزر «إضافة علامة بالنقر».');
  }

  $('addMarkBtn').addEventListener('click', (e) => {
    addMode = !addMode;
    e.currentTarget.textContent = addMode
      ? 'إيقاف إضافة العلامات'
      : 'إضافة علامة بالنقر';
    document.querySelectorAll('.stage')
      .forEach((s) => s.classList.toggle('is-adding', addMode));
  });

  $('resetBtn').addEventListener('click', () => {
    refineAll();
    boxes.forEach((b) => { b.now = b.was; });
    stamps = [];
    say(status, 'أُعيدت الخانات إلى حالتها الأصلية.');
    renderControls();
    refresh();
  });

  $('downloadBtn').addEventListener('click', async () => {
    if (!lastBytes) return;
    const blob = new Blob([lastBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName + ' - معدّل.pdf';
    a.click();
    URL.revokeObjectURL(url);
  });
})();