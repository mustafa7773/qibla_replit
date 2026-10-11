const A = require('./_auth');
const body = req => typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.AUTH_SECRET) return res.status(500).json({ ok: false, error: 'AUTH_SECRET غير مضبوط في Vercel' });

  if (req.method === 'GET') {
    const s = await A.requireAuth(req, { setHeader() {}, status: () => ({ json() {} }) });
    return s ? res.json({ ok: true, user: s.u, role: s.r }) : res.status(401).json({ ok: false });
  }
  if (req.method !== 'POST') return res.status(405).end();
  const b = body(req);

  if (b.action === 'logout') { A.setCookie(res, '', 0); return res.json({ ok: true }); }

  // تغيير كلمة مرور الحساب الحالي
  if (b.action === 'change') {
    const s = await A.requireAuth(req, res); if (!s) return;
    if (s.v) return res.status(400).json({ ok: false, error: 'حساب المدير الرئيسي يُغيَّر من متغيّرات Vercel' });
    const raw = await A.redis('HGET', 'sky:users', s.u); const u = JSON.parse(raw);
    if (!A.checkPw(String(b.old || ''), u.hash)) return res.status(401).json({ ok: false, error: 'كلمة المرور الحالية غير صحيحة' });
    if (String(b.password || '').length < 10) return res.status(400).json({ ok: false, error: 'كلمة المرور الجديدة 10 أحرف على الأقل' });
    u.hash = A.hashPw(b.password);
    await A.redis('HSET', 'sky:users', s.u, JSON.stringify(u));
    await A.log(req, s.u, true, 'تغيير كلمة المرور');
    return res.json({ ok: true });
  }

  const user = String(b.username || '').trim().toLowerCase().slice(0, 40);
  const pw = String(b.password || '').slice(0, 200);
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const key = `sky:rl:${ip}:${user}`;
  const n = await A.redis('INCR', key);
  if (n === 1) await A.redis('EXPIRE', key, 900);
  if (n > 5) return res.status(429).json({ ok: false, error: 'محاولات كثيرة، أعد المحاولة بعد 15 دقيقة' });

  let role = null, env = false;
  const adminU = (process.env.ADMIN_USER || '').toLowerCase();
  if (adminU && A.eq(user, adminU) && A.eq(pw, process.env.ADMIN_PASSWORD || '\0')) { role = 'admin'; env = true; }
  else {
    const raw = await A.redis('HGET', 'sky:users', user);
    if (raw) { const u = JSON.parse(raw); if (A.checkPw(pw, u.hash)) role = u.role || 'user'; }
  }
  if (!role) { await A.log(req, user, false, 'فشل الدخول'); return res.status(401).json({ ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }); }
  await A.redis('DEL', key);
  await A.log(req, user, true, 'دخول');
  A.setCookie(res, A.makeToken(user, role, env));
  res.json({ ok: true, user, role });
};
