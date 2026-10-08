/* sketch-chat.js — محادثة تصحيح قراءة الكروكي مع Claude.
 * بعد القراءة بالذكاء الاصطناعي يكتب المستخدم ما يراه خطأً (مثلاً: «في الكروكي
 * 5 نقاط»)، فيعيد Claude النظر في الصورة نفسها ويُرجع القراءة المصحَّحة،
 * وتُطبَّق فوراً على الحقول عبر apply() التي يمرّرها app.js.
 *
 * start({ after, history, send, parse, apply, onSummary })
 *   after:   عنصر تُدرج المحادثة بعده
 *   history: [{role:'user',text}, {role:'assistant',text}] — القراءة الأولى
 *   send:    (messages) => Promise<string>   نداء الخادم
 *   parse:   (text) => object                تفسير JSON
 *   apply:   (parsed) => string              يملأ الحقول ويعيد الملخص
 */
(function () {
  'use strict';

  var MAX_TURNS = 6;
  var SUFFIX =
    '\n\n— هذه ملاحظة من المستخدم على قراءتك السابقة. أعد النظر في الصورة نفسها ' +
    'وتحقق من الملاحظة مقابل ما هو مكتوب فعلاً قبل أي تعديل؛ فإن لم تؤيدها الصورة ' +
    'فأبقِ قراءتك وفسّر السبب. أعد الرد بنفس صيغة JSON السابقة كاملة (كل النقاط ' +
    'لا المتغيّرة فقط) مع حقل إضافي "reply": جملة عربية قصيرة تذكر ما عدّلته أو ' +
    'سبب عدم التعديل. JSON فقط بلا أي نص آخر.';

  var CSS =
    '.sc{margin-top:16px;padding:14px;border:1px solid var(--line,rgba(148,163,184,.14));' +
    'border-radius:var(--radius-sm,12px);background:var(--surface-1,#0c121f)}' +
    '.sc-head{font-weight:600;margin-bottom:2px}' +
    '.sc-hint{display:block;font-size:.8rem;opacity:.7;margin-bottom:10px}' +
    '.sc-log{display:flex;flex-direction:column;gap:8px;max-height:240px;overflow:auto;margin-bottom:10px}' +
    '.sc-log:empty{display:none}' +
    '.sc-msg{padding:8px 12px;border-radius:12px;font-size:.9rem;line-height:1.7;max-width:92%;white-space:pre-wrap}' +
    '.sc-me{align-self:flex-start;background:rgba(223,182,104,.14)}' +
    '.sc-ai{align-self:flex-end;background:rgba(148,163,184,.12)}' +
    '.sc-err{color:#f87171}' +
    '.sc-row{display:flex;gap:8px}' +
    '.sc-in{flex:1;min-width:0;padding:9px 10px;border-radius:8px;border:1px solid var(--line,rgba(148,163,184,.14));' +
    'background:transparent;color:inherit;font:inherit}' +
    '.sc-send{padding:9px 16px;border-radius:8px;border:0;cursor:pointer;font:inherit;font-weight:600;' +
    'background:var(--gold,#dfb668);color:#070b14}' +
    '.sc-send:disabled,.sc-in:disabled{opacity:.5;cursor:default}';

  var root = null, state = null, busy = false;

  function injectCss() {
    if (document.getElementById('sc-css')) return;
    var st = document.createElement('style');
    st.id = 'sc-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  function reset() {
    if (root) { root.remove(); root = null; }
    state = null; busy = false;
  }

  function bubble(log, text, cls) {
    var d = document.createElement('div');
    d.className = 'sc-msg ' + cls;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  function countPoints(parsed) {
    return (Array.isArray(parsed.points) ? parsed.points : []).filter(function (p) {
      return Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]);
    }).length;
  }

  function start(opts) {
    reset();
    injectCss();
    state = { opts: opts, history: opts.history.slice(), turns: 0 };

    root = document.createElement('div');
    root.className = 'sc';
    root.innerHTML =
      '<div class="sc-head">صحّح القراءة مع Claude</div>' +
      '<span class="sc-hint">إن أخطأت القراءة فأخبره، مثل: «في الكروكي 5 نقاط» أو «النقطة الثالثة خطأ». سيعيد النظر في الصورة ويحدّث الحقول مباشرة.</span>' +
      '<div class="sc-log"></div>' +
      '<div class="sc-row"><input class="sc-in" type="text" placeholder="اكتب ملاحظتك هنا…" maxlength="500">' +
      '<button type="button" class="sc-send">إرسال</button></div>';
    opts.after.insertAdjacentElement('afterend', root);

    var log = root.querySelector('.sc-log'),
        input = root.querySelector('.sc-in'),
        btn = root.querySelector('.sc-send');

    function lock(v) { busy = v; input.disabled = v; btn.disabled = v; }

    async function submit() {
      var text = input.value.trim();
      if (!text || busy || !state) return;
      if (state.turns >= MAX_TURNS) {
        bubble(log, 'بلغت الحد الأقصى من التصحيحات لهذه الصورة. أعد رفعها للبدء من جديد، أو عدّل الأرقام يدوياً.', 'sc-ai sc-err');
        return;
      }
      input.value = '';
      bubble(log, text, 'sc-me');
      lock(true);
      var wait = bubble(log, 'جاري إعادة النظر في الصورة…', 'sc-ai');
      var msgs = state.history.concat([{ role: 'user', text: text + SUFFIX }]);
      try {
        var raw = await opts.send(msgs);
        var parsed = opts.parse(raw);
        var before = state.last != null ? state.last : null;
        var summary = opts.apply(parsed);
        if (opts.onSummary) opts.onSummary(summary);
        state.history = msgs.concat([{ role: 'assistant', text: raw }]);
        state.turns++;
        var n = countPoints(parsed);
        var reply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : 'تم تحديث القراءة.';
        wait.textContent = reply + '\nعدد النقاط الآن: ' + n;
        state.last = n;
      } catch (err) {
        wait.className = 'sc-msg sc-ai sc-err';
        wait.textContent = 'تعذّر التصحيح: ' + (err && err.message ? err.message : 'خطأ غير معروف');
      }
      lock(false);
      input.focus();
    }

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); }
    });
  }

  window.SketchChat = { start: start, reset: reset };
})();
