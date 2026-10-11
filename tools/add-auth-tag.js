// يضيف سطر حارس الدخول لكل صفحات HTML تلقائياً.
// التشغيل من جذر المشروع:  node tools/add-auth-tag.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const TAG = '<script src="assets/auth-guard.js?v=1"></script>';
let n = 0;
for (const f of fs.readdirSync(root).filter(x => x.endsWith('.html'))) {
  if (['login.html', 'users.html'].includes(f)) continue;
  const p = path.join(root, f); let s = fs.readFileSync(p, 'utf8');
  if (s.includes('auth-guard.js')) { console.log('موجود :', f); continue; }
  if (!/<\/head>/i.test(s)) { console.log('تخطّي (لا يوجد head):', f); continue; }
  s = s.replace(/<\/head>/i, '  ' + TAG + '\n</head>');
  fs.writeFileSync(p, s); n++; console.log('أُضيف :', f);
}
console.log('تم. عدد الصفحات المعدّلة:', n);
