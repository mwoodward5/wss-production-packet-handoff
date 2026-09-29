(function () {
  "use strict";

  if ("serviceWorker" in navigator && (window.isSecureContext || window.location.hostname === "127.0.0.1")) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  }

  var header = document.querySelector("[data-header]");
  var menuButton = document.querySelector("[data-menu-button]");
  var nav = document.querySelector("[data-nav]");

  function updateHeader() {
    if (header) header.classList.toggle("is-scrolled", window.scrollY > 16);
  }

  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

  if (menuButton && nav) {
    menuButton.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      menuButton.setAttribute("aria-expanded", open ? "true" : "false");
      menuButton.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
      document.body.classList.toggle("menu-open", open);
    });
    nav.addEventListener("click", function (event) {
      if (!event.target.closest("a")) return;
      nav.classList.remove("is-open");
      menuButton.setAttribute("aria-expanded", "false");
      document.body.classList.remove("menu-open");
    });
  }

  var revealItems = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -30px" });
    revealItems.forEach(function (item) { revealObserver.observe(item); });
  } else {
    revealItems.forEach(function (item) { item.classList.add("is-visible"); });
  }

  function startSignalCanvas(canvas) {
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var context = canvas.getContext("2d");
    if (!context) return;
    var width = 0;
    var height = 0;
    var ratio = Math.min(window.devicePixelRatio || 1, 1.75);
    var points = [];
    var frame = 0;
    var raf = 0;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      var count = Math.max(18, Math.min(48, Math.round(width / 32)));
      points = Array.from({ length: count }, function (_, index) {
        return {
          x: (index / Math.max(1, count - 1)) * width,
          y: height * (0.18 + ((index * 37) % 61) / 100),
          speed: 0.08 + (index % 5) * 0.025,
          phase: index * 0.72
        };
      });
    }

    function draw() {
      context.clearRect(0, 0, width, height);
      frame += 0.012;

      context.strokeStyle = "rgba(110, 139, 255, 0.09)";
      context.lineWidth = 1;
      for (var gx = 0; gx < width; gx += 80) {
        context.beginPath();
        context.moveTo(gx, 0);
        context.lineTo(gx, height);
        context.stroke();
      }

      points.forEach(function (point, index) {
        point.x += point.speed;
        if (point.x > width + 8) point.x = -8;
        var y = point.y + Math.sin(frame * 2 + point.phase) * 18;
        var next = points[index + 1];
        if (next) {
          var nextY = next.y + Math.sin(frame * 2 + next.phase) * 18;
          context.beginPath();
          context.moveTo(point.x, y);
          context.lineTo(next.x, nextY);
          context.strokeStyle = index % 4 === 0 ? "rgba(52, 211, 153, 0.22)" : "rgba(124, 108, 246, 0.13)";
          context.stroke();
        }
        context.beginPath();
        context.arc(point.x, y, index % 7 === 0 ? 2.3 : 1.2, 0, Math.PI * 2);
        context.fillStyle = index % 7 === 0 ? "rgba(52, 211, 153, 0.8)" : "rgba(142, 133, 255, 0.42)";
        context.fill();
      });
      raf = window.requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) window.cancelAnimationFrame(raf);
      else draw();
    });
  }

  document.querySelectorAll("[data-signal-canvas]").forEach(startSignalCanvas);

  var reloadButton = document.querySelector("[data-reload]");
  if (reloadButton) reloadButton.addEventListener("click", function () { window.location.reload(); });

  var consentNote = document.querySelector("[data-consent-note]");
  var consentDismiss = document.querySelector("[data-consent-dismiss]");
  try {
    if (consentNote && localStorage.getItem("wssNecessaryStorageNotice") === "dismissed") consentNote.hidden = true;
  } catch (_) {}
  if (consentDismiss && consentNote) {
    consentDismiss.addEventListener("click", function () {
      consentNote.hidden = true;
      try { localStorage.setItem("wssNecessaryStorageNotice", "dismissed"); } catch (_) {}
    });
  }

  var intakeForm = document.getElementById("previewRequestForm");
  if (intakeForm) wireIntake(intakeForm);
  var activationForm = document.getElementById("activationForm");
  if (activationForm) wireActivation(activationForm);

  function wireIntake(form) {
    var submit = form.querySelector("button[type='submit']");
    var status = document.getElementById("requestStatus");
    var fallback = document.getElementById("emailFallback");

    function setStatus(kind, title, message) {
      if (!status) return;
      status.hidden = false;
      status.className = "request-status " + kind;
      status.innerHTML = "<strong>" + escapeHtml(title) + "</strong><span>" + escapeHtml(message) + "</span>";
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;

      var data = Object.fromEntries(new FormData(form).entries());
      var requestKey = idempotencyKey(data);
      var payload = {
        businessName: String(data.businessName || "").trim(),
        industry: String(data.industry || "").trim(),
        city: String(data.city || "").trim(),
        state: String(data.state || "").trim().toUpperCase(),
        ownerEmail: String(data.ownerEmail || "").trim(),
        phone: String(data.phone || "").trim(),
        currentWebsite: String(data.currentWebsite || "").trim(),
        services: String(data.services || "").trim(),
        notes: String(data.notes || "").trim(),
        consentToCall: data.contactConsent === "on" && Boolean(String(data.phone || "").trim()),
        consentToText: false,
        consentSource: "WSS Labs public preview request form",
        package: "Managed Website Preview",
        source: "wss-ai-public-preview-request",
        requestId: requestKey,
        idempotencyKey: requestKey
      };

      if (submit) {
        submit.disabled = true;
        submit.setAttribute("aria-busy", "true");
      }
      if (fallback) fallback.hidden = true;
      setStatus("working", "Sending your request", "We are creating one protected preview request. Nothing is being purchased or published.");

      fetch("/api/preview-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey, "Accept": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok || body.ok === false) {
            var detail = body.message
              || (typeof body.error === "string" ? body.error.replace(/_/g, " ") : "")
              || (typeof body.reason === "string" ? body.reason.replace(/_/g, " ") : "")
              || "The request could not be accepted.";
            throw new Error(detail);
          }
          return body;
        });
      }).then(function (result) {
        var savedRequestId = result.requestId || requestKey;
        try { sessionStorage.setItem("wssLastPreviewRequest", JSON.stringify({ requestId: savedRequestId, jobId: result.job && result.job.id })); } catch (_) {}
        form.reset();
        var reference = savedRequestId ? " Reference: " + savedRequestId + "." : "";
        var receiptMessage = result.message || "Your request is safely saved. Keep this reference for status or support.";
        var receiptTitle = result.state === "already_received"
          ? "Your preview request was already received"
          : "Your preview request is safely saved";
        setStatus("success", receiptTitle, receiptMessage + reference + " No purchase or launch has occurred.");
      }).catch(function (error) {
        setStatus("error", "The online request did not complete", error.message || "Please use the email fallback below.");
        if (fallback) {
          var subject = encodeURIComponent("Website preview request for " + payload.businessName);
          var body = encodeURIComponent("Business: " + payload.businessName + "\nWebsite: " + payload.currentWebsite + "\nCity: " + payload.city + ", " + payload.state + "\nEmail: " + payload.ownerEmail + "\n\nPlease create my free website preview.");
          fallback.href = "mailto:support@woodwardsoftware.com?subject=" + subject + "&body=" + body;
          fallback.hidden = false;
        }
      }).finally(function () {
        if (submit) {
          submit.disabled = false;
          submit.setAttribute("aria-busy", "false");
        }
      });
    });
  }

  function wireActivation(form) {
    var submit = form.querySelector("button[type='submit']");
    var status = document.getElementById("activationStatus");
    var params = new URLSearchParams(window.location.search);
    ["businessName", "ownerEmail", "previewUrl"].forEach(function (name) {
      var field = form.elements.namedItem(name);
      if (field && params.get(name)) field.value = params.get(name);
    });

    function setActivationStatus(kind, title, message) {
      if (!status) return;
      status.hidden = false;
      status.className = "request-status " + kind;
      status.innerHTML = "<strong>" + escapeHtml(title) + "</strong><span>" + escapeHtml(message) + "</span>";
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      var data = Object.fromEntries(new FormData(form).entries());
      var requestId = createId();
      var payload = {
        jobId: "activate_" + requestId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80),
        product: "Local Growth Website Plan",
        prospect: {
          businessName: String(data.businessName || "").trim(),
          ownerEmail: String(data.ownerEmail || "").trim(),
          currentWebsite: String(data.previewUrl || "").trim(),
          industry: "managed website",
          source: "wss-ai-public-activation"
        }
      };

      if (submit) {
        submit.disabled = true;
        submit.setAttribute("aria-busy", "true");
      }
      setActivationStatus("working", "Opening secure checkout", "Stripe is preparing the $149/month subscription. No payment has happened yet.");

      fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          var detail = body.message || (body.error && (body.error.message || body.error.code)) || body.error;
          if (!response.ok || body.ok === false) {
            throw new Error(typeof detail === "string" ? detail : "Secure checkout could not be prepared.");
          }
          return body;
        });
      }).then(function (result) {
        var checkoutUrl = result.checkout && result.checkout.url;
        if (!checkoutUrl) throw new Error("Stripe did not return a checkout URL.");
        var destination = new URL(checkoutUrl);
        if (destination.protocol !== "https:" || !/(^|\.)stripe\.com$/i.test(destination.hostname)) {
          throw new Error("The checkout destination did not pass the Stripe safety check.");
        }
        setActivationStatus("success", "Stripe checkout is ready", "You are being redirected to review the recurring terms and complete payment.");
        window.location.assign(destination.href);
      }).catch(function (error) {
        setActivationStatus("error", "Checkout did not open", error.message || "Please email support and we will send a secure activation link.");
        if (submit) {
          submit.disabled = false;
          submit.setAttribute("aria-busy", "false");
        }
      });
    });
  }

  function idempotencyKey(data) {
    var fingerprint = JSON.stringify(data);
    var storageKey = "wssPreviewRequestKey";
    try {
      var existing = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (existing && existing.fingerprint === fingerprint && existing.key) return existing.key;
      var key = createId();
      sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint: fingerprint, key: key }));
      return key;
    } catch (_) {
      return createId();
    }
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "wss-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[character];
    });
  }
})();

// --- Before/after showcase slider ------------------------------------------
(function () {
  var slider = document.querySelector("[data-ba]");
  if (!slider) return;
  var handle = slider.querySelector("[data-ba-handle]");
  var scroller = slider.querySelector("[data-ba-scroll]");
  var canvas = slider.querySelector(".ba-canvas");
  var hint = slider.querySelector("[data-ba-hint]");

  // Canvas height = the taller of the two full-page captures, once loaded.
  function sizeCanvas() {
    var imgs = canvas.querySelectorAll(".ba-layer > img");
    var h = 0;
    imgs.forEach ? imgs.forEach(function (im) { h = Math.max(h, im.offsetHeight); })
      : Array.prototype.forEach.call(imgs, function (im) { h = Math.max(h, im.offsetHeight); });
    if (h) canvas.style.height = h + "px";
  }
  window.addEventListener("load", sizeCanvas);
  window.addEventListener("resize", sizeCanvas);
  Array.prototype.forEach.call(canvas.querySelectorAll("img"), function (im) {
    if (im.complete) sizeCanvas(); else im.addEventListener("load", sizeCanvas);
  });
  sizeCanvas();

  function beforeAfterBounds(width, minAfter) {
    var max = 96;
    if (width > 0 && minAfter > 0) max = Math.min(max, Math.max(4, ((width - minAfter) / width) * 100));
    return { min: 4, max: max };
  }
  function setX(pct) {
    var width = slider.getBoundingClientRect().width || slider.clientWidth || 0;
    var minAfter = parseFloat(getComputedStyle(slider).getPropertyValue("--ba-endcard-min")) || 0;
    var bounds = beforeAfterBounds(width, minAfter);
    pct = Math.max(bounds.min, Math.min(bounds.max, pct));
    slider.style.setProperty("--ba-x", pct + "%");
    if (handle) {
      handle.setAttribute("aria-valuemin", String(bounds.min));
      handle.setAttribute("aria-valuemax", String(Math.round(bounds.max)));
      handle.setAttribute("aria-valuenow", String(Math.round(pct)));
    }
  }
  function normalizeX() {
    var current = parseFloat(getComputedStyle(slider).getPropertyValue("--ba-x")) || 50;
    setX(current);
  }
  normalizeX();
  window.addEventListener("resize", normalizeX);
  function pctFromEvent(e) {
    var rect = slider.getBoundingClientRect();
    var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return (x / rect.width) * 100;
  }
  // Drag starts only on the handle so normal touch scrolling inside the frame still works.
  var dragging = false;
  function start(e) { dragging = true; slider.classList.remove("ba-animating"); setX(pctFromEvent(e)); e.preventDefault(); }
  function move(e) { if (dragging) { setX(pctFromEvent(e)); if (e.cancelable) e.preventDefault(); } }
  function end() { dragging = false; }
  if (handle) {
    handle.addEventListener("mousedown", start);
    handle.addEventListener("touchstart", start, { passive: false });
  }
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);
  window.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("touchend", end);
  if (handle) handle.addEventListener("keydown", function (e) {
    var cur = parseFloat(getComputedStyle(slider).getPropertyValue("--ba-x")) || 50;
    if (e.key === "ArrowLeft") { setX(cur - 4); e.preventDefault(); }
    if (e.key === "ArrowRight") { setX(cur + 4); e.preventDefault(); }
  });

  // Hide the "scroll both sites" hint after first scroll inside the frame.
  if (scroller && hint) {
    scroller.addEventListener("scroll", function () { hint.classList.add("gone"); }, { once: true });
  }

  // Intro sweep once visible: show the transformation without any interaction.
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var swept = false;
  function sweep() {
    if (swept || reduceMotion) return; swept = true;
    slider.classList.add("ba-animating");
    setX(78);
    setTimeout(function () { setX(28); }, 950);
    setTimeout(function () { setX(50); slider.classList.remove("ba-animating"); }, 1900);
  }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (en) { if (en.isIntersecting) { setTimeout(sweep, 500); obs.disconnect(); } });
    }, { threshold: 0.4 }).observe(slider);
  } else { setTimeout(sweep, 800); }
})();
