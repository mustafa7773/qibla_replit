      // ===== تحميل تقرير Word (يعتمد على القالب الأصلي 100% + استبدال الحقول المتغيرة فقط) =====
      function base64ToUint8Array(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }

      // ----- تحميل قالب Word الأصلي من assets/qibla-template.docx (بدل تضمينه Base64
      // داخل الصفحة). يُخزَّن مؤقتاً بعد أول تحميل لتفادي طلب الشبكة أكثر من مرة. -----
      let cachedTemplateBytesPromise = null;
      function getQiblaTemplateBytes() {
        if (!cachedTemplateBytesPromise) {
          cachedTemplateBytesPromise = fetch("assets/qibla-template.docx")
            .then((r) => r.arrayBuffer())
            .then((buf) => new Uint8Array(buf));
        }
        return cachedTemplateBytesPromise;
      }

      // نسبة أبعاد صورة الموقع كما هي في القالب الأصلي تماماً (العرض/الارتفاع بوحدة EMU)
      const TEMPLATE_IMAGE_EMU_W = 4072255;
      const TEMPLATE_IMAGE_EMU_H = 1999615;
      const TEMPLATE_IMAGE_RATIO = TEMPLATE_IMAGE_EMU_W / TEMPLATE_IMAGE_EMU_H;

      function cropCanvasToRatio(sourceCanvas, ratio) {
        const w = sourceCanvas.width;
        const h = sourceCanvas.height;
        const curRatio = w / h;
        let sx = 0, sy = 0, sw = w, sh = h;
        if (curRatio > ratio) {
          sw = Math.round(h * ratio);
          sx = Math.round((w - sw) / 2);
        } else if (curRatio < ratio) {
          sh = Math.round(w / ratio);
          sy = Math.round((h - sh) / 2);
        }
        const out = document.createElement("canvas");
        out.width = sw;
        out.height = sh;
        const ctx = out.getContext("2d");
        ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
        out.cropOriginX = sx;
        out.cropOriginY = sy;
        return out;
      }

      // يقصّ الصورة الملتقطة حول نقطة الدبوس مباشرة بمساحة أصغر بكثير من كامل الخريطة،
      // فكلما صغرت مساحة الاقتصاص حول البوصلة، بدت التفاصيل حولها أوضح وأكبر في التقرير،
      // بصرف النظر عن مستوى تكبير الخريطة نفسه.
      function cropCanvasAroundPoint(sourceCanvas, centerX, centerY, ratio, zoomInFraction) {
        const w = sourceCanvas.width;
        const h = sourceCanvas.height;

        let cropW = Math.round(Math.min(w, h) * zoomInFraction);
        let cropH = Math.round(cropW / ratio);
        if (cropH > h) {
          cropH = h;
          cropW = Math.round(cropH * ratio);
        }
        if (cropW > w) {
          cropW = w;
          cropH = Math.round(cropW / ratio);
        }

        let sx = Math.round(centerX - cropW / 2);
        let sy = Math.round(centerY - cropH / 2);
        sx = Math.max(0, Math.min(sx, w - cropW));
        sy = Math.max(0, Math.min(sy, h - cropH));

        const out = document.createElement("canvas");
        out.width = cropW;
        out.height = cropH;
        const ctx = out.getContext("2d");
        ctx.drawImage(sourceCanvas, sx, sy, cropW, cropH, 0, 0, cropW, cropH);

        // نُرفق نقطة أصل الاقتصاص بالنتيجة، فبدونها لا سبيل لتحويل إحداثيات
        // الخريطة إلى مواضع صحيحة على الصورة المقتصّة عند رسم علامة الكعبة.
        out.cropOriginX = sx;
        out.cropOriginY = sy;
        return out;
      }

      // ينتظر انتهاء تحميل بلاطات طبقة الأقمار الصناعية/الخريطة الحالية باستخدام واجهة Leaflet
      // العامة isLoading() بدل التحقق من خصائص داخلية غير موثوقة، مع سقف زمني للأمان.
      function waitForActiveTilesToLoad(maxWaitMs) {
        return new Promise((resolve) => {
          const activeLayer =
            mapInstance && satLayer && mapInstance.hasLayer(satLayer)
              ? satLayer
              : streetLayer;

          if (!activeLayer || typeof activeLayer.isLoading !== "function") {
            resolve();
            return;
          }

          if (!activeLayer.isLoading()) {
            resolve();
            return;
          }

          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          activeLayer.once("load", finish);
          setTimeout(finish, maxWaitMs);
        });
      }

      function getArabicGregorianDateString(date) {
        const months = [
          "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
          "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
        ];
        return date.getDate() + " " + months[date.getMonth()] + " " + date.getFullYear() + "م";
      }

      function getHijriDateString(date) {
        try {
          const parts = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", {
            day: "numeric",
            month: "long",
            year: "numeric",
          }).formatToParts(date);
          const day = parts.find((p) => p.type === "day").value;
          const month = parts.find((p) => p.type === "month").value;
          const year = parts.find((p) => p.type === "year").value;
          return day + " " + month + " " + year;
        } catch (e) {
          return "";
        }
      }

      // ============================================================================
      // مصدر واحد للتصميم (Single Source of Truth):
      // قالب Word الأصلي (assets/qibla-template.docx) هو التصميم المعتمد الوحيد للتقرير:
      // نفس الخطوط، الألوان، الجداول، الشعار، الختم، الصورة، الهوامش والمحاذاة.
      // زر "تحميل تقرير Word" يُنزّل هذا الملف كما هو بعد تعبئة الحقول المتغيرة
      // وإدراج صورة الموقع فقط — دون أي مساس بالتصميم.
      // ============================================================================

      // ----- جمع بيانات الحقول التي تُملأ في القالب -----
      function collectQiblaReportFields() {
        const nowForDates = new Date();
        return {
          survey_coords: document.getElementById("surveyCoords").textContent.trim(),
          site_coords: document.getElementById("siteCoordsDMS").textContent.trim(),
          bearing_dms: document.getElementById("bearingDMS").textContent.trim(),
          greg_date: getArabicGregorianDateString(nowForDates),
          hijri_date: getHijriDateString(nowForDates),
          mosque_request_no: document.getElementById("mosqueRequestNo").value.trim(),
          company_request_no: document.getElementById("companyRequestNo").value.trim(),
          agent_info: document.getElementById("agentInfo").value.trim(),
          governorate: document.getElementById("governorateInput").value.trim(),
          village_plot: document.getElementById("villagePlotInput").value.trim(),
          map_angle: document.getElementById("mapAngleInput").value.trim(),
          request_status: document.getElementById("requestStatusInput").value.trim(),
          notes: document.getElementById("notesInput").value.trim(),
        };
      }

      // ============================================================================
      // علامة الكعبة في صورة التقرير
      // ----------------------------------------------------------------------------
      // سببان متراكبان كانا يُخفيانها:
      //
      // ١) الاقتصاص: cropCanvasAroundPoint يقتصّ حول دبوس المسجد بعرض min(w,h)،
      //    أي أضيق من عرض الخريطة. والعلامة توضع على بُعد ٠٫٣٣ × عرض الخريطة
      //    (kaabaMarkerLatLng في app.js)، فتقع خارج المستطيل المقتصّ في أغلب
      //    الأحجام. خط القبلة يظهر لأنه ممتد فيُقتصّ جزء منه؛ والعلامة نقطة واحدة.
      //
      // ٢) html2canvas و divIcon: العلامة عنصر DOM يحمل SVG مضمّناً، ويموضعه
      //    Leaflet بـ transform. تعامُل المكتبة معه متقلّب ولا يُعتمد عليه.
      //
      // العلاج: نُخفي العلامة أثناء الالتقاط ثم نرسمها هنا على الصورة المقتصّة
      // بنفس تصميم KAABA_ICON_HTML. وإن وقع موضعها خارج الاقتصاص، تُزلق على خط
      // القبلة نفسه حتى آخر نقطة داخل الإطار — فيبقى الاتجاه صادقاً.
      //
      // منطق الإحداثيات وزاوية القبلة لم يُمسّ: نقرأ موضع العلامة الحيّ كما هو.
      // ============================================================================

      /** مستطيل بزوايا دائرية على سياق canvas */
      function roundRectPath(ctx, x, y, w, h, r) {
        const rr = Math.max(0, Math.min(r, w / 2, h / 2));
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.arcTo(x + w, y, x + w, y + rr, rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
        ctx.lineTo(x + rr, y + h);
        ctx.arcTo(x, y + h, x, y + h - rr, rr);
        ctx.lineTo(x, y + rr);
        ctx.arcTo(x, y, x + rr, y, rr);
        ctx.closePath();
      }

      /**
       * نسخة canvas مطابقة لعلامة KAABA_ICON_HTML في app.js:
       * قرص أخضر بحلقة بيضاء، وداخله الكعبة بكسوتها السوداء وحزامها وبابها الذهبيين.
       * الأبعاد بنفس شبكة viewBox الأصلية (52×52) مضروبة في u.
       */
      function drawKaabaBadge(ctx, cx, cy, size) {
        const u = size / 52;
        ctx.save();
        ctx.translate(cx - 26 * u, cy - 26 * u);
        ctx.scale(u, u);

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(26, 26, 23, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#22c55e";
        ctx.beginPath();
        ctx.arc(26, 26, 20.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = "#0b3d2e";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(26, 26, 20.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.translate(26, 27);

        ctx.fillStyle = "#111827";
        roundRectPath(ctx, -10, -9.5, 20, 19, 1.4);
        ctx.fill();

        ctx.fillStyle = "#e8c473";
        ctx.fillRect(-10, -2.2, 20, 3.4);
        ctx.fillStyle = "#f7e3ae";
        ctx.fillRect(-10, -2.2, 20, 1);
        ctx.fillStyle = "#d4af37";
        ctx.fillRect(-10, -9.5, 20, 1.8);

        ctx.fillStyle = "#e8c473";
        roundRectPath(ctx, 3.2, 1.9, 3.4, 7.6, 0.4);
        ctx.fill();
        ctx.fillStyle = "#f7e3ae";
        ctx.fillRect(3.2, 1.9, 3.4, 1);

        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = "#0b3d2e";
        ctx.lineWidth = 0.9;
        roundRectPath(ctx, -10, -9.5, 20, 19, 1.4);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.restore();
      }

      /**
       * آخر نقطة على القطعة (from → to) تقع داخل المستطيل.
       * تُبقي العلامة على خط القبلة تماماً بدل قصّها إلى أقرب ركن.
       */
      function slideOntoRect(fromX, fromY, toX, toY, minX, minY, maxX, maxY) {
        if (toX >= minX && toX <= maxX && toY >= minY && toY <= maxY) {
          return { x: toX, y: toY, slid: false };
        }
        if (fromX < minX || fromX > maxX || fromY < minY || fromY > maxY) {
          return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, slid: true };
        }
        const dx = toX - fromX;
        const dy = toY - fromY;
        let t = 1;
        if (dx > 0) t = Math.min(t, (maxX - fromX) / dx);
        else if (dx < 0) t = Math.min(t, (minX - fromX) / dx);
        if (dy > 0) t = Math.min(t, (maxY - fromY) / dy);
        else if (dy < 0) t = Math.min(t, (minY - fromY) / dy);
        t = Math.max(0, Math.min(1, t));
        return { x: fromX + dx * t, y: fromY + dy * t, slid: true };
      }

      /** يرسم علامة الكعبة على الصورة المقتصّة بعد اكتمال الالتقاط */
      function stampKaabaOnCanvas(croppedCanvas, scale) {
        try {
          if (!croppedCanvas || !mapInstance || !markerInstance) return;
          if (typeof kaabaMarkerInstance === "undefined" || !kaabaMarkerInstance) return;

          const originX = croppedCanvas.cropOriginX || 0;
          const originY = croppedCanvas.cropOriginY || 0;

          const mosquePt = mapInstance.latLngToContainerPoint(markerInstance.getLatLng());
          const kaabaPt = mapInstance.latLngToContainerPoint(kaabaMarkerInstance.getLatLng());

          const mx = mosquePt.x * scale - originX;
          const my = mosquePt.y * scale - originY;
          const kx = kaabaPt.x * scale - originX;
          const ky = kaabaPt.y * scale - originY;

          const size = 52 * scale;
          const pad = size / 2 + 4 * scale; // هامش يمنع قصّ حافة العلامة

          const p = slideOntoRect(
            mx, my, kx, ky,
            pad, pad,
            croppedCanvas.width - pad,
            croppedCanvas.height - pad,
          );

          drawKaabaBadge(croppedCanvas.getContext("2d"), p.x, p.y, size);
        } catch (e) {
          // الصورة تبقى صالحة بلا علامة بدل إسقاط التقرير كاملاً
          console.warn("تعذّر رسم علامة الكعبة على صورة التقرير:", e);
        }
      }

      /** إخفاء علامة الكعبة الحيّة أثناء الالتقاط، ودالة لإعادتها */
      function hideLiveKaabaMarker() {
        try {
          if (typeof kaabaMarkerInstance === "undefined" || !kaabaMarkerInstance) return null;
          const el = kaabaMarkerInstance.getElement();
          if (!el) return null;
          const previous = el.style.visibility;
          el.style.visibility = "hidden";
          return () => {
            el.style.visibility = previous;
          };
        } catch (e) {
          return null;
        }
      }

      // ----- التقاط صورة الموقع من الخريطة (بلا أي تغيير في
      // منطق الموقع أو حساب الإحداثيات أو زاوية القبلة) -----
      async function captureQiblaMapCanvas() {
        if (!mapInstance) return null;
        let restoreKaabaMarker = null;
        try {
          // لا نغيّر زوم الخريطة إطلاقاً؛ نلتقط الصورة بمستوى التكبير الحالي كما هو
          await waitForActiveTilesToLoad(1500);

          // نُخفي علامة الكعبة قبل الالتقاط: html2canvas قد يرسمها وقد لا يرسمها،
          // ونحن نرسمها بأنفسنا بعد الاقتصاص. الإخفاء يمنع ظهورها مرتين.
          restoreKaabaMarker = hideLiveKaabaMarker();

          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

          const mapEl = document.getElementById("map");
          const scale = 2;
          const rawCanvas = await html2canvas(mapEl, {
            useCORS: true,
            allowTaint: false,
            backgroundColor: "#ffffff",
            scale,
          });

          let cropped;
          if (markerInstance) {
            const containerPoint = mapInstance.latLngToContainerPoint(
              markerInstance.getLatLng(),
            );
            cropped = cropCanvasAroundPoint(
              rawCanvas,
              containerPoint.x * scale,
              containerPoint.y * scale,
              TEMPLATE_IMAGE_RATIO,
              1,
            );
          } else {
            cropped = cropCanvasToRatio(rawCanvas, TEMPLATE_IMAGE_RATIO);
          }

          stampKaabaOnCanvas(cropped, scale);
          return cropped;
        } catch (imgErr) {
          return null;
        } finally {
          if (restoreKaabaMarker) restoreKaabaMarker();
        }
      }

      // ----- المصدر الوحيد لإنشاء المستند: يملأ القالب الأصلي بالحقول والصورة -----
      async function buildQiblaReportDocx(mapCanvas) {
        const fields = collectQiblaReportFields();

        // نستخدم نفس رمزي المربع من خط Wingdings 2 الأصليين في القالب (مربع معلَّم/فارغ)
        // حتى يكون الشكل مطابقاً تماماً لما كان عليه سابقاً، بدل رموز يونيكود عامة
        const CHECKED_BOX = "\uF052";
        const UNCHECKED_BOX = "\uF0A3";

        const templateBytes = await getQiblaTemplateBytes();
        const zip = new PizZip(templateBytes);

        const docTemplate = new window.docxtemplater(zip, {
          paragraphLoop: true,
          linebreaks: true,
        });

        docTemplate.render({
          ...fields,
          status_box_awali: fields.request_status === "أولي" ? CHECKED_BOX : UNCHECKED_BOX,
          status_box_jahiz: fields.request_status === "جاهز" ? CHECKED_BOX : UNCHECKED_BOX,
          status_box_muktamil: fields.request_status === "مكتمل" ? CHECKED_BOX : UNCHECKED_BOX,
        });

        const outZip = docTemplate.getZip();

        // استبدال بايتات صورة الموقع مباشرة داخل الملف دون لمس أي تنسيق أو تخطيط
        if (mapCanvas) {
          const dataUrl = mapCanvas.toDataURL("image/png");
          const imagePngBytes = base64ToUint8Array(dataUrl.split(",")[1]);
          outZip.file("word/media/image1.png", imagePngBytes);
        }

        const blob = outZip.generate({
          type: "blob",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });

        return { blob };
      }

      // اسم ملف التقرير = "قبلة" متبوعاً برقم الطلب بنظام المساجد كما أدخله المستخدم
      // (مثال: "قبلة ص 24-144"). تُزال فقط الرموز التي لا يقبلها نظام الملفات،
      // ويُستخدم التاريخ كبديل إن تُرك حقل رقم الطلب فارغاً.
      function qiblaReportFileName() {
        const requestNo = document.getElementById("mosqueRequestNo").value.trim();

        if (!requestNo) {
          const today = new Date();
          const stamp =
            today.getFullYear() + "-" +
            String(today.getMonth() + 1).padStart(2, "0") + "-" +
            String(today.getDate()).padStart(2, "0");
          return "قبلة " + stamp;
        }

        // الرموز \ / : * ? " < > | ممنوعة في أسماء الملفات على ويندوز وماك
        const safeRequestNo = requestNo
          .replace(/[\\/:*?"<>|]/g, "-")
          .replace(/\s+/g, " ")
          .trim();

        return "قبلة " + safeRequestNo;
      }

      function downloadBlobAs(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }

      // ===== تحميل تقرير Word (من القالب الأصلي 100% + استبدال الحقول المتغيرة فقط) =====
      async function generateWordReport() {
        const btn = document.getElementById("downloadWordBtn");
        const status = document.getElementById("wordStatus");
        if (!mapInstance || document.getElementById("resultPanel").classList.contains("hidden")) {
          alert("يرجى حساب اتجاه القبلة أولاً قبل تحميل التقرير.");
          return;
        }
        status.style.display = "block";
        status.textContent = "جاري تجهيز صورة الخريطة...";
        btn.disabled = true;

        try {
          const mapCanvas = await captureQiblaMapCanvas();

          status.textContent = "جاري إنشاء ملف Word من القالب الأصلي...";
          const { blob } = await buildQiblaReportDocx(mapCanvas);

          downloadBlobAs(blob, qiblaReportFileName() + ".docx");

          status.textContent = "تم إنشاء الملف وتحميله بنجاح.";
          setTimeout(() => {
            status.style.display = "none";
          }, 4000);
        } catch (err) {
          status.textContent = "حدث خطأ أثناء إنشاء ملف Word: " + (err && err.message ? err.message : err);
        } finally {
          btn.disabled = false;
        }
      }

      document.getElementById("downloadWordBtn").addEventListener("click", generateWordReport);
