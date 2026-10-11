/* حارس الدخول: يحوّل غير المسجّلين إلى login.html ويضيف شريحة المستخدم والخروج */
(function () {
  var onLogin = /login\.html/.test(location.pathname);
  var f = window.fetch, KEY = 'sky_auth';
  var clear = function () { try { sessionStorage.removeItem(KEY); } catch (e) {} };
  var go = function () {
    clear();
    if (!onLogin) location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
  };
  // أي رد 401 من الخادم يعيد المستخدم لصفحة الدخول (انتهاء الجلسة مثلاً)
  window.fetch = function (input) {
    var url = String(input && input.url || input || '');
    return f.apply(this, arguments).then(function (r) {
      if (r.status === 401 && url.indexOf('/api/login') === -1) go();
      return r;
    });
  };
  window.skyLogout = function () {
    clear();
    f('/api/login', { method: 'POST', credentials: 'same-origin', body: JSON.stringify({ action: 'logout' }) })
      .then(function () { location.href = '/login.html'; });
  };
  if (onLogin) return;

  var chipFor = function (d) {
    var add = function () {
      if (document.querySelector('.auth-chip')) return;
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/assets/auth.css?v=1'; document.head.appendChild(css);
      var chip = document.createElement('div'); chip.className = 'auth-chip';
      var nm = document.createElement('span'); nm.textContent = d.user; chip.appendChild(nm);
      if (d.role === 'admin') { var a = document.createElement('a'); a.href = '/users.html'; a.textContent = 'المستخدمون'; chip.appendChild(a); }
      var b = document.createElement('button'); b.textContent = 'خروج'; b.onclick = window.skyLogout; chip.appendChild(b);
      var nav = document.querySelector('.main-nav');
      if (nav) nav.appendChild(chip); else { chip.className += ' float'; document.body.appendChild(chip); }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
  };

  // نتيجة التحقق تُحفظ 5 دقائق فلا ننتظر الخادم في كل صفحة؛ وأي 401 لاحق يعيدك للدخول
  var cached = null;
  try { cached = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (cached && Date.now() - cached.t < 300000) { chipFor(cached); return; }

  f('/api/login', { credentials: 'same-origin' }).then(function (r) {
    if (r.status === 401) { go(); return null; }
    return r.json();
  }).then(function (d) {
    if (!d || !d.ok) return;
    try { sessionStorage.setItem(KEY, JSON.stringify({ user: d.user, role: d.role, t: Date.now() })); } catch (e) {}
    chipFor(d);
  }).catch(function () {});
})();
