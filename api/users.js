const A = require('./_auth');
module.exports = async (req, res) => {
  const s = await A.requireAuth(req, res, true); if (!s) return;
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  if (req.method === 'GET') {
    if (req.query && req.query.log) {
      const l = await A.redis('LRANGE', 'sky:authlog', 0, 99) || [];
      return res.json({ ok: true, log: l.map(x => JSON.parse(x)) });
    }
    const all = await A.redis('HGETALL', 'sky:users') || [];
    const users = []; for (let i = 0; i < all.length; i += 2) users.push({ username: all[i], role: JSON.parse(all[i + 1]).role });
    return res.json({ ok: true, users });
  }
  const user = String(b.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(user)) return res.status(400).json({ ok: false, error: 'اسم المستخدم: أحرف إنجليزية وأرقام، 3 على الأقل' });

  if (req.method === 'DELETE') {
    if (user === s.u) return res.status(400).json({ ok: false, error: 'لا يمكنك حذف حسابك' });
    await A.redis('HDEL', 'sky:users', user);
    await A.log(req, s.u, true, 'حذف الحساب ' + user);
    return res.json({ ok: true });
  }
  if (req.method === 'POST') { // إنشاء أو إعادة تعيين كلمة المرور
    if (String(b.password || '').length < 10) return res.status(400).json({ ok: false, error: 'كلمة المرور 10 أحرف على الأقل' });
    await A.redis('HSET', 'sky:users', user, JSON.stringify({ hash: A.hashPw(b.password), role: b.role === 'admin' ? 'admin' : 'user' }));
    await A.log(req, s.u, true, 'حفظ الحساب ' + user);
    return res.json({ ok: true });
  }
  res.status(405).end();
};
