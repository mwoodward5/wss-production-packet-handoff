/* SiteForge client sprinkles — no framework, no build step. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const csrf = () => (document.cookie.match(/(?:^|;\s*)sf_csrf=([^;]+)/) || [])[1] || "";
  const safe = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

  // Kinetic headline: per-word rise (reduced-motion handled in CSS)
  $$(".kinetic").forEach((el) => {
    const words = el.textContent.trim().split(/\s+/);
    el.innerHTML = words.map((w, i) => `<span style="animation-delay:${60 * i}ms">${w}</span>`).join(" ");
  });

  // Device toggle for preview
  $$("[data-device]").forEach((btn) => btn.addEventListener("click", () => {
    const wrap = $(".preview-frame-wrap");
    if (!wrap) return;
    wrap.classList.toggle("mobile", btn.dataset.device === "mobile");
    $$("[data-device]").forEach((b) => b.classList.toggle("ghost", b !== btn));
  }));

  // Wizard step progression
  const wiz = $("#wizard");
  if (wiz) {
    const steps = $$(".wiz-step", wiz);
    const dots = $$(".steps span");
    let cur = 0;
    const show = (i) => {
      cur = Math.max(0, Math.min(steps.length - 1, i));
      steps.forEach((s, j) => (s.hidden = j !== cur));
      dots.forEach((d, j) => { d.classList.toggle("on", j === cur); d.classList.toggle("done", j < cur); });
      window.scrollTo({ top: 0 });
    };
    $$("[data-next]", wiz).forEach((b) => b.addEventListener("click", () => {
      const inputs = $$("input[required], select[required]", steps[cur]);
      for (const inp of inputs) if (!inp.reportValidity()) return;
      show(cur + 1);
    }));
    $$("[data-back]", wiz).forEach((b) => b.addEventListener("click", () => show(cur - 1)));
    show(0);
  }

  // Asset approval toggles
  $$("[data-asset-toggle]").forEach((cb) => cb.addEventListener("change", async () => {
    const card = cb.closest(".asset");
    card.classList.toggle("off", !cb.checked);
    await fetch(`/api/assets/${cb.dataset.assetToggle}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({ approved: cb.checked }),
    }).catch(() => {});
  }));

  // SSE forge timeline
  const tl = $("#forge-timeline");
  if (tl && tl.dataset.job) {
    const stages = ["discover", "scrape", "rescue", "design", "build", "qc", "deploy", "job"];
    const labels = { discover: "Finding business details", scrape: "Gathering useful content", rescue: "Preparing photos and files", design: "Choosing the design", build: "Making the website", qc: "Checking every detail", deploy: "Preparing the preview", job: "Ready" };
    const rows = {};
    stages.forEach((s) => {
      const li = document.createElement("li");
      li.innerHTML = `<i class="dot"></i><span class="stage">${labels[s]}</span><span class="detail">waiting</span>`;
      tl.appendChild(li); rows[s] = li;
    });
    const es = new EventSource(`/api/jobs/${tl.dataset.job}/stream`);
    es.onmessage = (m) => {
      let e; try { e = JSON.parse(m.data); } catch { return; }
      const li = rows[e.stage]; if (!li) return;
      const d = li.querySelector(".detail");
      if (e.phase === "start") { li.className = "run"; d.textContent = "working…"; }
      else if (e.phase === "done") { li.className = "done"; d.textContent = summarize(e); }
      else if (e.phase === "failed" || e.phase === "error") { li.className = "fail"; d.textContent = e.payload?.message || "failed"; }
      else { li.className = "run"; d.textContent = `${e.phase} ${short(e.payload)}`; }
      if (e.stage === "job" && (e.phase === "done" || e.phase === "failed")) {
        es.close();
        const target = $("#forge-result");
        if (target && e.phase === "done") {
          target.innerHTML = `<div class="notice ok">Your website is ready to review — <a href="${e.payload.preview}" target="_blank" rel="noopener">open the preview</a></div>`;
          setTimeout(() => location.href = tl.dataset.redirect || location.href, 1200);
        } else if (target) {
          target.innerHTML = `<div class="notice bad">We could not finish this version. ${e.payload?.message || "Please try again."} Nothing was published or charged.</div>`;
        }
      }
    };
    const summarize = (e) => {
      const p = e.payload || {};
      if (e.stage === "qc") return `grade ${p.grade}${p.failed?.length ? " · " + p.failed.join(", ") : ""}`;
      if (e.stage === "design") return `${p.family || ""} · ${p.sections || "?"} sections`;
      if (e.stage === "build") return "site rendered";
      if (e.stage === "job") return `grade ${p.grade || "?"}`;
      return "done";
    };
    const short = (p) => { try { const s = JSON.stringify(p); return s.length > 60 ? s.slice(0, 57) + "…" : s; } catch { return ""; } };
  }

  // Template try-on: poll job then swap in preview link
  $$("[data-template-try], #try-form").forEach((tryForm) => tryForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("button[type=submit]", tryForm);
    const out = tryForm.parentElement?.querySelector("[data-try-result], #try-result") || $("#try-result");
    const endpoint = tryForm.dataset.endpoint || "/api/templates/try";
    const original = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Making your preview...';
    const body = Object.fromEntries(new FormData(tryForm).entries());
    try {
      const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "We could not make the preview. Please try again.");
      const directPreview = data.result?.preview || data.preview_url || (typeof data.preview === "string" ? data.preview : "");
      if (directPreview) {
        if (out) out.innerHTML = `<div class="notice ok">Your private preview is ready. <a href="${directPreview}" target="_blank" rel="noopener"><b>Open your new website</b></a>. Sign up to keep working on it.</div>`;
        btn.disabled = false; btn.textContent = "Make another preview";
        return;
      }
      if (!data.job_id) throw new Error("Your preview finished, but we could not open it. Please try again.");
      const poll = setInterval(async () => {
        const jr = await fetch(`/api/jobs/${data.job_id}`);
        const j = await jr.json();
        if (j.status === "done") {
          clearInterval(poll);
          if (out) out.innerHTML = `<div class="notice ok">Your private preview is ready. <a href="${j.result.preview}" target="_blank" rel="noopener"><b>Open your new website</b></a>. Sign up to keep working on it.</div>`;
          btn.disabled = false; btn.textContent = "Make another preview";
        } else if (j.status === "failed") {
          clearInterval(poll);
          if (out) out.innerHTML = `<div class="notice bad">${j.error || "We could not finish the preview. Please try again."}</div>`;
          btn.disabled = false; btn.textContent = "Try again";
        }
      }, 1500);
    } catch (err) {
      if (out) out.innerHTML = `<div class="notice bad">${err.message}</div>`;
      btn.disabled = false; btn.textContent = original || "Try again";
    }
  }));

  const intakeForm = $("#intake-genie-form");
  if (intakeForm?.classList.contains("prompt-composer")) {
    const prompt = $("#forge-prompt", intakeForm);
    const files = $("#ig-files", intakeForm);
    const fileTray = $("[data-file-tray]", intakeForm);
    const driveInput = $("#drive-link", intakeForm);
    const drivePanel = $("[data-drive-panel]", intakeForm);
    const driveStatus = $("[data-drive-status]", intakeForm);
    const draftState = $("[data-draft-state]", intakeForm);
    const voiceButton = $("[data-voice-button]", intakeForm);
    const voiceState = $("[data-voice-state]", intakeForm);
    const chips = Object.fromEntries($$("[data-source-chip]", intakeForm).map((chip) => [chip.dataset.sourceChip, chip]));
    const draftKey = "siteforge:intake-draft:v2";
    let selectedFiles = [];
    let draftTimer = null;
    let progressTimer = null;
    const classify = (url) => /drive\.google|docs\.google/i.test(url) ? "asset" : /google\.|maps\.app\.goo\.gl/i.test(url) ? "gbp" : /facebook|instagram|tiktok|youtube|linkedin|nextdoor|yelp|x\.com|twitter/i.test(url) ? "social" : "website";
    const updateRail = () => {
      const found = new Set([...(prompt?.value.match(/https?:\/\/[^\s<>"')\]]+/gi) || []), driveInput?.value || ""].filter(Boolean).map(classify));
      Object.entries(chips).forEach(([key, chip]) => {
        const connected = key === "files" ? selectedFiles.length > 0 : found.has(key);
        chip.classList.toggle("on", connected);
        chip.setAttribute("aria-label", `${chip.textContent.replace(/\s*connected$/i, "")}: ${connected ? "connected" : "waiting"}`);
      });
      if (chips.files) chips.files.textContent = selectedFiles.length ? `${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}` : "Files";
    };
    const syncFileInput = () => {
      const transfer = new DataTransfer();
      selectedFiles.forEach((file) => transfer.items.add(file));
      files.files = transfer.files;
    };
    const renderFiles = () => {
      if (!fileTray) return;
      fileTray.innerHTML = selectedFiles.map((file, index) => `<span><b>${safe(file.name)}</b><small>${file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`}</small><button type="button" data-remove-file="${index}" aria-label="Remove ${safe(file.name)}">×</button></span>`).join("");
      fileTray.hidden = !selectedFiles.length;
      $$('[data-remove-file]', fileTray).forEach((button) => button.addEventListener("click", () => {
        selectedFiles.splice(Number(button.dataset.removeFile), 1);
        syncFileInput(); renderFiles(); updateRail();
      }));
    };
    const addFiles = (incoming) => {
      const allowed = /\.(?:png|jpe?g|webp|gif|zip|txt|md|csv|json|html?)$/i;
      const next = [...incoming].filter((file) => allowed.test(file.name));
      const merged = [...selectedFiles, ...next].filter((file, index, all) => all.findIndex((item) => item.name === file.name && item.size === file.size) === index).slice(0, 7);
      const total = merged.reduce((sum, file) => sum + file.size, 0);
      if (total > 4 * 1024 * 1024) {
        const out = $("#try-result");
        if (out) out.innerHTML = '<div class="notice bad">Instant-preview files must total 4 MB or less. Remove a large file and try again.</div>';
        return;
      }
      selectedFiles = merged;
      syncFileInput(); renderFiles(); updateRail();
    };
    const saveDraft = () => {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        try { localStorage.setItem(draftKey, JSON.stringify({ prompt: prompt.value, drive: driveInput?.value || "" })); } catch {}
        if (draftState) draftState.textContent = prompt.value.trim() || driveInput?.value ? "Draft saved" : "";
      }, 350);
    };
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) || "null");
      if (draft?.prompt && !prompt.value) prompt.value = draft.prompt;
      if (draft?.drive && driveInput && !driveInput.value) driveInput.value = draft.drive;
    } catch {}
    prompt?.addEventListener("input", () => { updateRail(); saveDraft(); });
    files?.addEventListener("change", () => addFiles(files.files));
    driveInput?.addEventListener("input", () => { updateRail(); saveDraft(); if (driveStatus) driveStatus.textContent = ""; });
    $("[data-drive-button]", intakeForm)?.addEventListener("click", () => {
      drivePanel.hidden = !drivePanel.hidden;
      if (!drivePanel.hidden) driveInput?.focus();
    });
    $("[data-drive-done]", intakeForm)?.addEventListener("click", () => {
      if (!/^https:\/\/(?:drive|docs)\.google\.com\//i.test(driveInput?.value || "")) {
        if (driveStatus) driveStatus.textContent = "Paste a public Google Drive or Google Docs link.";
        return driveInput?.focus();
      }
      drivePanel.hidden = true; updateRail(); saveDraft();
    });
    const clearDraft = $("[data-clear-draft]", intakeForm);
    let clearArmed = false;
    clearDraft?.addEventListener("click", () => {
      if ((prompt.value.trim() || driveInput?.value || selectedFiles.length) && !clearArmed) {
        clearArmed = true;
        clearDraft.classList.add("is-armed");
        if (draftState) draftState.textContent = "Tap trash again to clear";
        setTimeout(() => { clearArmed = false; clearDraft.classList.remove("is-armed"); if (draftState?.textContent === "Tap trash again to clear") draftState.textContent = "Draft saved"; }, 3200);
        return;
      }
      prompt.value = ""; if (driveInput) driveInput.value = ""; selectedFiles = []; syncFileInput(); renderFiles();
      try { localStorage.removeItem(draftKey); } catch {}
      if (draftState) draftState.textContent = "";
      clearArmed = false; clearDraft.classList.remove("is-armed");
      updateRail(); prompt.focus();
    });
    intakeForm.addEventListener("dragover", (event) => { event.preventDefault(); intakeForm.classList.add("is-dragging"); });
    intakeForm.addEventListener("dragleave", (event) => { if (!intakeForm.contains(event.relatedTarget)) intakeForm.classList.remove("is-dragging"); });
    intakeForm.addEventListener("drop", (event) => { event.preventDefault(); intakeForm.classList.remove("is-dragging"); if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files); });

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Recognition && voiceButton) {
      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      let listening = false;
      recognition.onstart = () => { listening = true; voiceButton.classList.add("is-listening"); if (voiceState) voiceState.innerHTML = '<span></span><span></span><span></span><span></span><b>Listening</b>'; };
      recognition.onresult = (event) => {
        let finalText = ""; let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
          else interim += event.results[i][0].transcript;
        }
        if (finalText.trim()) { prompt.value = `${prompt.value.trim()}${prompt.value.trim() ? " " : ""}${finalText.trim()}`; prompt.dispatchEvent(new Event("input")); }
        if (voiceState) voiceState.innerHTML = interim.trim() ? `<b>${safe(interim.trim())}</b>` : '<span></span><span></span><span></span><span></span><b>Listening</b>';
      };
      recognition.onerror = (event) => { if (voiceState) voiceState.textContent = event.error === "not-allowed" ? "Microphone permission was not granted." : "Voice paused. Tap the microphone to resume."; };
      recognition.onend = () => { listening = false; voiceButton.classList.remove("is-listening"); if (voiceState && !/permission|paused/i.test(voiceState.textContent)) voiceState.textContent = ""; };
      voiceButton.addEventListener("click", () => { if (listening) recognition.stop(); else { try { recognition.start(); } catch {} } });
    } else if (voiceButton) {
      voiceButton.disabled = true;
      voiceButton.title = "Voice input is not supported in this browser";
    }

    const stages = ["Gathering your details", "Preparing your photos and files", "Designing your website", "Checking every detail"];
    const stageIndex = { queued: 0, discover: 0, scrape: 0, rescue: 1, design: 2, build: 2, qc: 3, deploy: 3, job: 3 };
    const showProgress = (active, detail = "") => {
      const out = $("#try-result");
      if (!out) return;
      out.innerHTML = `<div class="forge-progress" aria-live="polite"><div class="forge-signal" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div><ol>${stages.map((stage, index) => `<li class="${index < active ? "done" : index === active ? "active" : ""}"><span>${index < active ? "✓" : index + 1}</span>${stage}</li>`).join("")}</ol><p>${safe(detail || "Your preview stays private while we finish the checks.")}</p></div>`;
    };
    updateRail();

    intakeForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = $("button[type=submit]", intakeForm);
      const btnLabel = $("span", btn);
      const out = $("#try-result");
      const original = btnLabel?.textContent || "Make my free preview";
      btn.disabled = true;
      if (btnLabel) btnLabel.textContent = "Gathering your details";
      showProgress(0, "Looking for your services, photos, reviews, location, and contact details.");
      let polling = false;
      clearInterval(progressTimer);
      try {
        const response = await fetch(intakeForm.dataset.endpoint || "/api/try/intake", { method: "POST", body: new FormData(intakeForm), headers: { accept: "application/json" } });
        const data = await response.json();
        if (!response.ok || data.ok === false) throw new Error(data.error || "We need a little more information before we can make your website.");
        if (data.status === "out_of_scope") throw new Error(data.scope?.message || "WSS Launch does not support this type of business yet.");
        if (data.needs_input) {
          clearInterval(progressTimer);
          if (out) out.innerHTML = `<div class="notice warn"><b>${safe(data.question)}</b><div class="prompt-followup"><input id="ig-followup" placeholder="${safe(data.placeholder)}"><button type="button" class="btn sm ember" id="ig-followup-add">Continue</button></div></div>`;
          const followup = $("#ig-followup");
          $("#ig-followup-add")?.addEventListener("click", () => {
            if (!followup?.value.trim()) return followup?.focus();
            prompt.value = `${prompt.value.trim()} ${data.question} ${followup.value.trim()}`;
            updateRail();
            intakeForm.requestSubmit();
          }, { once: true });
          followup?.focus();
          return;
        }
        const jobId = data.preview?.job_id || data.job_id;
        const correlationId = data.preview?.correlation_id || data.correlation_id || jobId;
        if (data.preview?.url) {
          clearInterval(progressTimer);
          if (out) out.innerHTML = `<div class="forge-success"><span aria-hidden="true">A</span><div><b>Your website is ready to review.</b><a href="${safe(data.preview.url)}" target="_blank" rel="noopener">Open my preview →</a></div></div>`;
          try { localStorage.removeItem(draftKey); } catch {}
          return;
        }
        if (!jobId) throw new Error("We gathered your details but could not start the preview. Please try again.");
        polling = true;
        if (btnLabel) btnLabel.textContent = "Preparing your photos and files";
        showProgress(1, `Build reference: ${correlationId}`);
        const pollStartedAt = Date.now();
        let pollDelay = 1500;
        let pollTimer = null;
        const pollJob = async () => {
          let job;
          try {
            const jobResponse = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
            job = await jobResponse.json();
          } catch {
            pollDelay = Math.min(6000, Math.round(pollDelay * 1.5));
            pollTimer = setTimeout(pollJob, pollDelay);
            return;
          }
          const active = stageIndex[job.stage] ?? 0;
          if (btnLabel) btnLabel.textContent = stages[active];
          showProgress(active, `Build reference: ${job.correlation_id || correlationId}`);
          if (["done", "ready"].includes(job.status)) {
            clearTimeout(pollTimer);
            clearInterval(progressTimer);
            polling = false;
            if (out) out.innerHTML = `<div class="forge-success"><span aria-hidden="true">A</span><div><b>Your website passed its checks.</b><a href="${safe(job.result.preview)}" target="_blank" rel="noopener">Open my preview →</a></div></div>`;
            try { localStorage.removeItem(draftKey); } catch {}
            btn.disabled = false;
            if (btnLabel) btnLabel.textContent = "Make another website";
          } else if (["blocked", "failed", "timed_out"].includes(job.status)) {
            clearTimeout(pollTimer);
            clearInterval(progressTimer);
            polling = false;
            if (out) out.innerHTML = `<div class="notice bad"><b>${safe(job.error || "This version did not pass our checks, so nothing was published.")}</b><small>Build reference: ${safe(job.correlation_id || correlationId)}</small><button type="button" class="btn sm ember" data-retry-forge>Try again</button></div>`;
            $("[data-retry-forge]", out)?.addEventListener("click", () => intakeForm.requestSubmit(), { once: true });
            btn.disabled = false;
            if (btnLabel) btnLabel.textContent = original;
          } else if (Date.now() - pollStartedAt > 180_000) {
            clearTimeout(pollTimer);
            polling = false;
            if (out) out.innerHTML = `<div class="notice bad"><b>This preview is taking longer than expected.</b><small>Build reference: ${safe(job.correlation_id || correlationId)}</small><button type="button" class="btn sm ember" data-retry-forge>Try again</button></div>`;
            $("[data-retry-forge]", out)?.addEventListener("click", () => intakeForm.requestSubmit(), { once: true });
            btn.disabled = false;
            if (btnLabel) btnLabel.textContent = original;
          } else {
            pollDelay = Math.min(6000, Math.round(pollDelay * 1.25));
            pollTimer = setTimeout(pollJob, pollDelay);
          }
        };
        pollTimer = setTimeout(pollJob, pollDelay);
      } catch (err) {
        clearInterval(progressTimer);
        if (out) out.innerHTML = `<div class="notice bad">${safe(err.message)}</div>`;
      } finally {
        if (!polling && !out?.querySelector(".spinner")) {
          btn.disabled = false;
          if (btnLabel && !/another/.test(btnLabel.textContent)) btnLabel.textContent = original;
        }
      }
    });
  }

  // V7 media engine: dropzones (logo + photos)
  $$("[data-dropzone]").forEach((zone) => {
    const input = $("input[type=file]", zone);
    const label = $("span", zone);
    const orig = label?.textContent;
    const refresh = () => {
      const n = input.files?.length || 0;
      zone.classList.toggle("has-file", n > 0);
      if (label) label.textContent = n ? `${n} file${n > 1 ? "s" : ""} ready — hit Upload` : orig;
    };
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault(); zone.classList.remove("drag");
      if (e.dataTransfer?.files?.length) { input.files = e.dataTransfer.files; refresh(); }
    });
    input.addEventListener("change", refresh);
  });
  const upForm = $("[data-upload-form]");
  if (upForm) upForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("[data-upload-btn]", upForm);
    const status = $("[data-upload-status]", upForm);
    const fd = new FormData(upForm);
    if (![...fd.values()].some((v) => v instanceof File && v.size > 0)) { if (status) status.textContent = "Pick a logo or photos first."; return; }
    btn.disabled = true; btn.textContent = "Uploading…";
    try {
      const r = await fetch(upForm.action, { method: "POST", body: fd, headers: { accept: "application/json", "x-csrf-token": csrf() } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Upload failed (${r.status})`);
      const quality = j.low_quality ? ` ${j.low_quality} photo(s) held for ambiance fallback.` : "";
      if (status) status.textContent = `Uploaded ${j.count} file(s).${quality}`;
      if (upForm.dataset.livePreview) {
        if (status) status.textContent += " Starting live preview...";
        const pr = await fetch(upForm.dataset.livePreview, {
          method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrf(), accept: "application/json" },
          body: JSON.stringify({ _csrf: csrf() }),
        });
        const pj = await pr.json().catch(() => ({}));
        if (!pr.ok) {
          if (status) status.innerHTML = `${j.count} file(s) saved.${quality} ${pj.error || "Run the forge to preview them."} <a href="${location.href}">Refresh asset list</a>`;
        } else {
          if (status) status.textContent = `Uploaded ${j.count} file(s). Re-forging preview...`;
          const poll = setInterval(async () => {
            const jr = await fetch(`/api/jobs/${pj.job_id}`);
            const job = await jr.json();
            if (job.status === "done") {
              clearInterval(poll);
              if (status) status.innerHTML = `Live preview refreshed - <a href="${job.result.preview}" target="_blank" rel="noopener">open v${job.result.version}</a> or <a href="${location.href}">refresh asset list</a>.`;
              btn.disabled = false; btn.textContent = "Upload selected";
            } else if (job.status === "failed") {
              clearInterval(poll);
              if (status) status.textContent = job.error || "Preview re-forge failed.";
              btn.disabled = false; btn.textContent = "Upload selected";
            }
          }, 1500);
          return;
        }
      }
      btn.disabled = false; btn.textContent = "Upload selected";
    } catch (err) {
      if (status) status.textContent = err.message;
      btn.disabled = false; btn.textContent = "Upload selected";
    }
  });

  // V7: pick a proposed logo candidate (exclusive approval)
  $$("[data-pick-logo]").forEach((btn) => btn.addEventListener("click", async () => {
    btn.disabled = true; btn.textContent = "Saving…";
    await fetch(`/api/assets/${btn.dataset.pickLogo}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({ approved: true, exclusive: "logo-candidate" }),
    }).catch(() => {});
    location.reload();
  }));

  // Consent banner
  const consent = $("#consent");
  if (consent && !localStorage.getItem("sf-consent")) {
    consent.hidden = false;
    $("#consent-ok")?.addEventListener("click", () => { localStorage.setItem("sf-consent", "1"); consent.hidden = true; });
  }
})();
