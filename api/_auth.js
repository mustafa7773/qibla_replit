// أدوات المصادقة المشتركة — لا تُستدعى مباشرة من المتصفح (الشرطة السفلية في الاسم)
const crypto = require('crypto');
const URL_ = process.env.KV_REST_API_URL, TOKEN = process.env.KV_REST_API_TOKEN;
const SECRET = process.env.AUTH_SECRET || '';
const TTL = 12 * 3600; // مدة الجلسة بالثواني

async function redis(...cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(cmd) });
  return (await r.json()).result;
}
const hmac = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const eq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };

function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPw(pw, stored) { return eq(hashPw(pw, stored.split(':')[0]), stored); }

function makeToken(user, role, env) {
  const p = Buffer.from(JSON.stringify({ u: user, r: role, v: env ? 1 : 0, e: Date.now() + TTL * 1000 })).toString('base64url');
  return p + '.' + hmac(p);
}
function readSession(req) {
  if (!SECRET) return null;
  const m = /(?:^|;\s*)sky_session=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [p, sig] = m[1].split('.');
  if (!p || !sig || !eq(sig, hmac(p))) return null;
  try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); return d.e > Date.now() ? d : null; } catch { return null; }
}
function setCookie(res, token, age = TTL) {
  res.setHeader('Set-Cookie', `sky_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`);
}
async function log(req, user, ok, note) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  await redis('LPUSH', 'sky:authlog', JSON.stringify({ t: Date.now(), u: user, ip, ok, n: note || '' }));
  await redis('LTRIM', 'sky:authlog', 0, 199);
}
// يتحقق من الجلسة، ومن أن الحساب ما زال موجوداً (حذف الموظف يُلغي دخوله فوراً)
async function requireAuth(req, res, adminOnly = false) {
  res.setHeader('Cache-Control', 'no-store');
  const s = readSession(req);
  let okSession = !!s;
  if (s && !s.v) okSession = !!(await redis('HEXISTS', 'sky:users', s.u));
  if (!okSession || (adminOnly && s.r !== 'admin')) {
    res.status(401).json({ ok: false, error: 'غير مصرّح' });
    return null;
  }
  return s;
}
module.exports = { redis, hashPw, checkPw, makeToken, readSession, setCookie, requireAuth, eq, log };
