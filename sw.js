// ============================================================================
// عامل الخدمة — يجعل الأدوات تعمل بلا إنترنت
//
// الاستراتيجية تختلف حسب نوع الطلب، ولكل اختيار سبب:
//
//   • ملفات الموقع (HTML/CSS/JS/أيقونات) → "الشبكة أولاً ثم المخزون"
//     نطلب النسخة الحديثة أولاً حتى لا يعلق المستخدم على إصدار قديم بعد رفع
//     تحديث، وإن فشلت الشبكة نخدم من المخزون. هذا ما يجعل الموقع يفتح في
//     الوادي بلا تغطية.
//
//   • طلبات /api/  → الشبكة فقط، بلا تخزين إطلاقاً
//     السجلات تتغيّر بين الأجهزة، وخدمة نسخة قديمة منها تعني عرض بيانات
//     خاطئة على المستخدم — وهو أسوأ من رسالة "لا يوجد اتصال".
//
//   • بلاطات الخرائط والخطوط → المخزون أولاً
//     لا تتغيّر عملياً، وتخزينها يوفّر بيانات الجوال ويسرّع الفتح.
//
// ملاحظة: البيانات التي تُدخلها بلا إنترنت تبقى محفوظة في المتصفح ويعيد
// DataAPI إرسالها تلقائياً عند عودة الشبكة — هذا مبني أصلاً في data-api.js.
// ============================================================================

const VERSION = "sky-v1";
const SHELL_CACHE = VERSION + "-shell";
const ASSET_CACHE = VERSION + "-assets";

// ما يُخزَّن فور التثبيت ليعمل الموقع بلا إنترنت من أول زيارة
const SHELL = [
  "./",
  "./index.html",
  "./qibla.html",
  "./worktime.html",
  "./completed.html",
  "./manifest.webmanifest",
  "./favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // addAll تفشل كاملةً إن سقط ملف واحد، فنخزّن كلاً على حدة
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// هل هذا طلب لبلاطة خريطة أو خط؟ (يستحق التخزين الطويل)
function isLongLived(url) {
  return (
    /tile\.openstreetmap|arcgisonline|basemaps|fonts\.gstatic|fonts\.googleapis/.test(
      url.href,
    ) || /\.(?:woff2?|ttf|png|jpg|jpeg|svg|webp)$/i.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // السجلات لا تُخزَّن أبداً — بيانات قديمة أسوأ من لا بيانات
  if (url.pathname.startsWith("/api/")) return;

  if (isLongLived(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(ASSET_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // ملفات الموقع: الشبكة أولاً، والمخزون شبكة أمان
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(req)
          .then((hit) => hit || caches.match("./index.html")),
      ),
  );
});
