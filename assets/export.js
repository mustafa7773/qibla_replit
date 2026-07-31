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

      // ----- التقاط صورة الموقع من الخريطة (بلا أي تغيير في
      // منطق الموقع أو حساب الإحداثيات أو زاوية القبلة) -----
      async function captureQiblaMapCanvas() {
        if (!mapInstance) return null;
        try {
          // لا نغيّر زوم الخريطة إطلاقاً؛ نلتقط الصورة بمستوى التكبير الحالي كما هو
          await waitForActiveTilesToLoad(1500);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

          const mapEl = document.getElementById("map");
          const scale = 2;
          const rawCanvas = await html2canvas(mapEl, {
            useCORS: true,
            allowTaint: false,
            backgroundColor: "#ffffff",
            scale,
          });

          if (markerInstance) {
            const containerPoint = mapInstance.latLngToContainerPoint(
              markerInstance.getLatLng(),
            );
            return cropCanvasAroundPoint(
              rawCanvas,
              containerPoint.x * scale,
              containerPoint.y * scale,
              TEMPLATE_IMAGE_RATIO,
              1,
            );
          }
          return cropCanvasToRatio(rawCanvas, TEMPLATE_IMAGE_RATIO);
        } catch (imgErr) {
          return null;
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
