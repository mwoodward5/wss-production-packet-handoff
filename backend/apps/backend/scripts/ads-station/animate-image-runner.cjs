'use strict';

/**
 * Google Ads hero forge runner.
 *
 * verified raw client photo -> optional standalone Image Editor remaster -> save to
 * Asset Library -> upload those exact verified source bytes to Animation Creator ->
 * enhanced variants -> Horizontal 1.91:1 -> animated MP4 -> human review.
 *
 * The runner reads account scope and in-memory auth state from the owner's CDP
 * browser, then works in its own hidden Chrome by default. It never closes the
 * owner's browser, persists auth state, touches campaigns, or approves a clip.
 */

const crypto = require("node:crypto");
const { spawnSync, execFile } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");
const {
  DIRECT_SOURCE_RECIPE,
  DIRECT_SOURCE_RECIPE_SHA256,
  REMASTER_PROMPT,
  REMASTER_PROMPT_SHA256,
  validateHeroClip,
} = require("../../lib/hero-clip-validation");

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9223";
const WIZARD_PATH = "/aw/assetstudio/animationcreator";
const IMAGE_EDITOR_PATH = "/aw/imageeditor/main";
const ADS_ACCOUNT_PARAM_KEYS = Object.freeze(["ocid", "euid", "__u", "uscid", "__c", "authuser"]);
// A verified live upload on 2026-08-23 completed just after the old 40-second
// deadline. Waiting longer does not add provider calls; it only lets the one
// exact, already-uploaded client photo finish binding in Google's UI.
const WIZARD_SOURCE_BIND_TIMEOUT_MS = 90000;

const CLICK_TEXT_WHITELIST = Object.freeze([
  "choose image to edit", "choose source image", "upload", "edit with help from google ai", "generate", "generate images",
  "create", "apply", "save", "save and close", "asset library", "select optimized asset",
  "select enhanced image", "horizontal 1.91:1", "next", "continue",
  "accept", "create enhanced images", "create animated clips", "close",
  "cancel", "done", "remove asset",
]);

const WORKFLOW_STAGES = Object.freeze([
  "edit_raw_image",
  "save_optimized_asset",
  "select_exact_optimized_asset",
  "create_enhanced_variants",
  "select_horizontal_1_91",
  "animate_clip",
  "require_human_review",
]);

const DIRECT_WORKFLOW_STAGES = Object.freeze([
  "select_exact_source_asset",
  "create_enhanced_variants",
  "select_horizontal_1_91",
  "animate_clip",
  "require_human_review",
]);

const DENIED_CLICK_RE = /\b(?:publish|campaign|youtube|billing|payment|password|credential|extension)\b/i;
const DENIED_MEDIA_RE = /(?:foryouview|product[-_/ ]?tour|(?:^|[\/_-])tour(?:[\/_\-.]|$)|onboarding|tutorial|promo(?:tion)?|walkthrough)/i;
const GOOGLE_MEDIA_HOST_RE = /(?:^|\.)(?:google\.com|googleusercontent\.com|googlevideo\.com|gstatic\.com|googleapis\.com|googlesyndication\.com)$/i;
const SAVE_AND_CLOSE_RE = /^save\s+(?:and|&)\s+close$/i;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function cleanAdsParams(value) { return String(value || "").replace(/^[?]+/, ""); }

function safeAdsAccountParamsFromUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "ads.google.com") return "";
    if (!parsed.pathname.startsWith("/aw/")) return "";

    const safe = new URLSearchParams();
    for (const key of ADS_ACCOUNT_PARAM_KEYS) {
      const candidate = parsed.searchParams.get(key);
      if (!/^\d{1,32}$/.test(String(candidate || ""))) continue;
      safe.set(key, candidate);
    }
    if (!safe.has("ocid") && !safe.has("uscid")) return "";
    return safe.toString();
  } catch {
    return "";
  }
}

function resolveAdsParams(explicit, pages = []) {
  const configured = cleanAdsParams(explicit).trim();
  if (configured) return configured;

  let best = { params: "", score: -1 };
  for (const page of Array.isArray(pages) ? pages : []) {
    const pageUrl = typeof page === "string"
      ? page
      : page && typeof page.url === "function" ? page.url() : "";
    const params = safeAdsAccountParamsFromUrl(pageUrl);
    if (!params) continue;
    const parsed = new URLSearchParams(params);
    const score = [...parsed.keys()].length
      + (parsed.has("ocid") ? 10 : 0)
      + (parsed.has("uscid") ? 5 : 0);
    if (score > best.score) best = { params, score };
  }
  return best.params;
}

function backgroundBrowserEnabled(env = process.env) {
  const configured = String(env.ADS_STATION_BACKGROUND_BROWSER ?? "").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(configured);
}

function resolveBackgroundBrowserExecutable(env = process.env, {
  existsSync = fs.existsSync,
  platform = process.platform,
} = {}) {
  const configured = String(env.ADS_STATION_BROWSER_EXECUTABLE || "").trim();
  if (configured) return existsSync(configured) ? path.resolve(configured) : null;
  if (platform !== "win32") return null;

  const candidates = [
    path.win32.join(String(env.PROGRAMFILES || "C:\\Program Files"), "Google", "Chrome", "Application", "chrome.exe"),
    path.win32.join(String(env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)"), "Google", "Chrome", "Application", "chrome.exe"),
    ...(env.LOCALAPPDATA
      ? [path.win32.join(String(env.LOCALAPPDATA), "Google", "Chrome", "Application", "chrome.exe")]
      : []),
  ];
  return [...new Set(candidates)].find((candidate) => existsSync(candidate)) || null;
}

function scopedGoogleStorageState(value) {
  if (!value || typeof value !== "object") return null;
  const isGoogleHost = (candidate) => {
    const host = String(candidate || "").trim().toLowerCase().replace(/^\.+/, "");
    return host === "google.com" || host.endsWith(".google.com");
  };
  const cookies = (Array.isArray(value.cookies) ? value.cookies : [])
    .filter((cookie) => cookie && isGoogleHost(cookie.domain));
  const origins = (Array.isArray(value.origins) ? value.origins : [])
    .filter((origin) => {
      try {
        const parsed = new URL(String(origin && origin.origin || ""));
        return parsed.protocol === "https:" && isGoogleHost(parsed.hostname);
      } catch { return false; }
    });
  return cookies.length || origins.length ? { cookies, origins } : null;
}

async function openAdsBrowserSession(browserDriver, job = {}, {
  env = process.env,
  existsSync = fs.existsSync,
  platform = process.platform,
} = {}) {
  let sourceBrowser;
  try {
    sourceBrowser = await browserDriver.connectOverCDP(job.cdpUrl || CDP_URL, { timeout: 60000 });
  } catch {
    return { ok: false, reason: "cdp_connection_failed" };
  }
  const sourceContext = sourceBrowser.contexts()[0];
  if (!sourceContext) return { ok: false, reason: "cdp_context_not_found" };
  const adsParams = resolveAdsParams(
    job.adsParams,
    typeof sourceContext.pages === "function" ? sourceContext.pages() : [],
  );
  const accountScope = adsWizardScopeAssessment(wizardUrl(adsParams), adsParams);
  if (!accountScope.ok) return accountScope;

  if (!backgroundBrowserEnabled(env)) {
    return {
      ok: true,
      background: false,
      context: sourceContext,
      adsParams,
      async close() {},
    };
  }

  const executablePath = resolveBackgroundBrowserExecutable(env, { existsSync, platform });
  if (!executablePath) return { ok: false, reason: "background_browser_executable_not_found" };
  let storageState;
  try {
    // This object stays in memory. Never persist, stringify, log, or return it.
    storageState = scopedGoogleStorageState(await sourceContext.storageState());
  } catch {
    return { ok: false, reason: "background_browser_storage_state_unavailable" };
  }
  if (!storageState) return { ok: false, reason: "background_browser_google_state_unavailable" };

  let hiddenBrowser = null;
  let hiddenContext = null;
  try {
    hiddenBrowser = await browserDriver.launch({
      headless: true,
      executablePath,
      args: ["--disable-dev-shm-usage"],
    });
    hiddenContext = await hiddenBrowser.newContext({ storageState });
  } catch {
    if (hiddenBrowser) await hiddenBrowser.close().catch(() => {});
    return { ok: false, reason: "background_browser_launch_failed" };
  } finally {
    storageState = null;
  }

  return {
    ok: true,
    background: true,
    context: hiddenContext,
    adsParams,
    async close() {
      await hiddenContext.close().catch(() => {});
      await hiddenBrowser.close().catch(() => {});
    },
  };
}

function wizardUrl(adsParams) {
  const query = cleanAdsParams(adsParams);
  return `https://ads.google.com${WIZARD_PATH}${query ? `?${query}` : ""}`;
}

function imageEditorUrl(adsParams) {
  const query = cleanAdsParams(adsParams);
  const returnTo = `${WIZARD_PATH}${query ? `?${query}` : ""}`;
  const editorQuery = new URLSearchParams(query);
  editorQuery.set("returnTo", returnTo);
  return `https://ads.google.com${IMAGE_EDITOR_PATH}?${editorQuery.toString()}`;
}

function adsPageScopeAssessment(value, adsParams, expectedPath, routeReason = "ads_editor_route_not_confirmed") {
  let actual;
  try { actual = new URL(String(value || "")); }
  catch { return { ok: false, reason: routeReason }; }
  if (actual.protocol !== "https:" || actual.hostname.toLowerCase() !== "ads.google.com") {
    return { ok: false, reason: routeReason };
  }
  if (/^\/nav\/selectaccount\/?$/i.test(actual.pathname)) {
    return { ok: false, reason: "ads_account_scope_not_confirmed" };
  }
  if (actual.pathname !== expectedPath) {
    return { ok: false, reason: routeReason };
  }

  const expected = new URLSearchParams(cleanAdsParams(adsParams));
  const expectedAccountKeys = ["ocid", "uscid"].filter((key) => expected.getAll(key).length > 0);
  const requiredKeys = [...expectedAccountKeys, "authuser"];
  if (!expectedAccountKeys.length || requiredKeys.some((key) => {
    const wanted = expected.getAll(key);
    const received = actual.searchParams.getAll(key);
    return wanted.length !== 1 || received.length !== 1 || received[0] !== wanted[0];
  })) {
    return { ok: false, reason: "ads_account_scope_not_confirmed" };
  }
  return { ok: true };
}

function adsEditorScopeAssessment(value, adsParams) {
  return adsPageScopeAssessment(value, adsParams, IMAGE_EDITOR_PATH);
}

function adsWizardScopeAssessment(value, adsParams) {
  return adsPageScopeAssessment(value, adsParams, WIZARD_PATH, "ads_wizard_route_not_confirmed");
}

async function editorUploadHandleIsUsable(input) {
  return Boolean(input && await input.evaluate((element) => (
    element.isConnected && element.type === "file" && !element.disabled
  )).catch(() => false));
}

async function waitForEditorUploadInput(page, {
  attempts = 80,
  pollMs = 250,
  sleepImpl = sleep,
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const picker = page.getByRole("dialog", { name: /choose an image to add/i }).first();
    const scoped = picker.locator('input[type="file"][accept*="image/"]');
    const scopedCount = await scoped.count().catch(() => 0);
    if (scopedCount > 1) return { ok: false, reason: "image_editor_upload_input_ambiguous" };
    if (scopedCount === 1) {
      const input = await scoped.first().elementHandle().catch(() => null);
      if (await editorUploadHandleIsUsable(input)) return { ok: true, input };
    }
    const imageOnly = page.locator('input[type="file"][accept*="image/"]');
    const imageOnlyCount = await imageOnly.count().catch(() => 0);
    if (imageOnlyCount > 1) return { ok: false, reason: "image_editor_upload_input_ambiguous" };
    if (imageOnlyCount === 1) {
      const input = await imageOnly.first().elementHandle().catch(() => null);
      if (await editorUploadHandleIsUsable(input)) return { ok: true, input };
    }
    if (attempt + 1 < attempts) await sleepImpl(pollMs);
  }
  return { ok: false, reason: "image_editor_upload_input_not_found" };
}

async function wizardSourceUploadHandleIsUsable(input) {
  return Boolean(input && await input.evaluate((element) => {
    if (!element.isConnected || element.type !== "file" || element.disabled || element.multiple
        || (element.files && element.files.length !== 0)) return false;
    const accepted = String(element.accept || "").toLowerCase().split(",")
      .map((value) => value.trim()).filter(Boolean);
    const allowed = new Set(["image/jpeg", "image/jpg", "image/png"]);
    return accepted.length >= 2
      && accepted.every((value) => allowed.has(value))
      && accepted.includes("image/png")
      && (accepted.includes("image/jpeg") || accepted.includes("image/jpg"));
  }).catch(() => false));
}

async function wizardSourceUploadHandleIsOwnedByPanel(input, panelId) {
  return Boolean(input && await input.evaluate((element, expectedPanelId) => {
    if (!element.isConnected || element.type !== "file" || element.disabled || element.multiple
        || (element.files && element.files.length !== 0)) return false;
    const panel = element.closest?.('[role="tabpanel"]');
    if (!panel || panel.id !== expectedPanelId || panel.getAttribute?.("role") !== "tabpanel"
        || panel.hidden || panel.inert || panel.getAttribute?.("aria-hidden") === "true") return false;
    const accepted = String(element.accept || "").toLowerCase().split(",")
      .map((value) => value.trim()).filter(Boolean);
    const allowed = new Set(["image/jpeg", "image/jpg", "image/png"]);
    return accepted.length >= 2 && accepted.every((value) => allowed.has(value))
      && accepted.includes("image/png")
      && (accepted.includes("image/jpeg") || accepted.includes("image/jpg"));
  }, panelId).catch(() => false));
}

async function waitForWizardSourceUploadInput(page, {
  attempts = 80,
  pollMs = 250,
  sleepImpl = sleep,
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const handles = await page.locator('input[type="file"]').elementHandles().catch(() => []);
    const candidates = [];
    for (const handle of handles) {
      if (await wizardSourceUploadHandleIsUsable(handle)) candidates.push(handle);
    }
    if (candidates.length > 1) return { ok: false, reason: "optimized_asset_upload_input_ambiguous" };
    if (candidates.length === 1) return { ok: true, input: candidates[0] };
    if (attempt + 1 < attempts) await sleepImpl(pollMs);
  }
  return { ok: false, reason: "optimized_asset_upload_input_not_found" };
}

function wizardSourceCountValue(value) {
  const match = String(value || "").match(/source image\s*\((\d+)\/1\)/i);
  const count = match ? Number(match[1]) : null;
  return count === 0 || count === 1 ? count : null;
}

const WIZARD_SOURCE_STEP_TAB_SELECTOR = '[role="tab"][aria-label="Step 1 of 3, Choose source image"]';
const WIZARD_SOURCE_PANEL_SELECTOR = '[role="tabpanel"]';
const WIZARD_SOURCE_GROUP_SELECTOR = 'div.asset-thumbnail[role="group"][aria-label^="Preview card for Image asset named ("]';

async function wizardSourceStepTabAssessment(control) {
  return control?.evaluate((element) => {
    const visible = (target) => {
      const rect = target.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      for (let node = target; node; node = node.parentElement) {
        const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
        if (!node.isConnected || node.hidden || node.inert || node.getAttribute?.("aria-hidden") === "true"
            || (style && (style.display === "none" || style.visibility === "hidden"
              || style.visibility === "collapse" || Number(style.opacity || "1") <= 0))) return false;
      }
      return true;
    };
    const panelId = String(element.getAttribute?.("aria-controls") || "");
    const exact = element.getAttribute?.("role") === "tab"
      && element.getAttribute?.("aria-label") === "Step 1 of 3, Choose source image";
    return {
      usable: Boolean(exact && visible(element) && !element.disabled && !element.hasAttribute?.("disabled")
        && element.getAttribute?.("aria-disabled") !== "true" && /^[A-Za-z0-9_.:-]{1,120}$/.test(panelId)),
      selected: element.getAttribute?.("aria-selected") === "true",
      panelId,
    };
  }).catch(() => ({ usable: false, selected: false, panelId: "" }));
}

async function wizardSourcePanelAssessment(panel, panelId) {
  return panel?.evaluate((element, expectedId) => {
    const visible = (target) => {
      for (let node = target; node; node = node.parentElement) {
        const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
        if (!node.isConnected || node.hidden || node.inert || node.getAttribute?.("aria-hidden") === "true"
            || (style && (style.display === "none" || style.visibility === "hidden"
              || style.visibility === "collapse" || Number(style.opacity || "1") <= 0))) return false;
      }
      return true;
    };
    return {
      exact: Boolean(element.isConnected && element.getAttribute?.("role") === "tabpanel"
        && element.id === expectedId),
      active: Boolean(element.getAttribute?.("role") === "tabpanel" && element.id === expectedId
        && visible(element)),
    };
  }, panelId).catch(() => ({ exact: false, active: false }));
}

async function resolveWizardSourceStepOne(page) {
  const tabHandles = await page.locator(WIZARD_SOURCE_STEP_TAB_SELECTOR).elementHandles().catch(() => []);
  const tabs = [];
  for (const control of tabHandles) {
    const assessment = await wizardSourceStepTabAssessment(control);
    if (assessment.usable) tabs.push({ control, assessment });
  }
  if (tabs.length > 1) return { ok: false, reason: "wizard_source_step1_tab_ambiguous" };
  if (tabs.length !== 1) return { ok: false, reason: "wizard_source_step1_tab_not_found" };

  const panels = [];
  const panelHandles = await page.locator(WIZARD_SOURCE_PANEL_SELECTOR).elementHandles().catch(() => []);
  for (const panel of panelHandles) {
    const assessment = await wizardSourcePanelAssessment(panel, tabs[0].assessment.panelId);
    if (assessment.exact) panels.push({ panel, assessment });
  }
  if (panels.length > 1) return { ok: false, reason: "wizard_source_step1_panel_ambiguous" };
  if (panels.length !== 1) return { ok: false, reason: "wizard_source_step1_panel_not_found" };
  return {
    ok: true,
    tab: tabs[0].control,
    panel: panels[0].panel,
    panelId: tabs[0].assessment.panelId,
    selected: tabs[0].assessment.selected,
    active: panels[0].assessment.active,
  };
}

async function activateWizardSourceStepOne(page, adsParams, {
  attempts = 40, pollMs = 250, sleepImpl = sleep, resolveImpl = resolveWizardSourceStepOne,
} = {}) {
  let context = await resolveImpl(page);
  if (!context.ok) return context;
  if (!(context.selected && context.active)) {
    const scope = adsWizardScopeAssessment(page.url(), adsParams);
    if (!scope.ok) return scope;
    const tab = await wizardSourceStepTabAssessment(context.tab);
    if (!tab.usable || tab.panelId !== context.panelId) {
      return { ok: false, reason: "wizard_source_step1_tab_detached" };
    }
    if (!(await clickControl(context.tab, "choose source image"))) {
      return { ok: false, reason: "wizard_source_step1_click_failed" };
    }
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const scope = adsWizardScopeAssessment(page.url(), adsParams);
    if (!scope.ok) return scope;
    context = await resolveImpl(page);
    if (!context.ok) return context;
    if (context.selected && context.active) return context;
    if (attempt + 1 < attempts) await sleepImpl(pollMs);
  }
  return { ok: false, reason: "wizard_source_step1_not_confirmed" };
}

async function wizardSourcePanelState(panel) {
  return panel?.evaluate((root, groupSelector) => {
    const visible = (target) => {
      const rect = target.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      for (let node = target; node; node = node.parentElement) {
        const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
        if (!node.isConnected || node.hidden || node.inert || node.getAttribute?.("aria-hidden") === "true"
            || (style && (style.display === "none" || style.visibility === "hidden"
              || style.visibility === "collapse" || Number(style.opacity || "1") <= 0))) return false;
      }
      return true;
    };
    const label = (element) => String(element.getAttribute?.("aria-label") || element.getAttribute?.("title")
      || element.innerText || element.textContent || "").trim().replace(/\s+/g, " ");
    const headingElements = [...root.querySelectorAll("h1, h2, h3, h4, [role='heading']")]
      .filter(visible).filter((element) => /^Source image\s*\(\d+\/1\)$/i.test(
        String(element.textContent || "").trim(),
      ));
    const headings = headingElements.map((element) => String(element.textContent || "").trim());
    let counterState = "absent";
    let counterValue = null;
    if (headings.length > 1) counterState = "ambiguous";
    else if (headings.length === 1) {
      const match = headings[0].match(/Source image\s*\((\d+)\/1\)/i);
      counterValue = match ? Number(match[1]) : null;
      counterState = counterValue === 0 ? "zero" : counterValue === 1 ? "one" : "unreadable";
    }

    // Step 1 also contains the Asset Library grid. Its cards/images are not the
    // wizard's selected source and must never make a clean source slot look
    // occupied. The selected-source contract is the panel-owned shopping-cart;
    // count every shape inside that container so unknown source-card markup
    // still fails closed, while ignoring unrelated library cards outside it.
    const carts = [...root.querySelectorAll("shopping-cart")].filter(visible);
    const counterCartCount = headingElements.filter((element) => {
      const cart = element.closest?.("shopping-cart");
      return Boolean(cart && carts.includes(cart));
    }).length;
    const allGroups = carts.flatMap((cart) => [...cart.querySelectorAll('[role="group"]')].filter(visible));
    const allImages = carts.flatMap((cart) => [...cart.querySelectorAll("img.asset-thumbnail-img")].filter(visible));
    const allRemoveControls = carts.flatMap((cart) => [...cart.querySelectorAll(
      '[aria-label="Remove asset"], [title="Remove asset"], button, material-button, [role="button"]',
    )].filter((element) => label(element) === "Remove asset" && visible(element)
      && !element.disabled && !element.hasAttribute?.("disabled")
      && element.getAttribute?.("aria-disabled") !== "true"));
    const groups = carts.flatMap((cart) => [...cart.querySelectorAll(groupSelector)].filter(visible));
    const images = groups.flatMap((group) => [...group.querySelectorAll("img.asset-thumbnail-img")].filter(visible));
    const removeControls = groups.flatMap((group) => [...group.querySelectorAll(
      '[aria-label="Remove asset"], [title="Remove asset"], button, material-button, [role="button"]',
    )].filter((element) => label(element) === "Remove asset" && visible(element)
      && !element.disabled && !element.hasAttribute?.("disabled")
      && element.getAttribute?.("aria-disabled") !== "true"));
    const inputs = [...root.querySelectorAll('input[type="file"]')].filter((element) => {
      const accepted = String(element.accept || "").toLowerCase().split(",")
        .map((value) => value.trim()).filter(Boolean);
      const allowed = new Set(["image/jpeg", "image/jpg", "image/png"]);
      return element.isConnected && !element.disabled && !element.multiple
        && (!element.files || element.files.length === 0)
        && accepted.length >= 2 && accepted.every((value) => allowed.has(value))
        && accepted.includes("image/png")
        && (accepted.includes("image/jpeg") || accepted.includes("image/jpg"));
    });
    const uploadTabs = [...root.querySelectorAll('button, material-button, [role="tab"], [role="button"]')]
      .filter((element) => label(element) === "Upload" && visible(element)
        && !element.disabled && !element.hasAttribute?.("disabled")
        && element.getAttribute?.("aria-disabled") !== "true");
    const choosePrompts = [...root.querySelectorAll("*")].filter((element) => {
      const text = String(element.textContent || "").trim().replace(/\s+/g, " ");
      if (!/^Choose 1 image without faces$/i.test(text) || !visible(element)) return false;
      return ![...element.children].some((child) => /^Choose 1 image without faces$/i.test(
        String(child.textContent || "").trim().replace(/\s+/g, " "),
      ));
    });
    const sourceLabel = groups.length === 1
      ? String(groups[0].getAttribute?.("aria-label") || "") : "";
    const sourceNameMatch = sourceLabel.match(/^Preview card for Image asset named \(([^)]+)\)/);
    return {
      ok: true,
      counterState,
      counterValue,
      counterCount: headings.length,
      counterCartCount,
      cartCount: carts.length,
      allGroupCount: allGroups.length,
      allImageCount: allImages.length,
      allRemoveCount: allRemoveControls.length,
      groupCount: groups.length,
      imageCount: images.length,
      removeCount: removeControls.length,
      pickerCount: inputs.length,
      uploadTabCount: uploadTabs.length,
      choosePromptCount: choosePrompts.length,
      sourceUrl: images.length === 1 ? String(images[0].currentSrc || images[0].src || "") : "",
      sourceName: sourceNameMatch ? sourceNameMatch[1] : "",
      sourceWidth: images.length === 1 ? Number(images[0].naturalWidth || 0) : 0,
      sourceHeight: images.length === 1 ? Number(images[0].naturalHeight || 0) : 0,
    };
  }, WIZARD_SOURCE_GROUP_SELECTOR).catch(() => ({
    ok: false, counterState: "unreadable", counterValue: null, counterCount: 0, counterCartCount: 0,
    cartCount: 0, allGroupCount: 0, allImageCount: 0, allRemoveCount: 0,
    groupCount: 0, imageCount: 0, removeCount: 0, pickerCount: 0,
    uploadTabCount: 0, choosePromptCount: 0, sourceUrl: "", sourceName: "",
    sourceWidth: 0, sourceHeight: 0,
  }));
}

function wizardSourcePanelIsEmpty(state) {
  if (!state?.ok || state.cartCount > 1 || state.allGroupCount !== 0 || state.allImageCount !== 0
      || state.allRemoveCount !== 0 || state.groupCount !== 0 || state.imageCount !== 0
      || state.removeCount !== 0 || state.pickerCount > 1 || state.uploadTabCount > 1
      || state.choosePromptCount > 1) return false;
  if (state.counterState === "zero") {
    return state.cartCount === 1 && state.counterCartCount === 1;
  }
  return state.counterState === "absent" && state.cartCount === 0
    && (state.pickerCount === 1 || (state.uploadTabCount === 1 && state.choosePromptCount === 1));
}

function wizardSourcePanelHasOneAsset(state) {
  return Boolean(state?.ok && (state.counterState === "one" || state.counterState === "absent")
    && state.cartCount === 1 && state.allGroupCount === 1 && state.allImageCount === 1
    && state.allRemoveCount === 1 && state.groupCount === 1 && state.imageCount === 1
    && state.removeCount === 1 && state.sourceUrl);
}

async function wizardSourcePanelRemoveControlIsUsable(control, panelId, sourceUrl) {
  return Boolean(control && await control.evaluate((element, expected) => {
    const visible = (target) => {
      const rect = target.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      for (let node = target; node; node = node.parentElement) {
        const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
        if (!node.isConnected || node.hidden || node.inert || node.getAttribute?.("aria-hidden") === "true"
            || (style && (style.display === "none" || style.visibility === "hidden"
              || style.visibility === "collapse" || Number(style.opacity || "1") <= 0))) return false;
      }
      return true;
    };
    const label = String(element.getAttribute?.("aria-label") || element.getAttribute?.("title")
      || element.innerText || element.textContent || "").trim().replace(/\s+/g, " ");
    const panel = element.closest?.('[role="tabpanel"]');
    const group = element.closest?.('div.asset-thumbnail[role="group"][aria-label^="Preview card for Image asset named ("]');
    const cart = group?.closest?.("shopping-cart");
    const sourceCarts = panel
      ? [...panel.querySelectorAll("shopping-cart")].filter(visible)
      : [];
    if (label !== "Remove asset" || !visible(element) || element.disabled
        || element.hasAttribute?.("disabled") || element.getAttribute?.("aria-disabled") === "true"
        || !panel || panel.id !== expected.panelId || !group || group.closest?.('[role="tabpanel"]') !== panel
        || !cart || cart.closest?.('[role="tabpanel"]') !== panel
        || sourceCarts.length !== 1 || sourceCarts[0] !== cart) return false;
    const images = [...group.querySelectorAll("img.asset-thumbnail-img")].filter(visible);
    return images.length === 1
      && String(images[0].currentSrc || images[0].src || "") === expected.sourceUrl;
  }, { panelId, sourceUrl }).catch(() => false));
}

async function waitForWizardSourcePanelRemoveControl(panel, panelId, sourceUrl, {
  attempts = 40, pollMs = 250, sleepImpl = sleep,
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const cartHandles = await panel.$$("shopping-cart").catch(() => []);
    if (cartHandles.length > 1) {
      return { ok: false, reason: "wizard_source_remove_control_ambiguous" };
    }
    const handles = cartHandles.length === 1
      ? await cartHandles[0].$$(
        '[aria-label="Remove asset"], [title="Remove asset"], button, material-button, [role="button"]',
      ).catch(() => [])
      : [];
    const candidates = [];
    for (const control of handles) {
      if (await wizardSourcePanelRemoveControlIsUsable(control, panelId, sourceUrl)) candidates.push(control);
    }
    if (candidates.length > 1) return { ok: false, reason: "wizard_source_remove_control_ambiguous" };
    if (candidates.length === 1) return { ok: true, control: candidates[0] };
    if (attempt + 1 < attempts) await sleepImpl(pollMs);
  }
  return { ok: false, reason: "wizard_source_remove_control_not_found" };
}

async function wizardSourcePanelUploadControlAssessment(control, panelId) {
  if (!control) return { usable: false, rung: "none" };
  return control.evaluate((element, expectedPanelId) => {
    const rect = element.getBoundingClientRect?.();
    const panel = element.closest?.('[role="tabpanel"]');
    const label = String(element.getAttribute?.("aria-label") || element.innerText
      || element.textContent || "").trim().replace(/\s+/g, " ");
    const role = String(element.getAttribute?.("role") || "").toLowerCase();
    const tag = String(element.tagName || "").toLowerCase();
    const rung = role === "tab" ? "tab"
      : role === "button" || tag === "button" || tag === "material-button" ? "button" : "none";
    let visible = Boolean(rect && rect.width > 0 && rect.height > 0);
    for (let node = element; visible && node; node = node.parentElement) {
      const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
      if (!node.isConnected || node.hidden || node.inert || node.getAttribute?.("aria-hidden") === "true"
          || (style && (style.display === "none" || style.visibility === "hidden"
            || style.visibility === "collapse" || Number(style.opacity || "1") <= 0))) visible = false;
    }
    return { usable: Boolean(visible && rung !== "none" && label === "Upload"
      && !element.disabled && !element.hasAttribute?.("disabled")
      && element.getAttribute?.("aria-disabled") !== "true"
      && panel && panel.id === expectedPanelId), rung };
  }, panelId).catch(() => ({ usable: false, rung: "none" }));
}

async function wizardSourcePanelUploadControlIsUsable(control, panelId) {
  return (await wizardSourcePanelUploadControlAssessment(control, panelId)).usable;
}

async function waitForWizardSourcePanelUploadControl(page, adsParams, {
  attempts = 40, pollMs = 250, sleepImpl = sleep,
} = {}) {
  let lastCounts = { tab_count: 0, button_count: 0 };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const scope = adsWizardScopeAssessment(page.url(), adsParams);
    if (!scope.ok) return scope;
    const context = await resolveWizardSourceStepOne(page);
    if (!context.ok) return context;
    if (!(context.selected && context.active)) return { ok: false, reason: "wizard_source_step1_not_confirmed" };
    const handles = await context.panel.$$('button, material-button, [role="tab"], [role="button"]').catch(() => []);
    const tabs = [];
    const buttons = [];
    for (const control of handles) {
      const assessment = await wizardSourcePanelUploadControlAssessment(control, context.panelId);
      if (assessment.usable) (assessment.rung === "tab" ? tabs : buttons).push(control);
    }
    lastCounts = {
      tab_count: Math.min(2, tabs.length),
      button_count: Math.min(2, buttons.length),
    };
    if (tabs.length + buttons.length > 1) {
      return { ok: false, reason: "wizard_source_upload_tab_ambiguous", detail: lastCounts };
    }
    if (tabs.length === 1) return { ok: true, control: tabs[0], panelId: context.panelId, rung: "tab" };
    if (buttons.length === 1) return { ok: true, control: buttons[0], panelId: context.panelId, rung: "button" };
    if (attempt + 1 < attempts) await sleepImpl(pollMs);
  }
  return { ok: false, reason: "wizard_source_upload_tab_not_found", detail: lastCounts };
}

async function visibleWizardSourceCounter(page) {
  try {
    const values = await page.getByText(/^Source image\s*\(\d+\/1\)$/i).evaluateAll((elements) => {
      const visible = (element) => {
        for (let node = element; node; node = node.parentElement) {
          const rect = node.getBoundingClientRect?.();
          const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
          if (!node.isConnected || node.hidden || node.inert || node.getAttribute?.("aria-hidden") === "true"
              || !rect || rect.width <= 0 || rect.height <= 0
              || (style && (style.display === "none" || style.visibility === "hidden"
                || style.visibility === "collapse" || Number(style.opacity || "1") <= 0))) return false;
        }
        return true;
      };
      return elements.filter(visible).map((element) => String(element.textContent || "").trim());
    });
    if (!Array.isArray(values)) return { ok: false, state: "unreadable", visibleCount: 0, value: null };
    if (!values.length) return { ok: true, state: "absent", visibleCount: 0, value: null };
    if (values.length !== 1) return { ok: false, state: "ambiguous", visibleCount: values.length, value: null };
    const value = wizardSourceCountValue(values[0]);
    return value === null
      ? { ok: false, state: "unreadable", visibleCount: 1, value: null }
      : { ok: true, state: value === 0 ? "zero" : "one", visibleCount: 1, value };
  } catch {
    return { ok: false, state: "unreadable", visibleCount: 0, value: null };
  }
}

async function wizardSourceImageDescriptors(page) {
  return page.locator("img.image-for-animation").evaluateAll((images) => images.map((image) => {
    const rect = image.getBoundingClientRect();
    return {
      src: image.currentSrc || image.src || "",
      naturalWidth: Number(image.naturalWidth || 0),
      naturalHeight: Number(image.naturalHeight || 0),
      visible: rect.width > 0 && rect.height > 0,
    };
  })).catch(() => []);
}

const verifiedWizardEmptyProofs = new WeakMap();

async function sameWizardSourcePanelNode(panel, expectedPanel) {
  if (!panel || !expectedPanel) return false;
  if (panel === expectedPanel) return true;
  return Boolean(await panel.evaluate((element, expected) => element === expected, expectedPanel).catch(() => false));
}

function wizardEmptyProof(removed, page, adsParams, panelId, panel) {
  const proof = { ok: true, removed: Boolean(removed), sourceCounter: 0, visibleSources: 0 };
  verifiedWizardEmptyProofs.set(proof, {
    page,
    adsParams: cleanAdsParams(adsParams),
    panelId,
    panel,
  });
  return proof;
}

function wizardSourcePanelStateFailure(state) {
  if (!state?.ok || state.counterState === "unreadable") return "wizard_source_panel_unreadable";
  if (state.counterState === "ambiguous" || state.cartCount > 1 || state.allGroupCount > 1
      || state.allImageCount > 1 || state.allRemoveCount > 1 || state.groupCount > 1
      || state.imageCount > 1 || state.removeCount > 1 || state.pickerCount > 1
      || state.uploadTabCount > 1 || state.choosePromptCount > 1) return "wizard_source_panel_ambiguous";
  if (state.counterState === "zero" && (state.allGroupCount || state.allImageCount
      || state.allRemoveCount || state.groupCount || state.imageCount || state.removeCount
      || (state.cartCount === 1 && state.counterCartCount !== 1))) {
    return "wizard_source_zero_state_inconsistent";
  }
  return "wizard_source_panel_state_not_confirmed";
}

function wizardSourcePanelSafeDetail(state) {
  const count = (value) => Math.min(2, Math.max(0, Number(value) || 0));
  return {
    counter_state: ["absent", "zero", "one", "ambiguous", "unreadable"].includes(state?.counterState)
      ? state.counterState : "unreadable",
    counter_count: count(state?.counterCount),
    cart_count: count(state?.cartCount),
    group_count: count(state?.allGroupCount),
    image_count: count(state?.allImageCount),
    remove_count: count(state?.allRemoveCount),
    picker_count: count(state?.pickerCount),
    upload_count: count(state?.uploadTabCount),
    prompt_count: count(state?.choosePromptCount),
  };
}

async function waitForWizardSourcePanelEmpty(page, adsParams, panelId, {
  attempts = 60, pollMs = 250, sleepImpl = sleep,
  activateImpl = activateWizardSourceStepOne, stateImpl = wizardSourcePanelState,
} = {}) {
  let lastState = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const context = await activateImpl(page, adsParams, { attempts: 1, pollMs: 0, sleepImpl });
    if (!context.ok) return context;
    if (context.panelId !== panelId) return { ok: false, reason: "wizard_source_step1_panel_changed" };
    const state = await stateImpl(context.panel);
    lastState = state;
    if (wizardSourcePanelIsEmpty(state)) return { ok: true, context, state };
    if (!state?.ok || state.counterState === "unreadable" || state.counterState === "ambiguous"
        || state.cartCount > 1 || state.allGroupCount > 1 || state.allImageCount > 1
        || state.allRemoveCount > 1 || state.groupCount > 1 || state.imageCount > 1
        || state.removeCount > 1 || state.pickerCount > 1 || state.uploadTabCount > 1
        || state.choosePromptCount > 1) {
      return { ok: false, reason: wizardSourcePanelStateFailure(state), detail: wizardSourcePanelSafeDetail(state) };
    }
    if (attempt + 1 < attempts) await sleepImpl(pollMs);
  }
  return {
    ok: false,
    reason: "wizard_source_remove_not_reflected",
    detail: wizardSourcePanelSafeDetail(lastState),
  };
}

async function clearWizardSource(page, adsParams, options = {}) {
  const initialScope = adsWizardScopeAssessment(page.url(), adsParams);
  if (!initialScope.ok) return initialScope;
  const context = await activateWizardSourceStepOne(page, adsParams, options);
  if (!context.ok) return context;
  const state = await wizardSourcePanelState(context.panel);
  if (wizardSourcePanelIsEmpty(state)) {
    return wizardEmptyProof(false, page, adsParams, context.panelId, context.panel);
  }
  if (!wizardSourcePanelHasOneAsset(state)) {
    return {
      ok: false,
      reason: wizardSourcePanelStateFailure(state),
      detail: wizardSourcePanelSafeDetail(state),
    };
  }
  const remove = await waitForWizardSourcePanelRemoveControl(
    context.panel,
    context.panelId,
    state.sourceUrl,
    options,
  );
  if (!remove.ok) return { ...remove, detail: wizardSourcePanelSafeDetail(state) };
  const scope = adsWizardScopeAssessment(page.url(), adsParams);
  if (!scope.ok) return scope;
  const beforeClick = await activateWizardSourceStepOne(page, adsParams, { ...options, attempts: 1 });
  if (!beforeClick.ok) return beforeClick;
  if (beforeClick.panelId !== context.panelId) {
    return { ok: false, reason: "wizard_source_step1_panel_changed" };
  }
  const beforeState = await wizardSourcePanelState(beforeClick.panel);
  if (!wizardSourcePanelHasOneAsset(beforeState) || beforeState.sourceUrl !== state.sourceUrl
      || !(await wizardSourcePanelRemoveControlIsUsable(remove.control, context.panelId, state.sourceUrl))) {
    return {
      ok: false,
      reason: "wizard_source_remove_control_detached",
      detail: wizardSourcePanelSafeDetail(beforeState),
    };
  }
  if (!(await clickControl(remove.control, "remove asset"))) {
    return { ok: false, reason: "wizard_source_remove_failed" };
  }
  const cleared = await waitForWizardSourcePanelEmpty(page, adsParams, context.panelId, options);
  if (!cleared.ok) return cleared;
  return wizardEmptyProof(true, page, adsParams, context.panelId, cleared.context.panel);
}

function sourceBindingTimeoutReason(counterState, selectedCount, responseCount) {
  const counter = { absent: "absent", zero: "zero", one: "one", ambiguous: "ambiguous", unreadable: "unreadable" }[counterState]
    || "unreadable";
  const selected = Math.min(2, Math.max(0, Number(selectedCount) || 0));
  const responses = Math.min(2, Math.max(0, Number(responseCount) || 0));
  return `wizard_source_post_upload_timeout_counter_${counter}_selected_${selected}_responses_${responses}`;
}

async function waitForBoundWizardSource(page, responseCapture, {
  timeoutMs = WIZARD_SOURCE_BIND_TIMEOUT_MS, pollMs = 500, sleepImpl = sleep,
  adsParams = "", expectedPanelId = "", expectedSourceName = "", expectedSourceSha256 = "",
  resolveImpl = resolveWizardSourceStepOne, stateImpl = wizardSourcePanelState,
} = {}) {
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(expectedPanelId)
      || !/^wss-(?:source|remaster)-[0-9a-f]{16}\.(?:jpg|png)$/.test(expectedSourceName)
      || !/^[0-9a-f]{64}$/.test(expectedSourceSha256)
      || !expectedSourceName.includes(expectedSourceSha256.slice(0, 16))) {
    return { ok: false, reason: "wizard_source_binding_identity_required" };
  }
  const deadline = Date.now() + timeoutMs;
  let counterState = "unreadable";
  let selectedCount = 0;
  let responseCount = 0;
  while (Date.now() < deadline) {
    const scope = adsWizardScopeAssessment(page.url(), adsParams);
    if (!scope.ok) return scope;
    const context = await resolveImpl(page);
    if (!context.ok) return context;
    if (context.panelId !== expectedPanelId) {
      return { ok: false, reason: "wizard_source_step1_panel_changed" };
    }
    if (!context.selected || !context.active) {
      return { ok: false, reason: "wizard_source_step1_not_confirmed" };
    }
    const state = await stateImpl(context.panel);
    counterState = state?.counterState || "unreadable";
    selectedCount = Number(state?.imageCount || 0);
    if (!state?.ok || state.counterState === "unreadable" || state.counterState === "ambiguous"
        || state.cartCount > 1 || state.allGroupCount > 1 || state.allImageCount > 1
        || state.allRemoveCount > 1 || state.groupCount > 1 || state.imageCount > 1
        || state.removeCount > 1) {
      return { ok: false, reason: "wizard_source_post_upload_ambiguous" };
    }
    if (state.counterState === "zero" && (state.allGroupCount || state.allImageCount
        || state.allRemoveCount || state.groupCount || state.imageCount || state.removeCount)) {
      return { ok: false, reason: "wizard_source_zero_state_inconsistent" };
    }
    if (wizardSourcePanelHasOneAsset(state)) {
      if (state.sourceName !== expectedSourceName) {
        return { ok: false, reason: "wizard_source_post_upload_name_mismatch" };
      }
      if (state.sourceWidth > 0 && state.sourceHeight > 0) {
        const responses = await responseCapture.snapshot({
          timeoutMs: Math.min(3000, Math.max(1, deadline - Date.now())),
        });
        responseCount = responses.length;
        const assessment = capturedImageResponseAssessment(responses, state.sourceUrl, expectedSourceSha256);
        if (assessment.identityMatched && !(assessment.captured || assessment.unchanged)) {
          return { ok: false, reason: "wizard_source_response_invalid" };
        }
        return {
          ok: true,
          sourceUrl: state.sourceUrl,
          sourceSha256: expectedSourceSha256,
          sourceWidth: state.sourceWidth,
          sourceHeight: state.sourceHeight,
          sourceBinding: assessment.identityMatched ? "panel_filename_and_response" : "panel_filename",
        };
      }
    }
    await sleepImpl(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
  return {
    ok: false,
    reason: sourceBindingTimeoutReason(counterState, selectedCount, responseCount),
    detail: { counterState, selectedCount: Math.min(2, selectedCount), responseCount: Math.min(2, responseCount) },
  };
}

async function uploadExactWizardSource(page, input, payload, options = {}) {
  const proof = verifiedWizardEmptyProofs.get(options.emptyProof);
  if (!proof || proof.page !== page || proof.adsParams !== cleanAdsParams(options.adsParams)) {
    return { ok: false, reason: "wizard_source_empty_proof_required" };
  }
  const scope = adsWizardScopeAssessment(page.url(), options.adsParams);
  if (!scope.ok) return scope;
  const context = await resolveWizardSourceStepOne(page);
  if (!context.ok) return context;
  if (!context.selected || !context.active || context.panelId !== proof.panelId
      || !(await sameWizardSourcePanelNode(context.panel, proof.panel))) {
    return { ok: false, reason: "wizard_source_empty_proof_stale" };
  }
  const state = await wizardSourcePanelState(context.panel);
  if (!wizardSourcePanelIsEmpty(state) || state.pickerCount !== 1) {
    return { ok: false, reason: "wizard_source_empty_proof_stale" };
  }
  if (!(await wizardSourceUploadHandleIsOwnedByPanel(input, proof.panelId))) {
    return { ok: false, reason: "wizard_source_upload_input_not_owned" };
  }
  const finalState = await wizardSourcePanelState(context.panel);
  if (!wizardSourcePanelIsEmpty(finalState) || finalState.pickerCount !== 1
      || !(await wizardSourceUploadHandleIsOwnedByPanel(input, proof.panelId))) {
    return { ok: false, reason: "wizard_source_empty_proof_stale" };
  }
  const finalScope = adsWizardScopeAssessment(page.url(), options.adsParams);
  if (!finalScope.ok) return finalScope;
  const payloadBytes = Buffer.isBuffer(payload?.buffer) ? payload.buffer : null;
  const payloadSha256 = payloadBytes ? sha256Hex(payloadBytes) : "";
  const payloadName = String(payload?.name || "");
  const payloadMime = String(payload?.mimeType || "");
  const payloadIsPng = payloadBytes?.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const payloadIsJpeg = Boolean(payloadBytes && payloadBytes.length >= 3
    && payloadBytes[0] === 0xff && payloadBytes[1] === 0xd8 && payloadBytes[2] === 0xff);
  const expectedName = `wss-${payloadName.startsWith("wss-remaster-") ? "remaster" : "source"}-${payloadSha256.slice(0, 16)}.${payloadIsPng ? "png" : "jpg"}`;
  if (!payloadBytes || !/^[0-9a-f]{64}$/.test(payloadSha256)
      || payloadName !== expectedName
      || (payloadIsPng && payloadMime !== "image/png")
      || (payloadIsJpeg && payloadMime !== "image/jpeg")
      || (!payloadIsPng && !payloadIsJpeg)) {
    return { ok: false, reason: "wizard_source_upload_identity_invalid" };
  }
  verifiedWizardEmptyProofs.delete(options.emptyProof);
  const responses = createImageResponseCapture(page);
  responses.arm();
  try {
    try { await input.setInputFiles(payload); }
    catch { return { ok: false, reason: "wizard_source_upload_failed" }; }
    return await waitForBoundWizardSource(page, responses, {
      ...options,
      expectedPanelId: proof.panelId,
      expectedSourceName: payloadName,
      expectedSourceSha256: payloadSha256,
    });
  } finally {
    responses.stop();
  }
}

function normalizeClickLabel(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isClickWhitelisted(value) {
  const label = normalizeClickLabel(value);
  if (!label || DENIED_CLICK_RE.test(label)) return false;
  return CLICK_TEXT_WHITELIST.includes(label);
}

function assertWhitelistedClick(label) {
  if (!isClickWhitelisted(label)) {
    const error = new Error(`click_not_whitelisted:${normalizeClickLabel(label).slice(0, 80)}`);
    error.code = "click_not_whitelisted";
    throw error;
  }
}

function sha256Hex(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function hasImageMagic(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (bytes.length < 12) return false;
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const gif = ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
  const webp = bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return png || jpeg || gif || webp;
}

function exactImageUploadPayload(value, expectedSha256, namePrefix) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  const expected = String(expectedSha256 || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected) || sha256Hex(bytes) !== expected) return null;
  const png = bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) return null;
  return {
    name: `${namePrefix}-${expected.slice(0, 16)}.${png ? "png" : "jpg"}`,
    mimeType: png ? "image/png" : "image/jpeg",
    buffer: bytes,
  };
}

function exactOptimizedUploadPayload(value, expectedSha256) {
  return exactImageUploadPayload(value, expectedSha256, "wss-remaster");
}

function exactDirectSourceUploadPayload(value, expectedSha256) {
  return exactImageUploadPayload(value, expectedSha256, "wss-source");
}

function hasMp4Magic(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  return bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
}

function parseMp4DurationSeconds(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  const at = bytes.indexOf(Buffer.from("mvhd", "ascii"));
  if (at < 0 || at + 24 > bytes.length) return null;
  const body = at + 4;
  try {
    if (bytes[body] === 0 && body + 20 <= bytes.length) {
      const timescale = bytes.readUInt32BE(body + 12);
      const duration = bytes.readUInt32BE(body + 16);
      return timescale > 0 && duration > 0 ? duration / timescale : null;
    }
    if (bytes[body] === 1 && body + 32 <= bytes.length) {
      const timescale = bytes.readUInt32BE(body + 20);
      const duration = bytes.readBigUInt64BE(body + 24);
      return timescale > 0 && duration > 0n ? Number(duration) / timescale : null;
    }
  } catch { return null; }
  return null;
}

function validateMp4Bytes(value, {
  durationHint = null,
  minBytes = 32,
  minDurationSeconds = 0.25,
  maxDurationSeconds = 30,
} = {}) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (!hasMp4Magic(bytes)) return { ok: false, reason: "clip_not_mp4", bytes: bytes.length };
  if (bytes.length < minBytes) return { ok: false, reason: "clip_too_small", bytes: bytes.length };
  const parsed = parseMp4DurationSeconds(bytes);
  const hinted = Number(durationHint);
  const durationSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed
    : Number.isFinite(hinted) && hinted > 0 ? hinted : null;
  if (!durationSeconds) return { ok: false, reason: "clip_duration_unverified", bytes: bytes.length };
  if (durationSeconds < minDurationSeconds || durationSeconds > maxDurationSeconds) {
    return { ok: false, reason: "clip_duration_out_of_range", bytes: bytes.length, durationSeconds };
  }
  return { ok: true, bytes: bytes.length, durationSeconds, sha256: sha256Hex(bytes) };
}

function isDeniedMediaUrl(value) {
  const raw = String(value || "");
  if (!raw) return true;
  if (/^blob:/i.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    return !GOOGLE_MEDIA_HOST_RE.test(parsed.hostname) || DENIED_MEDIA_RE.test(`${parsed.hostname}${parsed.pathname}`);
  } catch { return true; }
}

function urlFingerprint(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    const stableQuery = [...parsed.searchParams.entries()]
      .filter(([key]) => !/^(?:auth|authuser|token|sig|signature|expires?|x-goog-|key|credential|policy)/i.test(key))
      .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
    const query = new URLSearchParams(stableQuery).toString();
    const base = `${parsed.hostname.toLowerCase()}${decodeURIComponent(parsed.pathname)}`.replace(/\/+$/, "");
    return `${base}${query ? `?${query}` : ""}`;
  } catch { return null; }
}

function validateClipApproval(approval, candidate) {
  if (!approval || approval.approved !== true) return { ok: false, reason: "clip_approval_required" };
  const expected = String(approval.sha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) return { ok: false, reason: "clip_approval_identity_required" };
  if (!candidate || expected !== String(candidate.sha256 || "").toLowerCase()) {
    return { ok: false, reason: "approved_clip_sha_mismatch" };
  }
  return { ok: true, approval: { ...approval, sha256: expected } };
}

async function runOrderedStages(handlers, stages = WORKFLOW_STAGES) {
  const completed = [];
  for (const stage of stages) {
    if (!handlers || typeof handlers[stage] !== "function") {
      return { ok: false, reason: "workflow_stage_missing", stage, completed };
    }
    const result = await handlers[stage]();
    if (!result || result.ok !== true) {
      return { ...(result || { ok: false, reason: "workflow_stage_failed" }), stage, completed };
    }
    completed.push(stage);
  }
  return { ok: true, completed };
}

async function findControl(page, nameRe, { timeout = 15000 } = {}) {
  for (const role of ["button", "tab", "option", "radio", "checkbox"]) {
    const locator = page.getByRole(role, { name: nameRe }).first();
    if (!(await locator.count().catch(() => 0))) continue;
    await locator.waitFor({ state: "visible", timeout }).catch(() => null);
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  const text = page.getByText(nameRe).first();
  if (!(await text.count().catch(() => 0))) return null;
  await text.waitFor({ state: "visible", timeout }).catch(() => null);
  if (!(await text.isVisible().catch(() => false))) return null;
  const parent = text.locator("xpath=ancestor-or-self::*[@role='button' or @role='tab' or @role='option' or @role='radio' or @role='checkbox'][1]");
  return (await parent.count().catch(() => 0)) ? parent.first() : text;
}

async function visibleControlHandles(locator, { verifyExactSaveLabel = false } = {}) {
  const handles = [];
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = typeof locator.nth === "function" ? locator.nth(index) : locator.first();
    if (!(await candidate.isVisible().catch(() => false))) continue;
    if (verifyExactSaveLabel) {
      // Google renders the control text as "Save and close" while exposing the
      // material-button accessibility label as only "Save".  The exact visible
      // text is the workflow identity; aria-label is only a fallback when the
      // control has no rendered text.
      const label = await candidate.evaluate((element) => String(
        element.innerText || element.textContent || element.getAttribute("aria-label") || "",
      ).trim().replace(/\s+/g, " ")).catch(() => "");
      if (!SAVE_AND_CLOSE_RE.test(label)) continue;
    }
    const handle = await candidate.elementHandle().catch(() => null);
    if (handle) handles.push(handle);
  }
  return handles;
}

async function activeSaveDialogOverlay(saveDialogHandle) {
  if (!saveDialogHandle) return null;
  const overlayHandle = await saveDialogHandle.evaluateHandle((dialog) => {
    if (!dialog || !dialog.isConnected) return null;
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden"
        && style.visibility !== "collapse"
        && Number(style.opacity || "1") > 0;
    };
    const tagName = (node) => String(node?.tagName || "").toLowerCase();
    const isDocumentBoundary = (node) => ["body", "html"].includes(tagName(node));
    const isActive = (node) => Boolean(node
      && node.isConnected
      && node.getAttribute?.("aria-hidden") !== "true"
      && !node.inert
      && !node.hasAttribute?.("inert")
      && visible(node));
    const isOverlayHost = (node) => {
      const tag = tagName(node);
      if (["material-dialog", "mat-dialog-container", "md-dialog"].includes(tag)) return true;
      if (node.getAttribute?.("aria-modal") === "true") return true;
      const classes = String(node.className || "");
      const parentClasses = String(node.parentElement?.className || "");
      if (/(?:^|\s)pane(?:\s|$)/i.test(classes)
        && /(?:^|\s)acx-overlay-container(?:\s|$)/i.test(parentClasses)) return true;
      return /(?:^|\s)(?:cdk-overlay-pane|mat-mdc-dialog-container|mat-dialog-container|material-dialog|modal-dialog|dialog-shell|dialog-container)(?:\s|$)/i.test(classes);
    };
    if (!isActive(dialog)) return null;
    const fallback = dialog.parentElement;
    let overlay = null;
    for (let current = fallback; current && !isDocumentBoundary(current); current = current.parentElement) {
      // Keep walking so a cdk-overlay-pane wins over an inner material-dialog.
      // Google's portalled action footer can be their sibling inside that pane.
      if (isOverlayHost(current)) overlay = current;
    }
    if (overlay) return isActive(overlay) ? overlay : null;
    return fallback && !isDocumentBoundary(fallback) && isActive(fallback) ? fallback : null;
  }).catch(() => null);
  if (!overlayHandle) return null;
  return typeof overlayHandle.asElement === "function" ? overlayHandle.asElement() : overlayHandle;
}

async function saveAndCloseControlAssessment(overlayHandle, saveDialogHandle, controlHandle) {
  if (!overlayHandle || !saveDialogHandle || !controlHandle) return { associated: false, usable: false };
  return controlHandle.evaluate((element, handles) => {
    const overlay = handles?.overlay;
    const dialog = handles?.dialog;
    if (!element || !overlay || !dialog) return { associated: false, usable: false };
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden"
        && style.visibility !== "collapse"
        && Number(style.opacity || "1") > 0;
    };
    const active = (node) => Boolean(node
      && node.isConnected
      && node.getAttribute?.("aria-hidden") !== "true"
      && !node.inert
      && !node.hasAttribute?.("inert")
      && visible(node));
    const associated = active(overlay)
      && active(dialog)
      && overlay.contains(dialog)
      && overlay.contains(element);
    const label = String(element.innerText || element.textContent || element.getAttribute("aria-label") || "")
      .trim()
      .replace(/\s+/g, " ");
    return {
      associated,
      usable: associated
        && active(element)
        && !element.disabled
        && !element.hasAttribute("disabled")
        && element.getAttribute("aria-disabled") !== "true"
        && /^save\s+(?:and|&)\s+close$/i.test(label),
    };
  }, { overlay: overlayHandle, dialog: saveDialogHandle }).catch(() => ({ associated: false, usable: false }));
}

async function waitForSaveAndCloseControl(page, saveDialog, {
  attempts = 60,
  pollMs = 250,
  sleepImpl = sleep,
} = {}) {
  let sawUnusable = false;
  let lastVisibleExactControls = 0;
  let lastAssociatedExactControls = 0;
  const saveDialogHandle = await saveDialog.elementHandle().catch(() => null);
  const overlayHandle = await activeSaveDialogOverlay(saveDialogHandle);
  if (!saveDialogHandle || !overlayHandle) {
    return {
      ok: false,
      reason: "optimized_asset_save_and_close_not_found",
      detail: {
        scope: "save_image_overlay",
        active_overlay_resolved: false,
        visible_exact_controls: 0,
        overlay_exact_controls: 0,
      },
    };
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // One union catches native, ARIA, and Google's custom Material controls in
    // one count. The footer can be a portal sibling of the role=dialog node,
    // so discover globally but accept controls only inside the dialog's exact
    // active overlay pane. Never let another page or overlay supply the click.
    const materialLocator = page
      .locator("material-button,button,[role='button']")
      .filter({ hasText: /save\s+(?:and|&)\s+close/i });
    const handles = await visibleControlHandles(materialLocator, { verifyExactSaveLabel: true });
    lastVisibleExactControls = handles.length;
    const associated = [];
    for (const control of handles) {
      const assessment = await saveAndCloseControlAssessment(overlayHandle, saveDialogHandle, control);
      if (assessment.associated) associated.push({ control, assessment });
    }
    lastAssociatedExactControls = associated.length;
    if (handles.length > 1 || associated.length > 1) {
      return {
        ok: false,
        reason: "optimized_asset_save_and_close_ambiguous",
        detail: {
          scope: "save_image_overlay",
          active_overlay_resolved: true,
          visible_exact_controls: Math.min(lastVisibleExactControls, 100),
          overlay_exact_controls: Math.min(lastAssociatedExactControls, 100),
        },
      };
    }
    if (associated.length === 1) {
      if (associated[0].assessment.usable) {
        return {
          ok: true,
          control: associated[0].control,
          dialog: saveDialogHandle,
          overlay: overlayHandle,
        };
      }
      sawUnusable = true;
    }
    if (attempt + 1 < attempts) await sleepImpl(pollMs);
  }
  return {
    ok: false,
    reason: sawUnusable
      ? "optimized_asset_save_and_close_unusable"
      : "optimized_asset_save_and_close_not_found",
    detail: {
      scope: "save_image_overlay",
      active_overlay_resolved: true,
      visible_exact_controls: Math.min(lastVisibleExactControls, 100),
      overlay_exact_controls: Math.min(lastAssociatedExactControls, 100),
    },
  };
}

async function saveAndCloseControlIsUsable(overlayHandle, saveDialogHandle, controlHandle) {
  const assessment = await saveAndCloseControlAssessment(overlayHandle, saveDialogHandle, controlHandle);
  return assessment.associated === true && assessment.usable === true;
}

async function clickControl(locator, label) {
  assertWhitelistedClick(label);
  if (!locator) return null;
  try { await locator.click({ timeout: 8000 }); return "pointer"; } catch { /* CM_EDITING overlay */ }
  try { await locator.evaluate((element) => element.click()); return "js"; } catch { return null; }
}

async function editorControlHandleIsUsable(control) {
  return Boolean(control && await control.evaluate((element) => (
    element.isConnected
      && !element.disabled
      && !element.hasAttribute("disabled")
      && element.getAttribute("aria-disabled") !== "true"
  )).catch(() => false));
}

async function clickScopedEditorControl(page, control, label, adsParams, { onRefuse = async () => {} } = {}) {
  const refuse = async (result) => {
    try { await onRefuse(result); } catch { /* cleanup is best effort */ }
    return result;
  };
  if (!(await editorControlHandleIsUsable(control))) {
    return refuse({ ok: false, reason: "image_editor_control_detached" });
  }
  const scope = adsEditorScopeAssessment(page.url(), adsParams);
  if (!scope.ok) return refuse(scope);
  if (!(await clickControl(control, label))) {
    return refuse({ ok: false, reason: "remaster_generate_click_failed" });
  }
  return { ok: true };
}

function selectionEvidenceIsSelected(candidates) {
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || typeof candidate !== "object") continue;
    for (const value of [candidate.ariaSelected, candidate.ariaChecked, candidate.ariaPressed]) {
      if (String(value).toLowerCase() === "true") return true;
    }
    if (candidate.checkedInput
        || String(candidate.dataSelected).toLowerCase() === "true"
        || String(candidate.dataChecked).toLowerCase() === "true") return true;

    // CSS state is weaker evidence than ARIA/data state. Accept it only on the
    // actual option/control (or its nearest role-bearing control ancestor).
    // In particular, a wizard panel's generic `active` class is never proof.
    const classes = String(candidate.className || "");
    if (candidate.isControl
        && !/\b(?:not[-_]?selected|unselected|unchecked|inactive)\b/i.test(classes)
        && /\b(?:selected|checked)\b/i.test(classes)) return true;
  }
  return false;
}

async function controlSelected(locator) {
  if (!locator) return false;
  const candidates = await locator.evaluate((element) => {
    const controlRoles = new Set(["button", "tab", "option", "radio", "checkbox"]);
    const isControl = (node) => {
      const role = String(node && node.getAttribute && node.getAttribute("role") || "").toLowerCase();
      const tag = String(node && node.tagName || "").toLowerCase();
      return controlRoles.has(role) || tag === "input" || tag === "button";
    };
    const snapshot = (node) => ({
      ariaSelected: node.getAttribute && node.getAttribute("aria-selected"),
      ariaChecked: node.getAttribute && node.getAttribute("aria-checked"),
      ariaPressed: node.getAttribute && node.getAttribute("aria-pressed"),
      dataSelected: node.getAttribute && node.getAttribute("data-selected"),
      dataChecked: node.getAttribute && node.getAttribute("data-checked"),
      checkedInput: Boolean(node.matches && node.matches("input:checked")),
      className: String(node.getAttribute && node.getAttribute("class") || ""),
      isControl: isControl(node),
    });

    const nodes = [element];
    if (!isControl(element)) {
      let node = element.parentElement;
      for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
        if (isControl(node)) { nodes.push(node); break; }
      }
    }
    return nodes.map(snapshot);
  }).catch(() => []);
  return selectionEvidenceIsSelected(candidates);
}

async function panelText(page, re) {
  return String(await page.getByText(re).first().textContent().catch(() => "") || "").trim();
}
async function adsBlockerPresent(page) {
  const blocker = page.getByText(/turn off ad blockers|google ads can(?:not|'t) work.*ad blocker/i).first();
  if (!(await blocker.count().catch(() => 0))) return false;
  return blocker.evaluate((element) => {
    const overlay = element.closest('.ad-blocker-detected-overlay');
    const target = overlay || element;
    const style = getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity || 1) > 0
      && style.pointerEvents !== 'none'
      && rect.width > 0
      && rect.height > 0;
  }).catch(() => false);
}

function imageExtension(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF") return ".webp";
  if (bytes.subarray(0, 3).toString("ascii") === "GIF") return ".gif";
  return ".jpg";
}

async function ensureLocalHero(job, outDir, fetchImpl = fetch) {
  if (job.heroImagePath && fs.existsSync(job.heroImagePath)) return path.resolve(job.heroImagePath);
  if (!job.heroImageUrl) return null;
  try {
    const response = await fetchImpl(job.heroImageUrl);
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!hasImageMagic(bytes)) return null;
    const output = path.join(outDir, `source-image${imageExtension(bytes)}`);
    fs.writeFileSync(output, bytes);
    return output;
  } catch { return null; }
}

function validateRawHero(job, heroPath) {
  if (!heroPath || !fs.existsSync(heroPath)) return { ok: false, reason: "hero_image_unavailable" };
  const provenance = job.heroImageProvenance || {};
  if (job.heroImageVerified !== true && provenance.verified !== true) return { ok: false, reason: "hero_image_not_verified" };
  const expected = String(job.heroImageSha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) return { ok: false, reason: "hero_image_sha_required" };
  const bytes = fs.readFileSync(heroPath);
  if (bytes.length < 1024 || !hasImageMagic(bytes)) return { ok: false, reason: "hero_image_invalid" };
  const actual = sha256Hex(bytes);
  if (actual !== expected) return { ok: false, reason: "hero_image_sha_mismatch", expectedSha256: expected, actualSha256: actual };
  return { ok: true, bytes, sha256: actual };
}

function imagePreparationMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (!mode || mode === "image_editor" || mode === "image_editor_remaster") return "image_editor_remaster";
  if (mode === "direct_client_photo") return "direct_client_photo";
  return null;
}

function exactImageDimensions(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  const png = bytes.length >= 24
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (png) {
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (startOfFrame.has(marker)) {
      if (segmentLength < 7) return null;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (marker === 0xda) return null;
    offset += segmentLength;
  }
  return null;
}

function directSourceState(job, raw) {
  if (!raw || raw.ok !== true) return { ok: false, reason: "direct_source_unverified" };
  if (!/^[a-f0-9]{64}$/i.test(String(DIRECT_SOURCE_RECIPE_SHA256 || ""))) {
    return { ok: false, reason: "direct_source_recipe_unavailable" };
  }
  const payload = exactDirectSourceUploadPayload(raw.bytes, raw.sha256);
  if (!payload) return { ok: false, reason: "direct_source_format_invalid" };
  const expectedWidth = Number(job.heroImageWidth);
  const expectedHeight = Number(job.heroImageHeight);
  if (!Number.isInteger(expectedWidth) || expectedWidth <= 0
      || !Number.isInteger(expectedHeight) || expectedHeight <= 0) {
    return { ok: false, reason: "direct_source_dimensions_required" };
  }
  const measured = exactImageDimensions(raw.bytes);
  if (!measured) return { ok: false, reason: "direct_source_dimensions_unverified" };
  if (measured.width !== expectedWidth || measured.height !== expectedHeight) {
    return {
      ok: false,
      reason: "direct_source_dimensions_mismatch",
      expected: { width: expectedWidth, height: expectedHeight },
      actual: measured,
    };
  }
  const provenance = job.heroImageProvenance && typeof job.heroImageProvenance === "object"
    ? job.heroImageProvenance : {};
  const sourceUrl = provenance.url || provenance.sourceUrl || job.heroImageUrl || null;
  const fingerprint = `direct-source:${raw.sha256}`;
  return {
    ok: true,
    payload,
    optimized: {
      ok: true,
      bytes: raw.bytes,
      sha256: raw.sha256,
      sourceUrl,
      urlFingerprint: fingerprint,
      width: measured.width,
      height: measured.height,
    },
    remaster: {
      prompt: DIRECT_SOURCE_RECIPE,
      rawSha256: raw.sha256,
      optimizedSha256: raw.sha256,
      assetIdentity: {
        sha256: raw.sha256,
        sourceUrl,
        urlFingerprint: fingerprint,
        width: measured.width,
        height: measured.height,
      },
      assetFingerprint: fingerprint,
      promptSha256: DIRECT_SOURCE_RECIPE_SHA256,
    },
  };
}

async function visibleImageDescriptors(page) {
  return page.locator("img").evaluateAll((images) => images.map((image, index) => {
    const rect = image.getBoundingClientRect();
    const lifecycle = window.__wssAdsOptimizedImageLifecycle;
    const nodeId = lifecycle && typeof lifecycle.idFor === "function" ? lifecycle.idFor(image) : null;
    return {
      index, src: image.currentSrc || image.src || "", alt: image.alt || "",
      srcset: image.srcset || "", nodeId,
      naturalWidth: Number(image.naturalWidth || 0), naturalHeight: Number(image.naturalHeight || 0),
      visibleWidth: Math.round(rect.width || 0), visibleHeight: Math.round(rect.height || 0),
      visible: rect.width > 0 && rect.height > 0,
      lifecycle: lifecycle ? {
        activeEpoch: lifecycle.activeEpoch,
        owned: lifecycle.owns(image),
        insertedEpoch: lifecycle.insertedEpoch.get(image) || 0,
        sourceMutatedEpoch: lifecycle.sourceMutatedEpoch.get(image) || 0,
        loadedEpoch: lifecycle.loadedEpoch.get(image) || 0,
      } : { activeEpoch: 0, owned: false },
    };
  })).catch(() => []);
}

async function armOptimizedImageLifecycle(promptInput, generate) {
  const promptStored = await promptInput.evaluate((element) => {
    window.__wssAdsRemasterPromptElement = element;
    return true;
  }).catch(() => false);
  if (!promptStored) return [];
  let arm;
  try {
    arm = generate.evaluate((generateElement) => {
    const key = "__wssAdsOptimizedImageLifecycle";
    const previous = window[key];
    if (previous && typeof previous.cleanup === "function") previous.cleanup();
    const promptElement = window.__wssAdsRemasterPromptElement;
    delete window.__wssAdsRemasterPromptElement;
    if (!promptElement || !promptElement.isConnected || !generateElement.isConnected) return [];

    let sequence = 0;
    const nodeIds = new WeakMap();
    const baselineNodes = new WeakSet();
    const idFor = (image) => {
      if (!nodeIds.has(image)) nodeIds.set(image, `image-${++sequence}`);
      return nodeIds.get(image);
    };
    const descriptor = (image, index) => ({
      index,
      nodeId: idFor(image),
      src: image.currentSrc || image.src || "",
      srcset: image.srcset || "",
      naturalWidth: Number(image.naturalWidth || 0),
      naturalHeight: Number(image.naturalHeight || 0),
    });
    const allImages = Array.from(document.querySelectorAll("img"));
    for (const image of allImages) baselineNodes.add(image);
    const baseline = allImages.map(descriptor);

    let editorRoot = promptElement;
    while (editorRoot && !editorRoot.contains(generateElement)) editorRoot = editorRoot.parentElement;
    const visibleArea = (image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? rect.width * rect.height : 0;
    };
    let ownedImages = [];
    while (editorRoot) {
      ownedImages = Array.from(editorRoot.querySelectorAll("img"))
        .filter((image) => Number(image.naturalWidth || 0) >= 600
          && Number(image.naturalHeight || 0) >= 300
          && visibleArea(image) > 0);
      if (ownedImages.length) break;
      editorRoot = editorRoot.parentElement;
    }
    const primaryImage = ownedImages.sort((left, right) => visibleArea(right) - visibleArea(left))[0] || null;
    let ownedRoot = primaryImage;
    while (ownedRoot?.parentElement && ownedRoot.parentElement !== editorRoot) {
      const parent = ownedRoot.parentElement;
      if (parent.contains(promptElement) || parent.contains(generateElement)) break;
      ownedRoot = parent;
    }

    const state = {
      activeEpoch: 0,
      idFor,
      baselineNodes,
      insertedEpoch: new WeakMap(),
      sourceMutatedEpoch: new WeakMap(),
      loadedEpoch: new WeakMap(),
      owns(image) { return Boolean(ownedRoot && ownedRoot.contains(image)); },
    };
    const markInserted = (node) => {
      if (!state.activeEpoch || !node || node.nodeType !== 1) return;
      const images = node.matches && node.matches("img") ? [node] : Array.from(node.querySelectorAll?.("img") || []);
      for (const image of images) {
        idFor(image);
        if (!baselineNodes.has(image)) state.insertedEpoch.set(image, state.activeEpoch);
      }
    };
    const observer = new MutationObserver((mutations) => {
      if (!state.activeEpoch) return;
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) markInserted(node);
        } else if (mutation.type === "attributes" && mutation.target?.matches?.("img")) {
          idFor(mutation.target);
          state.sourceMutatedEpoch.set(mutation.target, state.activeEpoch);
        }
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src", "srcset"],
    });
    const onLoad = (event) => {
      if (!state.activeEpoch || !event.target?.matches?.("img")) return;
      idFor(event.target);
      state.loadedEpoch.set(event.target, state.activeEpoch);
    };
    document.addEventListener("load", onLoad, true);
    const activate = () => {
      if (state.activeEpoch) return;
      observer.takeRecords();
      state.activeEpoch += 1;
      state.insertedEpoch = new WeakMap();
      state.sourceMutatedEpoch = new WeakMap();
      state.loadedEpoch = new WeakMap();
    };
    generateElement.addEventListener("click", activate, true);
    Object.assign(state, {
      cleanup() {
        observer.disconnect();
        document.removeEventListener("load", onLoad, true);
        generateElement.removeEventListener("click", activate, true);
      },
    });
    window[key] = state;
    return baseline;
    });
    return await arm;
  } catch {
    return [];
  } finally {
    const cleared = await promptInput.evaluate(() => {
      delete window.__wssAdsRemasterPromptElement;
      return true;
    }).catch(() => false);
    if (!cleared) {
      await generate.evaluate(() => {
        delete window.__wssAdsRemasterPromptElement;
      }).catch(() => {});
    }
  }
}

async function disarmOptimizedImageLifecycle(page) {
  await page.evaluate(() => {
    const state = window.__wssAdsOptimizedImageLifecycle;
    if (state && typeof state.cleanup === "function") state.cleanup();
    delete window.__wssAdsOptimizedImageLifecycle;
  }).catch(() => {});
}

function imageLifecycleChangedFromBaseline(baselineImages, image) {
  const lifecycle = image?.lifecycle;
  const nodeId = String(image?.nodeId || "");
  const activeEpoch = Number(lifecycle?.activeEpoch || 0);
  if (!activeEpoch || lifecycle?.owned !== true || !nodeId || !Array.isArray(baselineImages)) return false;
  const baseline = baselineImages.find((candidate) => String(candidate?.nodeId || "") === nodeId);
  if (!baseline) return Number(lifecycle.insertedEpoch || 0) === activeEpoch;
  // A baseline node can be removed and reparented. It is still the same node,
  // so insertion evidence can never make it a new generated result.
  return Number(lifecycle.sourceMutatedEpoch || 0) === activeEpoch
    || Number(lifecycle.loadedEpoch || 0) === activeEpoch;
}

async function applyRemasterPrompt(promptInput, prompt = REMASTER_PROMPT) {
  try {
    await promptInput.fill(prompt);
    let applied = await promptInput.inputValue().catch(() => null);
    if (applied === null) {
      applied = await promptInput.evaluate((element) => (
        "value" in element ? element.value : element.textContent || ""
      )).catch(() => null);
    }
    return applied === prompt;
  } catch {
    return false;
  }
}

async function bytesFromPageUrl(page, url, { timeoutMs = 5000, maxBytes = 25 * 1024 * 1024 } = {}) {
  if (!url || isDeniedMediaUrl(url)) return null;
  const boundedTimeout = Math.min(10000, Math.max(1, Number(timeoutMs) || 5000));
  const boundedBytes = Math.min(25 * 1024 * 1024, Math.max(1024, Number(maxBytes) || 25 * 1024 * 1024));
  const base64 = await page.evaluate(async ({ source, timeout, byteLimit }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(source, { credentials: "same-origin", signal: controller.signal });
      if (!response.ok) return null;
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > byteLimit) {
        await response.body?.cancel?.().catch(() => {});
        return null;
      }
      let bytes;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            const chunk = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value || []);
            total += chunk.length;
            if (total > byteLimit) {
              await reader.cancel().catch(() => {});
              return null;
            }
            chunks.push(chunk);
          }
        } finally {
          reader.releaseLock?.();
        }
        bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      } else {
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      if (!bytes.length || bytes.length > byteLimit) return null;
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    } catch { return null; }
    finally { clearTimeout(timer); }
  }, { source: url, timeout: boundedTimeout, byteLimit: boundedBytes }).catch(() => null);
  return base64 ? Buffer.from(base64, "base64") : null;
}

async function settleWithin(value, timeoutMs) {
  const bounded = Math.min(3000, Math.max(1, Number(timeoutMs) || 3000));
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), bounded);
    Promise.resolve(value).then(finish, () => finish(null));
  });
}

function createImageResponseCapture(page) {
  let armed = false;
  const records = [];
  const onResponse = (response) => {
    if (!armed || isDeniedMediaUrl(response.url())) return;
    const contentType = String(response.headers()["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("image/")) return;
    records.push({
      url: response.url(),
      body: response.body().then((value) => Buffer.from(value)).catch(() => null),
    });
  };
  page.on("response", onResponse);
  return {
    arm() { armed = true; },
    stop() { armed = false; page.off("response", onResponse); },
    async snapshot({ timeoutMs = 3000 } = {}) {
      const settled = [];
      const boundedMs = Math.min(3000, Math.max(1, Number(timeoutMs) || 3000));
      const bodies = await Promise.all(records.map((record) => new Promise((resolve) => {
        let done = false;
        const finish = (value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ record, bytes: value });
        };
        const timer = setTimeout(() => finish(null), boundedMs);
        Promise.resolve(record.body).then(finish, () => finish(null));
      })));
      for (const { record, bytes } of bodies) {
        if (!bytes || bytes.length < 20000 || !hasImageMagic(bytes)) continue;
        settled.push({ url: record.url, urlFingerprint: urlFingerprint(record.url), sha256: sha256Hex(bytes), bytes });
      }
      return settled;
    },
  };
}

async function probePlayableMp4(page, bytes) {
  if (!bytes || bytes.length > 25 * 1024 * 1024) return { ok: false, reason: "clip_playback_probe_refused" };
  const base64 = bytes.toString("base64");
  return page.evaluate(async (encoded) => {
    const binary = atob(encoded);
    const data = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) data[index] = binary.charCodeAt(index);
    const url = URL.createObjectURL(new Blob([data], { type: "video/mp4" }));
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, reason: "clip_playback_probe_timeout" }), 15000);
      const finish = (value) => { clearTimeout(timer); resolve(value); };
      video.addEventListener("loadeddata", () => finish({
        ok: video.readyState >= 2 && Number.isFinite(video.duration) && video.duration > 0,
        readyState: video.readyState,
        duration: Number.isFinite(video.duration) ? video.duration : null,
      }), { once: true });
      video.addEventListener("error", () => finish({ ok: false, reason: "clip_playback_probe_failed" }), { once: true });
      video.src = url;
      video.load();
    });
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    return result;
  }, base64).catch(() => ({ ok: false, reason: "clip_playback_probe_failed" }));
}

function expectedClipCount(value) {
  const match = String(value || "").match(/save\s+(\d+)\s+animated clips?\s+in asset library/i);
  const count = match ? Number(match[1]) : 0;
  return Number.isInteger(count) && count > 0 && count <= 24 ? count : null;
}

function dedupeClipCandidates(candidates) {
  const seen = new Set();
  const output = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const sha256 = String(candidate && candidate.sha256 || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256) || seen.has(sha256)) continue;
    seen.add(sha256);
    output.push({ ...candidate, sha256 });
  }
  return output;
}

function candidateRecord(candidate, index) {
  return {
    index: index + 1,
    clipPath: candidate.clipPath,
    sha256: candidate.sha256,
    bytes: candidate.bytes,
    durationSeconds: candidate.durationSeconds,
    width: candidate.width,
    height: candidate.height,
    codec: candidate.codec,
    normalized: candidate.normalized === true,
    originalSha256: candidate.originalSha256,
    inputCodec: candidate.inputCodec,
    inputVideoStreams: candidate.inputVideoStreams,
    selectedStreamIndex: candidate.selectedStreamIndex,
    source: candidate.capture,
    sourceFingerprint: urlFingerprint(candidate.source),
  };
}

function approvedCandidate(candidates, approval) {
  const sha256 = String(approval && approval.sha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) return null;
  return (Array.isArray(candidates) ? candidates : [])
    .find((candidate) => String(candidate && candidate.sha256 || "").toLowerCase() === sha256) || null;
}

function candidateMediaResponse(contentType, url) {
  const type = String(contentType || "").toLowerCase();
  return type.includes("video/mp4")
    || type.includes("image/avif")
    || /\.(?:mp4|avif)(?:$|[?#])/i.test(String(url || ""));
}

function candidateDomMediaUrl(url) {
  return /^blob:/i.test(String(url || ""))
    || (!isDeniedMediaUrl(url) && Boolean(urlFingerprint(url)));
}

function candidateMediaFingerprint(url) {
  const raw = String(url || "");
  return /^blob:/i.test(raw) ? raw : urlFingerprint(raw);
}

const WIZARD_ANIMATION_STEP_TAB_SELECTOR = '[role="tab"][aria-label="Step 3 of 3, Create animated clips"]';

async function animationStepThreeTargetTabAssessment(control) {
  return control?.evaluate((element) => {
    const panelId = String(element.getAttribute?.("aria-controls") || "");
    return {
      exact: Boolean(element.isConnected && element.getAttribute?.("role") === "tab"
        && element.getAttribute?.("aria-label") === "Step 3 of 3, Create animated clips"
        && /^[A-Za-z0-9_.:-]{1,160}$/.test(panelId)),
      panelId,
    };
  }).catch(() => ({ exact: false, panelId: "" }));
}

async function animationStepThreeTabAssessment(control) {
  return control?.evaluate((element) => {
    const panelId = String(element.getAttribute?.("aria-controls") || "");
    const rect = element.getBoundingClientRect?.();
    const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
    return {
      usable: Boolean(element.isConnected && element.getAttribute?.("role") === "tab"
        && element.getAttribute?.("aria-label") === "Step 3 of 3, Create animated clips"
        && /^[A-Za-z0-9_.:-]{1,160}$/.test(panelId)
        && rect && rect.width > 0 && rect.height > 0
        && (!style || (style.display !== "none" && style.visibility !== "hidden"
          && style.visibility !== "collapse" && Number(style.opacity || "1") > 0))),
      selected: element.getAttribute?.("aria-selected") === "true",
      panelId,
    };
  }).catch(() => ({ usable: false, selected: false, panelId: "" }));
}

async function animationStepThreePanelAssessment(panel, panelId) {
  return panel?.evaluate((element, expectedId) => {
    const rect = element.getBoundingClientRect?.();
    const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
    return {
      exact: Boolean(element.isConnected && element.getAttribute?.("role") === "tabpanel"
        && element.id === expectedId),
      visible: Boolean(rect && rect.width > 0 && rect.height > 0
        && !element.hidden && !element.inert && element.getAttribute?.("aria-hidden") !== "true"
        && (!style || (style.display !== "none" && style.visibility !== "hidden"
          && style.visibility !== "collapse" && Number(style.opacity || "1") > 0))),
    };
  }, panelId).catch(() => ({ exact: false, visible: false }));
}

async function resolveAnimationStepThree(page) {
  const tabHandles = await page.locator(WIZARD_ANIMATION_STEP_TAB_SELECTOR).elementHandles().catch(() => []);
  const tabs = [];
  for (const tab of tabHandles) {
    const assessment = await animationStepThreeTabAssessment(tab);
    if (assessment.usable) tabs.push({ tab, assessment });
  }
  if (tabs.length > 1) return { ok: false, reason: "clip_step3_tab_ambiguous" };
  if (tabs.length !== 1) return { ok: false, reason: "clip_step3_tab_not_found" };
  if (!tabs[0].assessment.selected) return { ok: false, reason: "clip_step3_tab_not_selected" };

  const panels = [];
  const panelHandles = await page.locator('[role="tabpanel"]').elementHandles().catch(() => []);
  for (const panel of panelHandles) {
    const assessment = await animationStepThreePanelAssessment(panel, tabs[0].assessment.panelId);
    if (assessment.exact) panels.push({ panel, assessment });
  }
  if (panels.length > 1) return { ok: false, reason: "clip_step3_panel_ambiguous" };
  if (panels.length !== 1) return { ok: false, reason: "clip_step3_panel_not_found" };
  if (!panels[0].assessment.visible) return { ok: false, reason: "clip_step3_panel_not_visible" };
  return { ok: true, panel: panels[0].panel, panelId: tabs[0].assessment.panelId };
}

async function resolveAnimationStepThreeTarget(page) {
  const tabHandles = await page.locator(WIZARD_ANIMATION_STEP_TAB_SELECTOR).elementHandles().catch(() => []);
  const tabs = [];
  for (const tab of tabHandles) {
    const assessment = await animationStepThreeTargetTabAssessment(tab);
    if (assessment.exact) tabs.push({ tab, assessment });
  }
  if (tabs.length > 1) return { ok: false, reason: "clip_step3_target_tab_ambiguous" };
  if (tabs.length !== 1) return { ok: false, reason: "clip_step3_target_tab_not_found" };

  const panels = [];
  const panelHandles = await page.locator('[role="tabpanel"]').elementHandles().catch(() => []);
  for (const panel of panelHandles) {
    const assessment = await animationStepThreePanelAssessment(panel, tabs[0].assessment.panelId);
    if (assessment.exact) panels.push({ panel, assessment });
  }
  if (panels.length > 1) return { ok: false, reason: "clip_step3_target_panel_ambiguous" };
  if (panels.length !== 1) return { ok: false, reason: "clip_step3_target_panel_not_found" };
  return { ok: true, panel: panels[0].panel, panelId: tabs[0].assessment.panelId };
}

async function renderedMediaDescriptors(page, options = {}) {
  const context = options.context || await (options.resolveImpl || resolveAnimationStepThree)(page);
  if (!context?.ok) {
    const missing = [];
    missing.reason = String(context?.reason || "clip_step3_panel_not_found");
    return missing;
  }
  const evaluated = await context.panel.evaluate((root, expectedPanelId) => {
    if (!root.isConnected || root.id !== expectedPanelId || root.getAttribute?.("role") !== "tabpanel") {
      return { ok: false, reason: "clip_step3_panel_detached", items: [] };
    }
    const visible = (target) => {
      if (!target?.isConnected || target.hidden || target.inert || target.getAttribute?.("aria-hidden") === "true") return false;
      const rect = target.getBoundingClientRect?.();
      const style = target.ownerDocument?.defaultView?.getComputedStyle?.(target);
      return Boolean(rect && rect.width > 0 && rect.height > 0
        && (!style || (style.display !== "none" && style.visibility !== "hidden"
          && style.visibility !== "collapse" && Number(style.opacity || "1") > 0)));
    };
    const label = (element) => String(element?.getAttribute?.("aria-label") || element?.getAttribute?.("title")
      || element?.getAttribute?.("alt")
      || element?.innerText || element?.textContent || "").trim().replace(/\s+/g, " ");
    const animatedLabel = (element) => /^animated clip\s+\d+(?:\/\d+)?(?:\b|,)/i.test(label(element));
    const cards = new Set([
      ...root.querySelectorAll("animated-thumbnail[role='listitem'], animated-thumbnail[role='option']"),
      ...root.querySelectorAll('[role="listitem"], [role="option"]'),
    ].filter((element) => visible(element) && animatedLabel(element)));

    const headings = [...root.querySelectorAll("h1, h2, h3, h4, [role='heading']")]
      .filter((element) => visible(element) && /^animated clips$/i.test(String(element.textContent || "").trim()));
    if (headings.length > 1) return { ok: false, reason: "clip_result_region_ambiguous", items: [] };
    let structuralRegion = null;
    if (headings.length === 1) {
      for (let node = headings[0].parentElement; node && node !== root; node = node.parentElement) {
        if ([...node.querySelectorAll("img, video")].some(visible)) {
          structuralRegion = node;
          break;
        }
      }
    }
    if (structuralRegion) {
      for (const element of structuralRegion.querySelectorAll(
        "animated-thumbnail, [role='listitem'], [role='option']",
      )) {
        if (visible(element) && [...element.querySelectorAll("img, video")].some(visible)) cards.add(element);
      }
    }

    const cardFor = (item) => {
      for (let node = item.parentElement; node && node !== root; node = node.parentElement) {
        if (cards.has(node)) return node;
        if (node === structuralRegion) return structuralRegion;
      }
      return null;
    };
    const lifecycle = window.__wssAdsGeneratedMediaLifecycle;
    const media = new Set();
    for (const card of cards) for (const item of card.querySelectorAll("img, video")) media.add(item);
    if (structuralRegion) {
      for (const item of structuralRegion.querySelectorAll("img, video")) {
        const itemLabel = label(item);
        if (String(item.tagName || "").toLowerCase() === "video" || /animated clip/i.test(itemLabel)) media.add(item);
      }
    }
    const items = [];
    for (const item of media) {
      const card = cardFor(item);
      if (!card || !visible(card) || !visible(item)) continue;
      const video = String(item.tagName || "").toLowerCase() === "video";
      const sources = video
        ? Array.from(item.querySelectorAll("source")).map((source) => source.src || "").filter(Boolean)
        : [];
      const src = item.currentSrc || item.src || sources[0] || "";
      if (!src) continue;
      const fingerprint = lifecycle?.fingerprint(src) || null;
      items.push({
        kind: video ? "video" : "image",
        src,
        sources,
        readyState: video ? Number(item.readyState || 0) : null,
        duration: video && Number.isFinite(item.duration) ? item.duration : null,
        visible: true,
        cardLabel: label(card),
        lifecycle: lifecycle ? {
          activeEpoch: lifecycle.activeEpoch,
          activatedAt: lifecycle.activatedAt || 0,
          baselineNode: lifecycle.baselineNodes.has(item),
          fingerprintWasBaseline: Boolean(fingerprint && lifecycle.baselineFingerprints.has(fingerprint)),
          fingerprint,
          insertedEpoch: lifecycle.insertedEpoch.get(item) || 0,
          sourceMutatedEpoch: lifecycle.sourceMutatedEpoch.get(item) || 0,
          loadedEpoch: lifecycle.loadedEpoch.get(item) || 0,
        } : null,
      });
    }
    const saveTexts = [...root.querySelectorAll("button, material-button, [role='button']")]
      .filter(visible).map(label).filter((value) => /^save \d+ animated clips? in asset library$/i.test(value));
    return {
      ok: true,
      items,
      saveText: saveTexts.length === 1 ? saveTexts[0] : "",
      resultRegionFound: cards.size > 0 || Boolean(structuralRegion),
    };
  }, context.panelId).catch(() => ({ ok: false, reason: "clip_step3_panel_read_failed", items: [] }));
  const items = Array.isArray(evaluated?.items) ? evaluated.items : [];
  const descriptors = items.map((item) => ({ ...item, postClick: animationMediaChangedAfterClick(item) }));
  if (!evaluated?.ok) descriptors.reason = String(evaluated?.reason || "clip_step3_panel_read_failed");
  descriptors.saveText = String(evaluated?.saveText || "");
  descriptors.resultRegionFound = evaluated?.resultRegionFound === true;
  return descriptors;
}

function animationMediaChangedAfterClick(item) {
  const lifecycle = item?.lifecycle;
  const epoch = Number(lifecycle?.activeEpoch || 0);
  if (!item?.visible || !item?.src || !epoch || !lifecycle?.fingerprint) return false;
  return lifecycle.baselineNode
    ? Number(lifecycle.sourceMutatedEpoch || 0) === epoch || Number(lifecycle.loadedEpoch || 0) === epoch
    : !lifecycle.fingerprintWasBaseline && Number(lifecycle.insertedEpoch || 0) === epoch;
}

async function armGeneratedMediaBaseline(control, targetContext) {
  if (!control || !targetContext?.ok || !targetContext.panel) {
    return { ok: false, reason: "animation_baseline_target_not_resolved" };
  }
  return targetContext.panel.evaluate((panel, createElement) => {
    if (!createElement?.isConnected || !panel?.isConnected
        || panel.getAttribute?.("role") !== "tabpanel"
        || !/^[A-Za-z0-9_.:-]{1,160}$/.test(String(panel.id || ""))) return false;
    const visible = (node) => {
      const rect = node?.getBoundingClientRect?.();
      const style = node?.ownerDocument?.defaultView?.getComputedStyle?.(node);
      return Boolean(node?.isConnected && rect && rect.width > 0 && rect.height > 0
        && (!style || (style.display !== "none" && style.visibility !== "hidden"
          && style.visibility !== "collapse" && Number(style.opacity || "1") > 0)));
    };
    const exactPanels = (id) => [...document.querySelectorAll('[role="tabpanel"]')]
      .filter((candidate) => candidate?.isConnected && candidate.id === id
        && candidate.getAttribute?.("role") === "tabpanel");
    const stepThreeTabs = [...document.querySelectorAll(
      '[role="tab"][aria-label="Step 3 of 3, Create animated clips"]',
    )].filter((tab) => tab?.isConnected && tab.getAttribute?.("role") === "tab");
    if (stepThreeTabs.length !== 1
        || stepThreeTabs[0].getAttribute?.("aria-controls") !== panel.id
        || exactPanels(panel.id).length !== 1
        || exactPanels(panel.id)[0] !== panel) return false;

    const createPanel = createElement.closest?.('[role="tabpanel"]');
    const createLabel = String(createElement.innerText || createElement.textContent
      || createElement.getAttribute?.("aria-label") || "").trim().replace(/\s+/g, " ");
    if (!createPanel?.id || createPanel === panel
        || createPanel.getAttribute?.("role") !== "tabpanel"
        || String(createElement.tagName || "").toUpperCase() !== "MATERIAL-BUTTON"
        || !/^create animated clips$/i.test(createLabel)
        || createElement.disabled || createElement.hasAttribute?.("disabled")
        || createElement.getAttribute?.("aria-disabled") === "true"
        || !visible(createPanel) || !visible(createElement)) return false;
    const stepTwoTabs = [...document.querySelectorAll(
      '[role="tab"][aria-label="Step 2 of 3, Choose enhanced images"]',
    )].filter((tab) => tab?.isConnected && tab.getAttribute?.("role") === "tab" && visible(tab));
    if (stepTwoTabs.length !== 1
        || stepTwoTabs[0].getAttribute?.("aria-selected") !== "true"
        || stepTwoTabs[0].getAttribute?.("aria-controls") !== createPanel.id
        || exactPanels(createPanel.id).length !== 1
        || exactPanels(createPanel.id)[0] !== createPanel) return false;
    const key = "__wssAdsGeneratedMediaLifecycle";
    const previous = window[key];
    if (previous && typeof previous.cleanup === "function") previous.cleanup();
    const fingerprint = (value) => {
      const raw = String(value || "");
      if (/^blob:/i.test(raw)) return raw;
      try {
        const parsed = new URL(raw);
        if (!/^https?:$/i.test(parsed.protocol)) return null;
        const stable = [...parsed.searchParams.entries()]
          .filter(([name]) => !/^(?:auth|authuser|token|sig|signature|expires?|x-goog-|key|credential|policy)/i.test(name))
          .sort(([aName, aValue], [bName, bValue]) => aName.localeCompare(bName) || aValue.localeCompare(bValue));
        const query = new URLSearchParams(stable).toString();
        const base = `${parsed.hostname.toLowerCase()}${decodeURIComponent(parsed.pathname)}`.replace(/\/+$/, "");
        return `${base}${query ? `?${query}` : ""}`;
      } catch { return null; }
    };
    const label = (element) => String(element?.getAttribute?.("aria-label") || element?.getAttribute?.("title")
      || element?.getAttribute?.("alt")
      || element?.innerText || element?.textContent || "").trim().replace(/\s+/g, " ");
    const eligibleMedia = () => {
      const cards = new Set([
        ...panel.querySelectorAll("animated-thumbnail[role='listitem'], animated-thumbnail[role='option']"),
        ...panel.querySelectorAll('[role="listitem"], [role="option"]'),
      ].filter((element) => element?.isConnected
        && /^animated clip\s+\d+(?:\/\d+)?(?:\b|,)/i.test(label(element))));
      const headings = [...panel.querySelectorAll("h1, h2, h3, h4, [role='heading']")]
        .filter((element) => element?.isConnected && /^animated clips$/i.test(String(element.textContent || "").trim()));
      let region = null;
      if (headings.length === 1) {
        for (let node = headings[0].parentElement; node && node !== panel; node = node.parentElement) {
          if (node.querySelectorAll("img, video").length) { region = node; break; }
        }
      }
      if (region) {
        for (const element of region.querySelectorAll("animated-thumbnail, [role='listitem'], [role='option']")) {
          if (element?.isConnected && element.querySelectorAll("img, video").length) cards.add(element);
        }
      }
      const media = new Set();
      for (const card of cards) for (const item of card.querySelectorAll("img, video")) media.add(item);
      if (region) {
        for (const item of region.querySelectorAll("img, video")) {
          const itemLabel = label(item);
          if (String(item.tagName || "").toLowerCase() === "video" || /animated clip/i.test(itemLabel)) media.add(item);
        }
      }
      return [...media].filter((item) => item?.isConnected);
    };
    const sourceOf = (node) => node.currentSrc || node.src
      || node.querySelector?.("source[src]")?.src || "";
    const exactCard = (node) => eligibleMedia().includes(node) ? node : null;
    const cardMedia = () => eligibleMedia();
    const state = {
      activeEpoch: 0,
      activatedAt: 0,
      panelId: panel.id,
      baselineNodes: new WeakSet(),
      baselineFingerprints: new Set(),
      insertedEpoch: new WeakMap(),
      sourceMutatedEpoch: new WeakMap(),
      loadedEpoch: new WeakMap(),
      fingerprint,
    };
    const markInserted = (node) => {
      if (!state.activeEpoch || !node || node.nodeType !== 1) return;
      const media = node.matches?.("img, video") ? [node] : Array.from(node.querySelectorAll?.("img, video") || []);
      for (const item of media) {
        if (exactCard(item) && !state.baselineNodes.has(item)) state.insertedEpoch.set(item, state.activeEpoch);
      }
    };
    const observer = new MutationObserver((mutations) => {
      if (!state.activeEpoch) return;
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) markInserted(node);
        } else if (mutation.type === "attributes") {
          const media = mutation.target?.matches?.("source")
            ? mutation.target.closest?.("video")
            : mutation.target;
          if (exactCard(media)) state.sourceMutatedEpoch.set(media, state.activeEpoch);
        }
      }
    });
    observer.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ["src", "srcset"],
    });
    const onLoad = (event) => {
      if (state.activeEpoch && exactCard(event.target)) state.loadedEpoch.set(event.target, state.activeEpoch);
    };
    document.addEventListener("load", onLoad, true);
    document.addEventListener("loadeddata", onLoad, true);
    const activate = () => {
      observer.takeRecords();
      const baseline = cardMedia();
      state.activeEpoch += 1;
      state.activatedAt = Date.now();
      state.baselineNodes = new WeakSet(baseline);
      state.baselineFingerprints = new Set(baseline.map((node) => fingerprint(sourceOf(node))).filter(Boolean));
      state.insertedEpoch = new WeakMap();
      state.sourceMutatedEpoch = new WeakMap();
      state.loadedEpoch = new WeakMap();
    };
    createElement.addEventListener("click", activate, true);
    state.cleanup = () => {
      observer.disconnect();
      document.removeEventListener("load", onLoad, true);
      document.removeEventListener("loadeddata", onLoad, true);
      createElement.removeEventListener("click", activate, true);
    };
    window[key] = state;
    return { panelId: panel.id, baselineSources: cardMedia().map(sourceOf).filter(Boolean) };
  }, control).then((result) => (result
    ? { ok: true, ...result }
    : { ok: false, reason: "animation_baseline_not_armed" }
  )).catch(() => ({ ok: false, reason: "animation_baseline_not_armed" }));
}

function streamDuration(stream, format = {}) {
  const direct = Number(stream && stream.duration);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const formatDuration = Number(format && format.duration);
  return Number.isFinite(formatDuration) && formatDuration > 0 ? formatDuration : null;
}

function streamFrameRate(stream) {
  const raw = String(stream && (stream.avg_frame_rate || stream.r_frame_rate) || "");
  const match = raw.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (!match || Number(match[2]) === 0) return 0;
  return Number(match[1]) / Number(match[2]);
}

function candidateStreamPlan(probe) {
  const parsed = probe && typeof probe === "object" ? probe : {};
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const videoStreams = streams.filter((stream) => stream && stream.codec_type === "video");
  const timed = videoStreams.filter((stream) => {
    if (Number(stream?.disposition?.attached_pic || 0) === 1) return false;
    const frames = Number(stream.nb_frames);
    // Google packages each generated animation beside a one-frame AV1 preview.
    // That preview often omits its own duration, so ffprobe falls back to the
    // five-second container duration. An explicit frame count is stronger
    // evidence: only use duration + frame rate when the count is unavailable.
    if (Number.isFinite(frames)) return frames > 1;
    const duration = streamDuration(stream, parsed.format);
    return duration && duration >= 0.25 && streamFrameRate(stream) > 0;
  }).sort((left, right) => {
    const durationDelta = (streamDuration(right, parsed.format) || 0) - (streamDuration(left, parsed.format) || 0);
    if (durationDelta) return durationDelta;
    return (Number(right.width || 0) * Number(right.height || 0))
      - (Number(left.width || 0) * Number(left.height || 0));
  });
  if (!timed.length) return { ok: false, reason: "candidate_timed_video_stream_missing" };
  const selected = timed[0];
  const codec = String(selected.codec_name || selected.codec_tag_string || "").toLowerCase();
  return {
    ok: true,
    streamIndex: Number(selected.index),
    codec,
    inputVideoStreams: videoStreams.length,
    durationSeconds: streamDuration(selected, parsed.format),
    width: Number(selected.width || 0),
    height: Number(selected.height || 0),
    normalize: codec !== "h264" || videoStreams.length !== 1,
  };
}

function ffmpegNormalizationArgs(inputPath, outputPath, plan) {
  return [
    "-nostdin", "-y", "-v", "error", "-i", inputPath,
    "-map", `0:${plan.streamIndex}`, "-an", "-sn", "-dn",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "19",
    "-movflags", "+faststart", outputPath,
  ];
}

function normalizeCandidateBytes(bytes, options = {}) {
  const input = Buffer.isBuffer(bytes) ? bytes : null;
  if (!input || input.length < 32 || !hasMp4Magic(input)) {
    return { ok: false, reason: "candidate_iso_bmff_required" };
  }
  const tool = options.spawnImpl || spawnSync;
  const ffprobeExecutable = String(options.ffprobeExecutable || process.env.FFPROBE_PATH || "ffprobe");
  const ffmpegExecutable = String(options.ffmpegExecutable || process.env.FFMPEG_PATH || "ffmpeg");
  const temporaryRoot = path.resolve(options.temporaryRoot || os.tmpdir());
  const temporary = fs.mkdtempSync(path.join(temporaryRoot, "wss-ads-candidate-"));
  const inputPath = path.join(temporary, "candidate.bin");
  const outputPath = path.join(temporary, "normalized.mp4");
  try {
    fs.writeFileSync(inputPath, input);
    const probed = tool(ffprobeExecutable, [
      "-v", "error", "-show_streams", "-show_format", "-of", "json", inputPath,
    ], { encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    if (probed.error || probed.status !== 0) {
      return { ok: false, reason: probed.error && probed.error.code === "ENOENT" ? "ffprobe_unavailable" : "candidate_probe_failed" };
    }
    let probe;
    try { probe = JSON.parse(String(probed.stdout || "")); }
    catch { return { ok: false, reason: "candidate_probe_invalid" }; }
    const plan = candidateStreamPlan(probe);
    if (!plan.ok) return plan;
    if (!plan.normalize) {
      return { ok: true, bytes: input, normalized: false, originalSha256: sha256Hex(input), ...plan };
    }
    const converted = tool(ffmpegExecutable, ffmpegNormalizationArgs(inputPath, outputPath, plan), {
      encoding: "utf8", windowsHide: true, timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    });
    if (converted.error || converted.status !== 0) {
      return { ok: false, reason: converted.error && converted.error.code === "ENOENT" ? "ffmpeg_unavailable" : "candidate_normalization_failed" };
    }
    const normalized = fs.existsSync(outputPath) ? fs.readFileSync(outputPath) : null;
    const validation = normalized && validateHeroClip(normalized);
    if (!validation || !validation.ok || !["avc1", "avc3"].includes(validation.codec)) {
      return { ok: false, reason: "candidate_normalization_invalid" };
    }
    return {
      ok: true,
      bytes: normalized,
      normalized: true,
      originalSha256: sha256Hex(input),
      normalizedSha256: validation.sha256,
      ...plan,
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function createMediaCapture(page, options = {}) {
  let armed = false;
  const network = [];
  const baselineShaByFingerprint = new Map();
  let normalizationFailure = "";
  const onResponse = (response) => {
    if (!armed) return;
    const url = response.url();
    if (isDeniedMediaUrl(url)) return;
    const headers = response.headers();
    const contentType = String(headers["content-type"] || "").toLowerCase();
    if (!candidateMediaResponse(contentType, url)) return;
    const declared = Number(headers["content-length"] || 0);
    if (Number.isFinite(declared) && declared > 25 * 1024 * 1024) return;
    network.push({
      url,
      capturedAt: Date.now(),
      body: response.body().then((value) => Buffer.from(value)).catch(() => null),
    });
  };
  page.on("response", onResponse);

  async function verifiedCandidate(bytes, metadata) {
    if (!bytes) return null;
    const normalized = (options.normalizeImpl || normalizeCandidateBytes)(bytes, options);
    if (!normalized || !normalized.ok) {
      normalizationFailure = String(normalized && normalized.reason || "candidate_normalization_failed");
      return null;
    }
    const structural = validateHeroClip(normalized.bytes);
    if (!structural.ok) return null;
    const alreadyPlayable = normalized.normalized !== true
      && Number(metadata.readyState) >= 2 && Number(metadata.durationHint) > 0;
    const playback = alreadyPlayable
      ? { ok: true, readyState: Number(metadata.readyState), duration: Number(metadata.durationHint) }
      : await probePlayableMp4(page, normalized.bytes);
    if (!playback.ok) return null;
    return {
      ...metadata,
      ...structural,
      durationSeconds: structural.durationSec,
      playable: true,
      readyState: playback.readyState || metadata.readyState || null,
      buffer: normalized.bytes,
      normalized: normalized.normalized === true,
      originalSha256: normalized.originalSha256,
      inputCodec: normalized.codec,
      inputVideoStreams: normalized.inputVideoStreams,
      selectedStreamIndex: normalized.streamIndex,
    };
  }

  return {
    async arm(createControl, targetContext) {
      const baseline = await (options.armGeneratedMediaBaselineImpl || armGeneratedMediaBaseline)(
        createControl,
        targetContext,
      );
      if (!baseline.ok) return baseline;
      const baselineSources = [...new Set((baseline.baselineSources || [])
        .filter((source) => candidateDomMediaUrl(source) && !isDeniedMediaUrl(source)))].slice(0, 24);
      const snapshots = await Promise.all(baselineSources.map(async (source) => ({
        source,
        bytes: await bytesFromPageUrl(page, source, { timeoutMs: 3000 }),
      })));
      for (const snapshot of snapshots) {
        const fingerprint = candidateMediaFingerprint(snapshot.source);
        if (!fingerprint || !snapshot.bytes) continue;
        const sha256 = sha256Hex(snapshot.bytes);
        const previous = baselineShaByFingerprint.get(fingerprint);
        baselineShaByFingerprint.set(fingerprint, previous && previous !== sha256 ? null : sha256);
      }
      armed = true;
      return { ok: true };
    },
    async stop() {
      armed = false;
      page.off("response", onResponse);
      await page.evaluate(() => {
        const state = window.__wssAdsGeneratedMediaLifecycle;
        if (state && typeof state.cleanup === "function") state.cleanup();
        delete window.__wssAdsGeneratedMediaLifecycle;
      }).catch(() => {});
    },
    async download({ timeoutMs = 150000, pollMs = 2000, stablePollsRequired = 3 } = {}) {
      const deadline = Date.now() + timeoutMs;
      let lastReason = "clip_never_rendered";
      let expectedCount = null;
      const processedNetwork = new Set();
      let stablePolls = 0;
      let sawHttpMedia = false;
      let sawCorrelatedResponse = false;
      let sawSameFingerprint = false;
      const candidatesBySha = new Map();
      while (Date.now() < deadline) {
        const media = await (options.renderedMediaDescriptorsImpl || renderedMediaDescriptors)(page);
        if (media.reason) lastReason = media.reason;
        const newMedia = media.filter((item) => item.postClick && item.visible
          && [item.src, ...item.sources].some(Boolean));
        sawHttpMedia ||= newMedia.some((item) => [item.src, ...item.sources]
          .some((source) => source && !/^blob:/i.test(source)));
        if (!newMedia.length) {
          if (!media.reason && media.length > 0) lastReason = "clip_result_stale";
          await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
          continue;
        }
        expectedCount = expectedClipCount(media.saveText) || expectedCount;
        const beforeCount = candidatesBySha.size;
        for (const item of newMedia) {
          for (const source of [item.src, ...item.sources]) {
            if (!source || isDeniedMediaUrl(source) || !candidateDomMediaUrl(source)) continue;
            // HTTP(S) output must be backed by a post-click response below.
            // A blob has no network URL to bind, so its exact inserted/mutated
            // DOM node remains the strongest available identity proof.
            if (!/^blob:/i.test(source)) continue;
            const bytes = await bytesFromPageUrl(page, source, {
              timeoutMs: Math.min(3000, Math.max(1, deadline - Date.now())),
            });
            const fingerprint = candidateMediaFingerprint(source);
            const wasBaselineFingerprint = item.lifecycle?.fingerprintWasBaseline
              && item.lifecycle?.fingerprint === fingerprint;
            if (wasBaselineFingerprint) {
              sawSameFingerprint = true;
              const baselineSha = baselineShaByFingerprint.get(fingerprint);
              if (!baselineSha) {
                lastReason = "clip_same_blob_baseline_unavailable";
                continue;
              }
              if (!bytes || sha256Hex(bytes) === baselineSha) {
                lastReason = bytes ? "clip_same_blob_unchanged" : "clip_download_blocked";
                continue;
              }
            }
            const candidate = await verifiedCandidate(bytes, {
              source,
              capture: `dom-blob-${item.kind}`,
              readyState: item.readyState, durationHint: item.duration,
            });
            if (candidate && !candidatesBySha.has(candidate.sha256)) candidatesBySha.set(candidate.sha256, candidate);
            lastReason = bytes ? (normalizationFailure || "clip_media_validation_failed") : "clip_download_blocked";
          }
        }
        const newSources = newMedia.flatMap((item) => [item.src, ...item.sources]).filter(Boolean);
        const activatedAt = Math.max(0, ...newMedia.map((item) => Number(item.lifecycle?.activatedAt || 0)));
        for (let index = 0; newMedia.length && index < network.length; index += 1) {
          if (processedNetwork.has(index)) continue;
          const item = network[index];
          if (!activatedAt || Number(item.capturedAt || 0) < activatedAt) continue;
          const networkFingerprint = urlFingerprint(item.url);
          const tiedToRenderedVideo = newSources.some((source) => source === item.url
            || (networkFingerprint && urlFingerprint(source) === networkFingerprint));
          if (!tiedToRenderedVideo) continue;
          sawCorrelatedResponse = true;
          processedNetwork.add(index);
          const bytes = await settleWithin(item.body, Math.min(3000, Math.max(1, deadline - Date.now())));
          if (!bytes || bytes.length > 25 * 1024 * 1024) {
            lastReason = "clip_response_body_unavailable";
            continue;
          }
          const baselineSha = networkFingerprint ? baselineShaByFingerprint.get(networkFingerprint) : undefined;
          const wasBaselineFingerprint = newMedia.some((mediaItem) => (
            mediaItem.lifecycle?.fingerprintWasBaseline
            && mediaItem.lifecycle?.fingerprint === networkFingerprint
          ));
          if (wasBaselineFingerprint) {
            sawSameFingerprint = true;
            if (!baselineSha) {
              lastReason = "clip_same_url_baseline_unavailable";
              continue;
            }
            if (sha256Hex(bytes) === baselineSha) {
              lastReason = "clip_same_url_unchanged";
              continue;
            }
          }
          const candidate = await verifiedCandidate(bytes, { source: item.url, capture: "network-body", durationHint: null });
          if (candidate && !candidatesBySha.has(candidate.sha256)) candidatesBySha.set(candidate.sha256, candidate);
          lastReason = bytes ? (normalizationFailure || "clip_media_validation_failed") : "clip_download_blocked";
        }
        stablePolls = candidatesBySha.size === beforeCount ? stablePolls + 1 : 0;
        if (expectedCount && candidatesBySha.size >= expectedCount) {
          return { ok: true, expectedCount, candidates: [...candidatesBySha.values()] };
        }
        // Some UI revisions omit the numeric Save label. In that case, wait
        // for the rendered set to stop changing instead of assuming six.
        if (!expectedCount && candidatesBySha.size > 0 && stablePolls >= stablePollsRequired) {
          return { ok: true, expectedCount: null, candidates: [...candidatesBySha.values()] };
        }
        await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
      }
      const captured = [...candidatesBySha.values()];
      if (captured.length) {
        return {
          ok: false,
          reason: expectedCount ? "clip_candidate_set_incomplete" : lastReason,
          expectedCount,
          capturedCount: captured.length,
        };
      }
      if (sawHttpMedia && !sawCorrelatedResponse) lastReason = "clip_response_not_correlated";
      else if (sawSameFingerprint && !captured.length && lastReason === "clip_never_rendered") {
        lastReason = "clip_same_url_not_proven_changed";
      }
      return { ok: false, reason: lastReason, expectedCount, capturedCount: 0 };
    },
  };
}

function optimizedResponseMatchesSha(responses, sha256) {
  return /^[0-9a-f]{64}$/i.test(String(sha256 || ""))
    && Array.isArray(responses)
    && responses.some((response) => String(response?.sha256 || "").toLowerCase() === String(sha256).toLowerCase());
}

const OPTIMIZED_IMAGE_FAILURE = Object.freeze({
  NO_USABLE_POST_GENERATE_RESPONSE: "optimized_image_no_usable_post_generate_response",
  RESPONSE_IDENTITY_MISMATCH: "optimized_image_response_identity_mismatch",
  UNCHANGED_FROM_RAW: "optimized_image_unchanged_from_raw",
  DOM_RESULT_STATE_MISSING: "optimized_image_dom_result_state_missing",
  NOT_CAPTURED: "optimized_image_not_captured",
});

function capturedImageFingerprint(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    const query = parsed.search.slice(1).split("&").filter(Boolean).filter((part) => {
      const rawKey = part.split("=", 1)[0].replace(/\+/g, " ");
      let key;
      try { key = decodeURIComponent(rawKey); } catch { return true; }
      return !/^(?:sig|signature|expires?|x-goog-(?:algorithm|credential|date|expires|signedheaders|signature))$/i.test(key);
    }).join("&");
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${parsed.pathname}${query ? `?${query}` : ""}`;
  } catch { return null; }
}

function capturedImageResponseAssessment(responses, imageUrl, rawSha256 = "") {
  const expectedUrl = String(imageUrl || "");
  const expectedFingerprint = capturedImageFingerprint(expectedUrl);
  const responseCount = Array.isArray(responses) ? responses.length : 0;
  if (!expectedUrl || !Array.isArray(responses)) {
    return { responseCount, identityMatched: false, validatedIdentityMatched: false, unchanged: false, captured: null };
  }
  const candidates = [];
  let identityMatched = false;
  for (const response of responses) {
    const responseUrl = String(response?.url || "");
    const responseFingerprint = capturedImageFingerprint(responseUrl);
    const exactUrl = responseUrl === expectedUrl;
    const exactFingerprint = Boolean(expectedFingerprint && responseFingerprint === expectedFingerprint);
    if (!exactUrl && !exactFingerprint) continue;
    identityMatched = true;
    const bytes = Buffer.isBuffer(response?.bytes) ? response.bytes : null;
    if (!bytes || bytes.length < 20000 || !hasImageMagic(bytes)) continue;
    const sha256 = sha256Hex(bytes);
    if (String(response?.sha256 || "").toLowerCase() !== sha256) continue;
    candidates.push({ ...response, bytes, sha256, exactUrl });
  }
  const exact = candidates.filter((candidate) => candidate.exactUrl);
  const selectedPool = exact.length ? exact : candidates;
  const uniqueBySha = new Map(selectedPool.map((candidate) => [candidate.sha256, candidate]));
  const unchanged = Boolean(selectedPool.length && rawSha256
    && selectedPool.every((candidate) => candidate.sha256 === rawSha256));
  const sole = uniqueBySha.size === 1 ? [...uniqueBySha.values()][0] : null;
  return {
    responseCount,
    identityMatched,
    validatedIdentityMatched: candidates.length > 0,
    unchanged,
    captured: sole && sole.sha256 !== rawSha256 ? sole : null,
  };
}

function capturedImageResponseForDom(responses, imageUrl, rawSha256 = "") {
  return capturedImageResponseAssessment(responses, imageUrl, rawSha256).captured;
}

async function responseBackedOptimizedImageAssessment(page, image, rawSha256, responses, baselineImages) {
  if (!imageLifecycleChangedFromBaseline(baselineImages, image)) {
    return { ok: false, reason: OPTIMIZED_IMAGE_FAILURE.DOM_RESULT_STATE_MISSING };
  }
  const assessment = capturedImageResponseAssessment(responses, image?.src, rawSha256);
  if (!assessment.responseCount) {
    return { ok: false, reason: OPTIMIZED_IMAGE_FAILURE.NO_USABLE_POST_GENERATE_RESPONSE };
  }
  if (!assessment.identityMatched) {
    return { ok: false, reason: OPTIMIZED_IMAGE_FAILURE.RESPONSE_IDENTITY_MISMATCH };
  }
  if (assessment.unchanged) {
    return { ok: false, reason: OPTIMIZED_IMAGE_FAILURE.UNCHANGED_FROM_RAW };
  }
  const captured = assessment.captured;
  if (!captured || !optimizedResponseMatchesSha(responses, captured.sha256)) {
    return { ok: false, reason: OPTIMIZED_IMAGE_FAILURE.NOT_CAPTURED };
  }
  return {
    ok: true,
    bytes: captured.bytes,
    sha256: captured.sha256,
    sourceUrl: image.src,
    urlFingerprint: urlFingerprint(image.src),
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

async function responseBackedOptimizedImage(page, image, rawSha256, responses, baselineImages) {
  const result = await responseBackedOptimizedImageAssessment(page, image, rawSha256, responses, baselineImages);
  return result.ok ? result : null;
}

function terminalOptimizedImageReason(observedReasons, sawResponses, sawImages) {
  for (const reason of [
    OPTIMIZED_IMAGE_FAILURE.DOM_RESULT_STATE_MISSING,
    OPTIMIZED_IMAGE_FAILURE.UNCHANGED_FROM_RAW,
    OPTIMIZED_IMAGE_FAILURE.NOT_CAPTURED,
    OPTIMIZED_IMAGE_FAILURE.RESPONSE_IDENTITY_MISMATCH,
  ]) {
    if (observedReasons.has(reason)) return reason;
  }
  if (!sawResponses) return OPTIMIZED_IMAGE_FAILURE.NO_USABLE_POST_GENERATE_RESPONSE;
  if (!sawImages) return OPTIMIZED_IMAGE_FAILURE.NOT_CAPTURED;
  return OPTIMIZED_IMAGE_FAILURE.NOT_CAPTURED;
}

async function waitForOptimizedImage(page, baselineImages, rawSha256, responseCapture, { timeoutMs = 120000, pollMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const observedReasons = new Set();
  let sawResponses = false;
  let sawImages = false;
  while (Date.now() < deadline) {
    const images = (await visibleImageDescriptors(page))
      .filter((image) => image.visible && image.naturalWidth >= 600 && image.naturalHeight >= 300 && image.src)
      .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));
    const responses = await responseCapture.snapshot();
    sawResponses ||= responses.length > 0;
    sawImages ||= images.length > 0;
    for (const image of images) {
      // Google now replaces the pixels behind the same asset URL after an AI
      // edit. Only an already-captured post-Generate response with the same
      // exact URL/fingerprint may supply bytes. Never page-fetch here: that
      // probe would itself enter the armed response capture and self-authorize.
      const optimized = await responseBackedOptimizedImageAssessment(page, image, rawSha256, responses, baselineImages);
      if (optimized.ok) return optimized;
      observedReasons.add(optimized.reason);
    }
    await sleep(Math.max(0, Math.min(pollMs, deadline - Date.now())));
  }
  return {
    ok: false,
    reason: terminalOptimizedImageReason(observedReasons, sawResponses, sawImages),
  };
}

async function selectExactOptimizedAsset(page, identity, { timeoutMs = 90000, responseCapture = null } = {}) {
  if (!/^[0-9a-f]{64}$/i.test(String(identity?.sha256 || "")) || isDeniedMediaUrl(identity?.sourceUrl)) {
    return { ok: false, reason: "optimized_asset_identity_invalid" };
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const images = (await visibleImageDescriptors(page)).filter((image) => image.visible && image.src);
    const responses = responseCapture ? await responseCapture.snapshot() : [];
    for (const image of images) {
      const sameFingerprint = Boolean(identity.urlFingerprint && urlFingerprint(image.src) === identity.urlFingerprint);
      const sameExactUrl = image.src === identity.sourceUrl;
      let sameSha = false;
      if (sameFingerprint || sameExactUrl || (image.naturalWidth >= 300 && image.naturalHeight >= 150)) {
        const bytes = await bytesFromPageUrl(page, image.src);
        sameSha = Boolean(bytes && hasImageMagic(bytes) && sha256Hex(bytes) === identity.sha256);
      }
      if (!sameSha && responses.length) {
        const captured = capturedImageResponseForDom(responses, image.src);
        sameSha = Boolean(captured && captured.sha256 === identity.sha256);
      }
      // A CDN path can be reused with a different signed query. URL evidence
      // only narrows the search. Exact bytes from this page or its armed
      // response capture must authorize both exact and rotated signed URLs.
      if (!sameSha) continue;
      const imageLocator = page.locator("img").nth(image.index);
      const card = imageLocator.locator("xpath=ancestor-or-self::*[@role='option' or @role='button' or @role='checkbox'][1]");
      const target = (await card.count().catch(() => 0)) ? card.first() : imageLocator;
      const clicked = await clickControl(target, "select optimized asset");
      return clicked ? { ok: true, matchedBy: "sha256" }
        : { ok: false, reason: "optimized_asset_click_failed" };
    }
    await page.mouse.wheel(0, 700).catch(() => {});
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(2000, remainingMs));
  }
  return { ok: false, reason: "optimized_asset_identity_not_found" };
}

async function selectHorizontalEnhancedAsset(page, { timeoutMs = 45000, pollMs = 500 } = {}) {
  const item = page.getByRole("listitem").filter({ hasText: /Cropped\s*\(horizontal\)/i }).first();
  await item.waitFor({ state: "visible", timeout: timeoutMs }).catch(() => null);
  if (!(await item.isVisible().catch(() => false))) {
    return { ok: false, reason: "horizontal_enhanced_asset_not_found" };
  }
  const checkbox = item.locator('material-checkbox[aria-label="Select asset"]');
  if (await checkbox.count().catch(() => 0) !== 1) {
    return { ok: false, reason: "horizontal_enhanced_asset_checkbox_not_found" };
  }
  const selected = async () => (await checkbox.first().getAttribute("aria-checked").catch(() => null)) === "true";
  if (!await selected() && !(await clickControl(item, "select enhanced image"))) {
    return { ok: false, reason: "horizontal_enhanced_asset_click_failed" };
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await selected()) return { ok: true };
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
  return { ok: false, reason: "horizontal_enhanced_asset_not_selected" };
}

async function createAnimatedClipsControlIsUsable(control) {
  return Boolean(control && await control.evaluate((element) => {
    if (!element || !element.isConnected || String(element.tagName || "").toUpperCase() !== "MATERIAL-BUTTON") return false;
    const label = String(element.innerText || element.textContent || element.getAttribute?.("aria-label") || "")
      .trim().replace(/\s+/g, " ");
    if (!/^create animated clips$/i.test(label)
        || element.disabled
        || element.hasAttribute?.("disabled")
        || element.getAttribute?.("aria-disabled") === "true") return false;
    const panel = element.closest?.('[role="tabpanel"]');
    if (!panel || panel.hidden || panel.inert || panel.hasAttribute?.("inert")
        || panel.getAttribute?.("aria-hidden") === "true") return false;
    const visible = (node) => {
      const rect = node.getBoundingClientRect?.();
      const view = node.ownerDocument?.defaultView;
      const style = view?.getComputedStyle ? view.getComputedStyle(node) : null;
      return Boolean(rect && rect.width > 0 && rect.height > 0
        && (!style || (style.display !== "none" && style.visibility !== "hidden"
          && style.visibility !== "collapse" && Number(style.opacity || "1") > 0)));
    };
    if (!panel.id || !/^[A-Za-z0-9_.:-]{1,160}$/.test(panel.id)
        || !visible(panel) || !visible(element)) return false;
    const tabs = [...element.ownerDocument.querySelectorAll(
      '[role="tab"][aria-label="Step 2 of 3, Choose enhanced images"]',
    )].filter((tab) => tab?.isConnected && tab.getAttribute?.("role") === "tab" && visible(tab));
    const panels = [...element.ownerDocument.querySelectorAll('[role="tabpanel"]')]
      .filter((candidate) => candidate?.isConnected && candidate.id === panel.id
        && candidate.getAttribute?.("role") === "tabpanel");
    return tabs.length === 1
      && tabs[0].getAttribute?.("aria-selected") === "true"
      && tabs[0].getAttribute?.("aria-controls") === panel.id
      && panels.length === 1 && panels[0] === panel;
  }).catch(() => false));
}

async function waitForCreateAnimatedClipsControl(page, {
  attempts = 80,
  pollMs = 250,
  sleepImpl = sleep,
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const handles = await page.locator("material-button").elementHandles().catch(() => []);
    const candidates = [];
    for (const handle of handles) {
      if (await createAnimatedClipsControlIsUsable(handle)) candidates.push(handle);
    }
    if (candidates.length > 1) return { ok: false, reason: "create_animated_clips_control_ambiguous" };
    if (candidates.length === 1) return { ok: true, control: candidates[0] };
    if (attempt + 1 < attempts) await sleepImpl(pollMs);
  }
  return { ok: false, reason: "create_animated_clips_not_found" };
}

async function animationLaunchEvidence(page) {
  const cardCount = await page.locator("animated-thumbnail[role='listitem'][aria-label]")
    .evaluateAll((cards) => cards.filter((card) => /^animated clip\s+\d+(?:\/\d+)?\b/i.test(
      String(card.getAttribute?.("aria-label") || "").trim(),
    )).length).catch(() => 0);
  const creatingVisible = await page.getByText(/^creating animated clips\b/i).first()
    .isVisible().catch(() => false);
  const progressVisible = await page.getByText(/^(?:100|[1-9]?\d)%$/).first()
    .isVisible().catch(() => false);
  return { cardCount, creatingVisible, progressVisible };
}

function animationLaunchChanged(baseline, current) {
  return Number(current?.cardCount || 0) > Number(baseline?.cardCount || 0)
    || (current?.creatingVisible === true && baseline?.creatingVisible !== true)
    || (current?.progressVisible === true && baseline?.progressVisible !== true);
}

async function waitForAnimationLaunch(page, baseline, {
  attempts = 32, pollMs = 250, sleepImpl = sleep, evidenceImpl = animationLaunchEvidence,
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const evidence = await evidenceImpl(page);
    if (animationLaunchChanged(baseline, evidence)) return { ok: true, evidence };
    if (attempt + 1 < attempts) await sleepImpl(pollMs);
  }
  return { ok: false, reason: "create_animated_clips_launch_unconfirmed" };
}

async function forceClickControl(locator, label) {
  assertWhitelistedClick(label);
  if (!locator) return null;
  try {
    await locator.click({ timeout: 8000, force: true });
    return "forced-pointer";
  } catch {
    return null;
  }
}

async function startAnimationGeneration(page, initialControl, adsParams, options = {}) {
  const evidenceImpl = options.evidenceImpl || animationLaunchEvidence;
  const waitImpl = options.waitImpl || waitForAnimationLaunch;
  const clickImpl = options.clickImpl || clickControl;
  const forceClickImpl = options.forceClickImpl || forceClickControl;
  const findImpl = options.findImpl || waitForCreateAnimatedClipsControl;
  const usableImpl = options.usableImpl || createAnimatedClipsControlIsUsable;
  const scopeImpl = options.scopeImpl || adsWizardScopeAssessment;
  const baseline = await evidenceImpl(page);
  if (!(await clickImpl(initialControl, "create animated clips"))) {
    return { ok: false, reason: "create_animated_clips_click_failed" };
  }
  const launched = await waitImpl(page, baseline, options.normalWaitOptions || {});
  if (launched.ok) return { ok: true, retried: false };

  // A normal Playwright click can report success while Google's material
  // control drops the event. Retry only the same unique, still-enabled action
  // on the still-account-scoped wizard; never search or click generic text.
  const scope = scopeImpl(page.url(), adsParams);
  if (!scope.ok) return scope;
  const retry = await findImpl(page, { attempts: 4, pollMs: 250 });
  if (!retry.ok || !(await usableImpl(retry.control))) {
    return { ok: false, reason: "create_animated_clips_launch_unconfirmed" };
  }
  if (!(await forceClickImpl(retry.control, "create animated clips"))) {
    return { ok: false, reason: "create_animated_clips_force_click_failed" };
  }
  const forcedLaunch = await waitImpl(page, baseline, options.forcedWaitOptions || { attempts: 60, pollMs: 250 });
  return forcedLaunch.ok
    ? { ok: true, retried: true }
    : { ok: false, reason: "create_animated_clips_launch_unconfirmed" };
}

async function observe(page) {
  const facts = { url: page.url(), steps: [], controls: [], adBlocker: await adsBlockerPresent(page) };
  const steps = await page.getByText(/Step [123] of 3/i).all().catch(() => []);
  for (const step of steps) facts.steps.push(String(await step.textContent().catch(() => "") || "").trim());
  for (const label of CLICK_TEXT_WHITELIST) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const control = await findControl(page, new RegExp(`^${escaped}$`, "i"), { timeout: 500 });
    if (control) facts.controls.push(label);
  }
  return facts;
}

function approvalReviewVerdict(candidates, remaster, stages, candidatesManifestPath) {
  const records = (Array.isArray(candidates) ? candidates : []).map(candidateRecord);
  const first = records[0] || {};
  return {
    ok: false, status: "awaiting_review", reason: "clip_approval_required",
    review: {
      ...first,
      source: "ads_animation_creator",
      candidateCount: records.length,
      candidatesManifestPath,
    },
    candidates: records,
    remaster, stages,
  };
}

function approvedClipFromDisk(job, outDir) {
  const approved = job && job.approvedClip;
  if (!approved || approved.approved !== true || !approved.path) return null;
  const resolved = path.resolve(approved.path);
  const relative = path.relative(outDir, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(resolved)) return { ok: false, reason: "approved_clip_path_refused" };
  const bytes = fs.readFileSync(resolved);
  const validation = validateHeroClip(bytes);
  if (!validation.ok) return validation;
  const approval = validateClipApproval(approved, validation);
  if (!approval.ok) return approval;
  return { ok: true, status: "approved", clipPath: resolved, generator: "ads_animate_image", sha256: validation.sha256, bytes: validation.bytes, durationSeconds: validation.durationSec, approval: approval.approval, resumedFromReview: true };
}

async function runJob(job, deps = {}) {
  if (!job || typeof job !== "object" || !job.prospectId || !job.sourceUrl) throw new Error("job requires prospectId and sourceUrl");
  const outDir = path.resolve(job.outDir || path.join(process.env.TEMP || "/tmp", "wss-hero-clips", job.prospectId));
  fs.mkdirSync(outDir, { recursive: true });
  const resumed = approvedClipFromDisk(job, outDir);
  if (resumed) return resumed;

  const observeOnly = process.argv.includes("--observe");
  const heroPath = observeOnly ? null : await ensureLocalHero(job, outDir, deps.fetch || fetch);
  const raw = observeOnly ? null : validateRawHero(job, heroPath);
  if (raw && !raw.ok) return raw;

  const preparation = imagePreparationMode(job.imagePreparation);
  if (!preparation) return { ok: false, reason: "image_preparation_invalid" };
  const direct = !observeOnly && preparation === "direct_client_photo"
    ? directSourceState(job, raw) : null;
  if (direct && !direct.ok) return direct;
  const workflowStages = preparation === "direct_client_photo"
    ? DIRECT_WORKFLOW_STAGES : WORKFLOW_STAGES;

  const browserDriver = deps.chromium || chromium;
  const browserSession = await openAdsBrowserSession(browserDriver, job, {
    env: deps.env || process.env,
    existsSync: deps.existsSync || fs.existsSync,
    platform: deps.platform || process.platform,
  });
  if (!browserSession.ok) return browserSession;
  let page = null;
  const runnerPages = new Set();
  const state = {
    raw,
    heroPath,
    optimized: direct ? direct.optimized : null,
    clips: [],
    clip: null,
    remaster: direct ? direct.remaster : null,
    sourceBinding: null,
    candidatesManifestPath: null,
  };
  try {
    const context = browserSession.context;
    const adsParams = browserSession.adsParams;
    page = await context.newPage();
    runnerPages.add(page);
    if (observeOnly) {
      await page.goto(imageEditorUrl(adsParams), { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(5000);
      return { ok: true, observe: await observe(page) };
    }

    // createMediaCapture is synchronous and its awaited download is the only
    // path to a clip verdict; this fixes the old Promise/download race.
    const captureOptions = {
      ffmpegExecutable: job.ffmpegExecutable,
      ffprobeExecutable: job.ffprobeExecutable,
      ...(typeof deps.normalizeCandidateBytes === "function" ? { normalizeImpl: deps.normalizeCandidateBytes } : {}),
    };
    let capture = createMediaCapture(page, captureOptions);
    const reacquireWizardPage = async (preferredPage = page) => {
      const onWizard = (candidate) => candidate && !candidate.isClosed()
        && adsWizardScopeAssessment(candidate.url(), adsParams).ok;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const returned = [preferredPage, ...runnerPages].filter(onWizard).at(-1);
        if (returned) return { ok: true, page: returned };
        await sleep(500);
      }
      const target = preferredPage && !preferredPage.isClosed() ? preferredPage : await context.newPage();
      runnerPages.add(target);
      await target.goto(wizardUrl(adsParams), { waitUntil: "domcontentloaded", timeout: 60000 });
      const scope = adsWizardScopeAssessment(target.url(), adsParams);
      return scope.ok ? { ok: true, page: target } : scope;
    };
    const handlers = {
      async select_exact_source_asset() {
        await page.goto(wizardUrl(adsParams), { waitUntil: "domcontentloaded", timeout: 60000 });
        await sleep(6000);
        if (await adsBlockerPresent(page)) return { ok: false, reason: "ads_blocked_by_extension" };
        const wizardScope = adsWizardScopeAssessment(page.url(), adsParams);
        if (!wizardScope.ok) return wizardScope;
        const payload = direct && direct.payload;
        if (!payload || !exactDirectSourceUploadPayload(state.raw.bytes, state.raw.sha256)) {
          return { ok: false, reason: "direct_source_upload_identity_invalid" };
        }
        const cleared = await clearWizardSource(page, adsParams);
        if (!cleared.ok) return cleared;
        const uploadTab = await waitForWizardSourcePanelUploadControl(page, adsParams);
        if (!uploadTab.ok) return uploadTab;
        state.sourceUploadControlRung = uploadTab.rung;
        const uploadScope = adsWizardScopeAssessment(page.url(), adsParams);
        if (!uploadScope.ok) return uploadScope;
        const uploadControl = await wizardSourcePanelUploadControlAssessment(uploadTab.control, uploadTab.panelId);
        if (!uploadControl.usable || uploadControl.rung !== uploadTab.rung) {
          return { ok: false, reason: "wizard_source_upload_tab_detached" };
        }
        if (!(await clickControl(uploadTab.control, "upload"))) return { ok: false, reason: "direct_source_upload_tab_click_failed" };
        const inputResult = await waitForWizardSourceUploadInput(page, { attempts: 80, pollMs: 250 });
        if (!inputResult.ok) return inputResult;
        if (!(await wizardSourceUploadHandleIsUsable(inputResult.input))) {
          return { ok: false, reason: "direct_source_upload_input_detached" };
        }
        const selected = await uploadExactWizardSource(
          page,
          inputResult.input,
          payload,
          { emptyProof: cleared, adsParams },
        );
        if (selected.ok) state.sourceBinding = selected.sourceBinding;
        return { ...selected, sourceUploadControlRung: uploadTab.rung };
      },
      async edit_raw_image() {
        await page.goto(imageEditorUrl(adsParams), { waitUntil: "domcontentloaded", timeout: 60000 });
        await sleep(6000);
        if (await adsBlockerPresent(page)) return { ok: false, reason: "ads_blocked_by_extension" };
        const initialScope = adsEditorScopeAssessment(page.url(), adsParams);
        if (!initialScope.ok) return initialScope;

        // Current Image Editor mounts the owned picker input without needing
        // any entry click. Prefer it, then retain only positively identified
        // image-editor entry controls as bounded compatibility fallbacks.
        let inputResult = await waitForEditorUploadInput(page, { attempts: 16 });
        if (!inputResult.ok && inputResult.reason !== "image_editor_upload_input_not_found") return inputResult;
        if (!inputResult.ok) {
          const chooseImage = await findControl(page, /^choose image to edit$/i, { timeout: 12000 });
          if (chooseImage) {
            if (!(await clickControl(chooseImage, "choose image to edit"))) return { ok: false, reason: "image_editor_entry_click_failed" };
            await sleep(1500);
            if (await adsBlockerPresent(page)) return { ok: false, reason: "ads_blocked_by_extension" };
            const postEntryScope = adsEditorScopeAssessment(page.url(), adsParams);
            if (!postEntryScope.ok) return postEntryScope;
          }

          inputResult = await waitForEditorUploadInput(page, { attempts: 12 });
          if (!inputResult.ok && inputResult.reason !== "image_editor_upload_input_not_found") return inputResult;
          if (!inputResult.ok) {
            const picker = page.getByRole("dialog", { name: /choose an image to add/i }).first();
            const upload = picker.getByRole("button", { name: /^upload$/i }).first();
            if (await upload.count().catch(() => 0)) {
              if (!(await clickControl(upload, "upload"))) return { ok: false, reason: "image_editor_upload_tab_failed" };
              await sleep(1500);
              if (await adsBlockerPresent(page)) return { ok: false, reason: "ads_blocked_by_extension" };
              const postUploadScope = adsEditorScopeAssessment(page.url(), adsParams);
              if (!postUploadScope.ok) return postUploadScope;
            }
            inputResult = await waitForEditorUploadInput(page);
          }
        }
        if (!inputResult.ok) return inputResult;
        const input = inputResult.input;
        if (await adsBlockerPresent(page)) return { ok: false, reason: "ads_blocked_by_extension" };
        const finalScope = adsEditorScopeAssessment(page.url(), adsParams);
        if (!finalScope.ok) return finalScope;
        if (!(await editorUploadHandleIsUsable(input))) return { ok: false, reason: "image_editor_upload_input_detached" };
        try { await input.setInputFiles(state.heroPath); }
        catch { return { ok: false, reason: "image_editor_upload_input_detached" }; }
        await sleep(5000);
        const postFileScope = adsEditorScopeAssessment(page.url(), adsParams);
        if (!postFileScope.ok) return postFileScope;
        const assist = await findControl(page, /edit with help from google ai/i, { timeout: 3500 });
        if (assist) await clickControl(assist, "edit with help from google ai");
        const namedPrompt = page.getByRole("textbox", { name: /describe your edits/i }).first();
        const fallbackPrompt = page.locator('textarea[placeholder*="Describe your edits" i], input[placeholder*="Describe your edits" i]').first();
        const promptInput = (await namedPrompt.count().catch(() => 0)) ? namedPrompt : fallbackPrompt;
        await promptInput.waitFor({ state: "visible", timeout: 20000 }).catch(() => null);
        if (!(await promptInput.count().catch(() => 0))) return { ok: false, reason: "remaster_prompt_input_not_found" };
        if (!(await applyRemasterPrompt(promptInput))) {
          return { ok: false, reason: "remaster_prompt_not_applied" };
        }
        const preGenerateScope = adsEditorScopeAssessment(page.url(), adsParams);
        if (!preGenerateScope.ok) return preGenerateScope;
        const generateLocator = await findControl(page, /^(generate|generate images|create|apply)$/i, { timeout: 15000 });
        if (!generateLocator) {
          const controls = await page.locator('button, [role="button"]').evaluateAll((nodes) => nodes.map((node) => ({
            text: String(node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100),
            aria: String(node.getAttribute("aria-label") || "").trim().slice(0, 100),
            disabled: Boolean(node.disabled || node.getAttribute("aria-disabled") === "true"),
          })).filter((item) => item.text || item.aria).slice(-30)).catch(() => []);
          return { ok: false, reason: "remaster_generate_control_not_found", detail: controls };
        }
        const generate = await generateLocator.elementHandle().catch(() => null);
        if (!(await editorControlHandleIsUsable(generate))) {
          return { ok: false, reason: "image_editor_control_detached" };
        }
        const generateAria = await generate.getAttribute("aria-label").catch(() => "");
        const generateText = await generate.textContent().catch(() => "");
        const label = normalizeClickLabel(generateAria || generateText || "generate");
        const safeLabel = ["generate", "generate images", "create", "apply"].includes(label) ? label : "generate";
        const imageResponses = createImageResponseCapture(page);
        const baseline = await armOptimizedImageLifecycle(promptInput, generate);
        imageResponses.arm();
        const clickResult = await clickScopedEditorControl(page, generate, safeLabel, adsParams, {
          async onRefuse() {
            imageResponses.stop();
            await disarmOptimizedImageLifecycle(page);
          },
        });
        if (!clickResult.ok) return clickResult;
        try {
          state.optimized = await waitForOptimizedImage(page, baseline, state.raw.sha256, imageResponses);
        } finally {
          imageResponses.stop();
          await disarmOptimizedImageLifecycle(page);
        }
        if (!state.optimized.ok) return state.optimized;
        state.remaster = {
          prompt: REMASTER_PROMPT, rawSha256: state.raw.sha256, optimizedSha256: state.optimized.sha256,
          assetIdentity: { sha256: state.optimized.sha256, sourceUrl: state.optimized.sourceUrl, urlFingerprint: state.optimized.urlFingerprint, width: state.optimized.width, height: state.optimized.height },
          assetFingerprint: state.optimized.urlFingerprint,
          promptSha256: REMASTER_PROMPT_SHA256,
        };
        return { ok: true };
      },
      async save_optimized_asset() {
        if (await adsBlockerPresent(page)) return { ok: false, reason: "ads_blocked_by_extension" };
        const save = await findControl(page, /^(save|save image|save to asset library)$/i, { timeout: 15000 });
        if (!save) return { ok: false, reason: "optimized_asset_save_control_not_found" };
        if (!(await clickControl(save, "save"))) return { ok: false, reason: "optimized_asset_save_failed" };
        if (job.stopAtSaveScreen === true) {
          const saveDialog = page.getByRole("dialog", { name: /^save image$/i }).first();
          await saveDialog.waitFor({ state: "visible", timeout: 15000 }).catch(() => null);
          if (!(await saveDialog.isVisible().catch(() => false))) return { ok: false, reason: "save_screen_not_reached" };
          return { ok: false, status: "handoff", reason: "save_screen_ready" };
        }
        const saveDialog = page.getByRole("dialog", { name: /^save image$/i }).first();
        await saveDialog.waitFor({ state: "visible", timeout: 15000 }).catch(() => null);
        if (!(await saveDialog.isVisible().catch(() => false))) return { ok: false, reason: "optimized_asset_save_dialog_not_found" };
        // The footer mounts after the dialog and currently uses Google's
        // custom material-button in the dialog's overlay pane. Reject controls
        // from every other overlay and keep one fixed handle.
        const saveAndClose = await waitForSaveAndCloseControl(page, saveDialog);
        if (!saveAndClose.ok) return saveAndClose;
        if (!(await saveAndCloseControlIsUsable(
          saveAndClose.overlay,
          saveAndClose.dialog,
          saveAndClose.control,
        ))) {
          return { ok: false, reason: "optimized_asset_save_and_close_detached" };
        }
        const returnedPagePromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
        // Account/route scope is the final check immediately before the fixed
        // handle click. A tab switch or account mutation therefore fails shut.
        const editorScope = adsEditorScopeAssessment(page.url(), adsParams);
        if (!editorScope.ok) return editorScope;
        if (!(await clickControl(saveAndClose.control, "save and close"))) return { ok: false, reason: "optimized_asset_save_and_close_failed" };
        const returnedPage = await returnedPagePromise;
        if (returnedPage) runnerPages.add(returnedPage);
        await capture.stop();
        const reacquired = await reacquireWizardPage(returnedPage || page);
        if (!reacquired.ok) return reacquired;
        page = reacquired.page;
        capture = createMediaCapture(page, captureOptions);
        await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => null);
        return { ok: true };
      },
      async select_exact_optimized_asset() {
        const reacquired = await reacquireWizardPage(page);
        if (!reacquired.ok) return reacquired;
        page = reacquired.page;
        await sleep(6000);
        if (await adsBlockerPresent(page)) return { ok: false, reason: "ads_blocked_by_extension" };
        const wizardScope = adsWizardScopeAssessment(page.url(), adsParams);
        if (!wizardScope.ok) return wizardScope;
        // Asset Library thumbnails are re-encoded by Google after Save and
        // therefore cannot retain the captured remaster SHA. Upload the exact
        // response bytes we already verified instead; this is the strongest
        // possible client-photo identity handoff and removes card-order risk.
        const payload = exactOptimizedUploadPayload(state.optimized.bytes, state.optimized.sha256);
        if (!payload) return { ok: false, reason: "optimized_asset_upload_identity_invalid" };
        const cleared = await clearWizardSource(page, adsParams);
        if (!cleared.ok) return cleared;
        const uploadTab = await waitForWizardSourcePanelUploadControl(page, adsParams);
        if (!uploadTab.ok) return uploadTab;
        state.sourceUploadControlRung = uploadTab.rung;
        const uploadScope = adsWizardScopeAssessment(page.url(), adsParams);
        if (!uploadScope.ok) return uploadScope;
        const uploadControl = await wizardSourcePanelUploadControlAssessment(uploadTab.control, uploadTab.panelId);
        if (!uploadControl.usable || uploadControl.rung !== uploadTab.rung) {
          return { ok: false, reason: "wizard_source_upload_tab_detached" };
        }
        if (!(await clickControl(uploadTab.control, "upload"))) return { ok: false, reason: "optimized_asset_upload_tab_click_failed" };
        const inputResult = await waitForWizardSourceUploadInput(page, { attempts: 80, pollMs: 250 });
        if (!inputResult.ok) return inputResult;
        if (!(await wizardSourceUploadHandleIsUsable(inputResult.input))) {
          return { ok: false, reason: "optimized_asset_upload_input_detached" };
        }
        const selected = await uploadExactWizardSource(
          page,
          inputResult.input,
          payload,
          { emptyProof: cleared, adsParams },
        );
        if (selected.ok) state.sourceBinding = selected.sourceBinding;
        return { ...selected, sourceUploadControlRung: uploadTab.rung };
      },
      async create_enhanced_variants() {
        if (await adsBlockerPresent(page)) return { ok: false, reason: "ads_blocked_by_extension" };
        const enhance = await findControl(page, /^create enhanced images$/i, { timeout: 20000 });
        if (!enhance) return { ok: false, reason: "create_enhanced_images_not_found" };
        if (!(await clickControl(enhance, "create enhanced images"))) return { ok: false, reason: "create_enhanced_images_click_failed" };
        return selectHorizontalEnhancedAsset(page);
      },
      async select_horizontal_1_91() {
        if (await adsBlockerPresent(page)) return { ok: false, reason: "ads_blocked_by_extension" };
        // Google renamed the horizontal 1.91:1 choice to Cropped (horizontal).
        // Re-verify the exact checked card instead of clicking a second time.
        const item = page.getByRole("listitem").filter({ hasText: /Cropped\s*\(horizontal\)/i }).first();
        const checkbox = item.locator('material-checkbox[aria-label="Select asset"]');
        return await item.isVisible().catch(() => false)
          && await checkbox.count().catch(() => 0) === 1
          && await checkbox.first().getAttribute("aria-checked").catch(() => null) === "true"
          ? { ok: true }
          : { ok: false, reason: "horizontal_1_91_not_confirmed" };
      },
      async animate_clip() {
        if (await adsBlockerPresent(page)) return { ok: false, reason: "ads_blocked_by_extension" };
        const create = await waitForCreateAnimatedClipsControl(page, { attempts: 80, pollMs: 250 });
        if (!create.ok) return create;
        if (!(await createAnimatedClipsControlIsUsable(create.control))) {
          return { ok: false, reason: "create_animated_clips_control_detached" };
        }
        const animationTarget = await resolveAnimationStepThreeTarget(page);
        if (!animationTarget.ok) return animationTarget;
        const wizardScope = adsWizardScopeAssessment(page.url(), adsParams);
        if (!wizardScope.ok) return wizardScope;
        const armed = await capture.arm(create.control, animationTarget);
        if (!armed.ok) return armed;
        const started = await startAnimationGeneration(page, create.control, adsParams);
        if (!started.ok) {
          await capture.stop();
          return started;
        }
        const captured = await capture.download();
        if (!captured.ok) return captured;
        state.clips = dedupeClipCandidates(captured.candidates);
        if (!state.clips.length) return { ok: false, reason: "clip_candidate_set_empty" };
        state.clips.forEach((candidate, index) => {
          const clipPath = path.join(outDir, `candidate-${String(index + 1).padStart(2, "0")}.mp4`);
          fs.writeFileSync(clipPath, candidate.buffer);
          candidate.clipPath = clipPath;
        });
        const provenance = job.heroImageProvenance && typeof job.heroImageProvenance === "object"
          ? job.heroImageProvenance : {};
        const manifest = {
          schema: "wss.ads_animation_candidates.v1",
          prospectId: job.prospectId,
          source: {
            url: provenance.url || provenance.sourceUrl || job.heroImageUrl || null,
            sha256: state.raw.sha256,
            binding: state.sourceBinding,
          },
          remaster: {
            optimizedSha256: state.remaster.optimizedSha256,
            optimizedAssetFingerprint: state.remaster.assetFingerprint,
            promptSha256: state.remaster.promptSha256,
          },
          expectedCount: captured.expectedCount,
          capturedAt: new Date().toISOString(),
          candidates: state.clips.map(candidateRecord),
        };
        state.candidatesManifestPath = path.join(outDir, "candidates.json");
        fs.writeFileSync(state.candidatesManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        return { ok: true };
      },
      async require_human_review() {
        if (await adsBlockerPresent(page)) return { ok: false, reason: "ads_blocked_by_extension" };
        let approval = job.approvedClip || null;
        const reviewSet = state.clips.map(candidateRecord);
        if (typeof job.approvalCallback === "function") approval = await job.approvalCallback({ candidates: reviewSet, remaster: state.remaster });
        if (typeof deps.approvalCallback === "function") approval = await deps.approvalCallback({ candidates: reviewSet, remaster: state.remaster });
        const candidate = approvedCandidate(state.clips, approval);
        if (!candidate) {
          const held = approvalReviewVerdict(state.clips, state.remaster, workflowStages.slice(0, -1), state.candidatesManifestPath);
          held.reason = approval && approval.approved === true
            ? (/^[a-f0-9]{64}$/i.test(String(approval.sha256 || "")) ? "approved_clip_sha_mismatch" : "clip_approval_identity_required")
            : "clip_approval_required";
          return held;
        }
        const checked = validateClipApproval(approval, candidate);
        if (!checked.ok) {
          const held = approvalReviewVerdict(state.clips, state.remaster, workflowStages.slice(0, -1), state.candidatesManifestPath);
          held.reason = checked.reason;
          return held;
        }
        // Google offers one Save-N control for the whole generated set. Never
        // click it after approving only one SHA. Select the approved local
        // candidate exactly and let the existing upload lane publish it.
        const clipPath = path.join(outDir, "hero.mp4");
        fs.copyFileSync(candidate.clipPath, clipPath);
        state.clip = { ...candidate, clipPath, approval: checked.approval };
        return { ok: true };
      },
    };

    const workflow = await runOrderedStages(handlers, workflowStages);
    await capture.stop();
    if (!workflow.ok) {
      return {
        ...workflow,
        sourceUploadControlRung: workflow.sourceUploadControlRung || state.sourceUploadControlRung || undefined,
        sourceBinding: workflow.sourceBinding || state.sourceBinding || undefined,
        remaster: workflow.remaster || state.remaster || undefined,
      };
    }
    return {
      ok: true, status: "approved", clipPath: state.clip.clipPath, generator: "ads_animate_image",
      sha256: state.clip.sha256, bytes: state.clip.bytes, durationSeconds: state.clip.durationSeconds,
      width: state.clip.width, height: state.clip.height, codec: state.clip.codec,
      approval: state.clip.approval, remaster: state.remaster, stages: workflow.completed,
      sourceUploadControlRung: state.sourceUploadControlRung,
      sourceBinding: state.sourceBinding,
    };
  } finally {
    if (job.keepPageOpen !== true) {
      for (const ownedPage of runnerPages) {
        if (ownedPage && !ownedPage.isClosed()) await ownedPage.close({ runBeforeUnload: false }).catch(() => {});
      }
    }
    // This is a no-op for the source CDP session and closes only our hidden browser.
    await browserSession.close();
  }
}

function parseArgs(argv) {
  const output = {};
  for (let index = 2; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--job") output.job = argv[++index];
    else if (argument.startsWith("--job=")) output.job = argument.slice(6);
    else if (argument === "--observe") output.observe = true;
  }
  return output;
}

function syntheticMp4({ durationSeconds = 4, size = 2048 } = {}) {
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32BE(24, 0); bytes.write("ftyp", 4, "ascii"); bytes.write("isom", 8, "ascii");
  bytes.write("mvhd", 32, "ascii"); bytes[36] = 0;
  bytes.writeUInt32BE(1000, 48); bytes.writeUInt32BE(Math.round(durationSeconds * 1000), 52);
  return bytes;
}

async function runSelfTests() {
  const assert = require("node:assert/strict");
  const passed = [];
  async function test(name, fn) {
    try { await fn(); passed.push(name); }
    catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
  }
  const optimizedTestImage = {
    index: 0,
    nodeId: "image-1",
    src: "https://ads-assetlibrary.usercontent.google.com/result/client.jpg?sig=dom",
    srcset: "",
    naturalWidth: 1200,
    naturalHeight: 675,
    visible: true,
    lifecycle: { activeEpoch: 1, owned: true, insertedEpoch: 0, sourceMutatedEpoch: 0, loadedEpoch: 1 },
  };
  const optimizedTestBaseline = [{
    index: 0,
    nodeId: "image-1",
    src: optimizedTestImage.src,
    srcset: "",
    naturalWidth: 1200,
    naturalHeight: 675,
  }];
  function optimizedTestBytes(fill) {
    const bytes = Buffer.alloc(20000, fill);
    Buffer.from([0xff, 0xd8, 0xff]).copy(bytes);
    return bytes;
  }
  function optimizedTestResponse(url, bytes) {
    return { url, urlFingerprint: urlFingerprint(url), sha256: sha256Hex(bytes), bytes };
  }
  async function optimizedTerminalReason({ responses, rawSha256 = "a".repeat(64), changed = true, images = [optimizedTestImage] }) {
    const currentImages = images.map((image) => changed ? image : {
      ...image,
      lifecycle: { activeEpoch: 1, owned: true, insertedEpoch: 0, sourceMutatedEpoch: 0, loadedEpoch: 0 },
    });
    const page = {
      locator() {
        return {
          async evaluateAll() { return currentImages; },
        };
      },
    };
    const result = await waitForOptimizedImage(page, optimizedTestBaseline, rawSha256, {
      async snapshot() { return responses; },
    }, { timeoutMs: 20, pollMs: 25 });
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result).sort(), ["ok", "reason"]);
    return result.reason;
  }
  await test("click whitelist is enforced at runtime", () => {
    assert.equal(isClickWhitelisted("Create enhanced images"), true);
    assert.equal(isClickWhitelisted("Save and close"), true);
    assert.equal(isClickWhitelisted("Save 1 animated clip in Asset library"), false);
    assert.equal(isClickWhitelisted("Save 6 animated clips in Asset library"), false);
    for (const unsafe of ["Publish", "Edit campaign", "Upload to YouTube", "Disable extension"]) {
      assert.equal(isClickWhitelisted(unsafe), false);
      assert.throws(() => assertWhitelistedClick(unsafe), /click_not_whitelisted/);
    }
  });
  await test("Save and close resolves exact text inside the Save image dialog", async () => {
    const empty = {
      first() { return this; },
      async count() { return 0; },
      async waitFor() {},
      async isVisible() { return false; },
    };
    const materialControl = { id: "save-and-close-material-control" };
    const text = {
      first() { return this; },
      async count() { return 1; },
      async waitFor() {},
      async isVisible() { return true; },
      locator(selector) {
        assert.match(selector, /ancestor-or-self/);
        return {
          first() { return materialControl; },
          async count() { return 1; },
        };
      },
    };
    const saveDialog = {
      getByRole() { return empty; },
      getByText(name) {
        assert.equal(name.test("Save and close"), true);
        return text;
      },
    };
    assert.equal(await findControl(saveDialog, /^save and close$/i), materialControl);
  });
  await test("deterministic remaster prompt preserves truth", () => {
    assert.match(REMASTER_PROMPT, /exact same scene, objects, framing, and composition/i);
    assert.match(REMASTER_PROMPT, /add nothing, remove nothing/i);
    assert.match(REMASTER_PROMPT, /no text, logos, people, or watermarks/i);
  });
  await test("standalone editor returns to Animation Creator", () => {
    const url = imageEditorUrl("ocid=1&authuser=0");
    assert.match(url, /\/aw\/imageeditor\/main\?/);
    assert.match(decodeURIComponent(url), /returnTo=\/aw\/assetstudio\/animationcreator\?ocid=1&authuser=0/);
  });
  await test("tour media and non-Google media are denied", () => {
    assert.equal(isDeniedMediaUrl("https://gstatic.com/adwords-frontend/foryouview/welcome.mp4"), true);
    assert.equal(isDeniedMediaUrl("https://ads.google.com/product-tour/intro.mp4"), true);
    assert.equal(isDeniedMediaUrl("https://evil.example/client.mp4"), true);
    assert.equal(isDeniedMediaUrl("blob:https://ads.google.com/id"), false);
  });
  await test("Google syndication media is exact-host allowlisted", () => {
    assert.equal(isDeniedMediaUrl("https://tpc.googlesyndication.com/sodar/client.png"), false);
    assert.equal(isDeniedMediaUrl("https://tpc.googlesyndication.com.evil.example/client.png"), true);
    assert.equal(isDeniedMediaUrl("https://evil-googlesyndication.com/client.png"), true);
  });
  await test("cross-origin image fetch omits credentials and returns exact bytes", async () => {
    const expected = Buffer.alloc(32, 0x5a);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(expected);
    let capturedSource = "";
    let capturedCredentials = "";
    const page = {
      async evaluate(evaluate, source) {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (input, options) => {
          capturedSource = input;
          capturedCredentials = options && options.credentials;
          return {
            ok: true,
            headers: { get() { return String(expected.length); } },
            async arrayBuffer() {
              return expected.buffer.slice(expected.byteOffset, expected.byteOffset + expected.byteLength);
            },
          };
        };
        try { return await evaluate(source); }
        finally { globalThis.fetch = originalFetch; }
      },
    };
    const source = "https://tpc.googlesyndication.com/sodar/client.png";
    const actual = await bytesFromPageUrl(page, source);
    assert.equal(capturedSource, source);
    assert.equal(capturedCredentials, "same-origin");
    assert.deepEqual(actual, expected);
    assert.equal(hasImageMagic(actual), true);
  });
  await test("CORS-null optimized images use only matching captured response bytes", async () => {
    const bytes = Buffer.alloc(20000, 0x5a);
    Buffer.from([0xff, 0xd8, 0xff]).copy(bytes);
    const sha256 = sha256Hex(bytes);
    const responseUrl = "https://ads-assetlibrary.usercontent.google.com/result/client.jpg?sig=one";
    const image = {
      index: 3,
      nodeId: "image-4",
      src: "https://ads-assetlibrary.usercontent.google.com/result/client.jpg?sig=two",
      srcset: "",
      naturalWidth: 1200,
      naturalHeight: 675,
      lifecycle: { activeEpoch: 1, owned: true, insertedEpoch: 1, sourceMutatedEpoch: 0, loadedEpoch: 1 },
    };
    const page = {
      evaluate() { throw new Error("optimized detection must not page-fetch while capture is armed"); },
      locator() {
        return {
          async evaluateAll() { return [{ ...image, visible: true }]; },
        };
      },
    };
    const responses = [{ url: responseUrl, urlFingerprint: urlFingerprint(responseUrl), sha256, bytes }];
    const actual = await waitForOptimizedImage(page, [], "a".repeat(64), {
      async snapshot() { return responses; },
    }, { timeoutMs: 100 });
    assert.equal(actual.sha256, sha256);
    assert.deepEqual(actual.bytes, bytes);
  });
  await test("stale baseline DOM image is ignored even when classes look generated", () => {
    const stale = {
      ...optimizedTestImage,
      className: "mat-mdc-card ng-star-inserted generated-result",
      lifecycle: { activeEpoch: 1, owned: true, insertedEpoch: 0, sourceMutatedEpoch: 0, loadedEpoch: 0 },
    };
    assert.equal(imageLifecycleChangedFromBaseline(optimizedTestBaseline, stale), false);
  });
  await test("same-URL baseline remains eligible for SHA-bound post-arm changed bytes", async () => {
    const bytes = optimizedTestBytes(0x56);
    const response = optimizedTestResponse(optimizedTestImage.src, bytes);
    const page = {
      locator() {
        return {
          async evaluateAll() { return [optimizedTestImage]; },
        };
      },
    };
    assert.equal(imageLifecycleChangedFromBaseline(optimizedTestBaseline, optimizedTestImage), true);
    const actual = await waitForOptimizedImage(page, optimizedTestBaseline, "a".repeat(64), {
      async snapshot() { return [response]; },
    }, { timeoutMs: 100 });
    assert.equal(actual.ok, true);
    assert.equal(actual.sha256, response.sha256);
  });
  await test("captured optimized fallback rejects mismatched identity and unchanged or unmarked pixels", async () => {
    const bytes = Buffer.alloc(20000, 0x5a);
    Buffer.from([0xff, 0xd8, 0xff]).copy(bytes);
    const sha256 = sha256Hex(bytes);
    const image = {
      index: 0,
      nodeId: "image-result",
      src: "https://ads-assetlibrary.usercontent.google.com/result/client.jpg?sig=dom",
      srcset: "",
      naturalWidth: 1200,
      naturalHeight: 675,
      lifecycle: { activeEpoch: 1, owned: true, insertedEpoch: 1, sourceMutatedEpoch: 0, loadedEpoch: 1 },
    };
    const mismatch = [{
      url: "https://ads-assetlibrary.usercontent.google.com/result/other.jpg?sig=response",
      urlFingerprint: "ads-assetlibrary.usercontent.google.com/result/other.jpg",
      sha256,
      bytes,
    }];
    assert.equal(capturedImageResponseForDom(mismatch, image.src), null);
    const matched = [{ url: image.src, urlFingerprint: urlFingerprint(image.src), sha256, bytes }];
    assert.equal(capturedImageResponseForDom([{
      ...matched[0], sha256: "b".repeat(64),
    }], image.src), null, "declared response SHA must match the retained Buffer");
    const siblingBytes = Buffer.from(bytes);
    siblingBytes[siblingBytes.length - 1] = 0x59;
    const siblingSha256 = sha256Hex(siblingBytes);
    const sibling = {
      url: "https://ads-assetlibrary.usercontent.google.com/result/client.jpg?sig=sibling",
      urlFingerprint: urlFingerprint(image.src),
      sha256: siblingSha256,
      bytes: siblingBytes,
    };
    assert.equal(
      capturedImageResponseForDom([...matched, sibling], image.src, "a".repeat(64)).sha256,
      sha256,
      "an exact URL must beat a later fingerprint-only sibling",
    );
    assert.equal(
      capturedImageResponseForDom([...matched, sibling], image.src, sha256),
      null,
      "an exact raw response must block a fingerprint-only changed sibling",
    );
    assert.equal(capturedImageResponseForDom([
      { ...matched[0], url: "https://ads-assetlibrary.usercontent.google.com/result/client.jpg?sig=one" },
      { ...sibling, url: "https://ads-assetlibrary.usercontent.google.com/result/client.jpg?sig=two" },
    ], image.src, "a".repeat(64)), null, "two changed SHAs in one fingerprint pool are ambiguous");
    assert.notEqual(
      capturedImageFingerprint("https://ads-assetlibrary.usercontent.google.com/result/a%2Fb.jpg?keyframe=1&sig=one"),
      capturedImageFingerprint("http://ads-assetlibrary.usercontent.google.com:8443/result/a/b.jpg?keyframe=2&sig=two"),
      "capture identity retains scheme, port, encoded path, and non-secret query keys",
    );
    for (const [domUrl, responseUrl, label] of [
      ["https://ads-assetlibrary.usercontent.google.com/result/client/", "https://ads-assetlibrary.usercontent.google.com/result/client", "trailing slash"],
      ["https://ads-assetlibrary.usercontent.google.com/result/client?id=1&id=2", "https://ads-assetlibrary.usercontent.google.com/result/client?id=2&id=1", "query order"],
      ["https://ads-assetlibrary.usercontent.google.com/result/client?authuser=0&token=a&key=one", "https://ads-assetlibrary.usercontent.google.com/result/client?authuser=1&token=b&key=two", "non-signing keys"],
    ]) {
      assert.equal(capturedImageResponseForDom([{ ...sibling, url: responseUrl }], domUrl, "a".repeat(64)), null, `${label} must not collide`);
    }
    assert.equal(await responseBackedOptimizedImage(null, image, sha256, matched, []), null);
    assert.equal(await responseBackedOptimizedImage(null, {
      ...image,
      lifecycle: { activeEpoch: 1, owned: true, insertedEpoch: 0, sourceMutatedEpoch: 0, loadedEpoch: 0 },
    }, "a".repeat(64), matched, [{ ...image, lifecycle: undefined }]), null);
  });
  await test("optimized wait reports no usable post-Generate image response without leaking response data", async () => {
    assert.equal(
      await optimizedTerminalReason({ responses: [] }),
      OPTIMIZED_IMAGE_FAILURE.NO_USABLE_POST_GENERATE_RESPONSE,
    );
  });
  await test("optimized wait reports captured response identity mismatch", async () => {
    const bytes = optimizedTestBytes(0x51);
    assert.equal(
      await optimizedTerminalReason({
        responses: [optimizedTestResponse("https://ads-assetlibrary.usercontent.google.com/result/other.jpg?sig=response", bytes)],
      }),
      OPTIMIZED_IMAGE_FAILURE.RESPONSE_IDENTITY_MISMATCH,
    );
  });
  await test("optimized wait reports unchanged raw pixels", async () => {
    const bytes = optimizedTestBytes(0x52);
    assert.equal(
      await optimizedTerminalReason({
        responses: [optimizedTestResponse(optimizedTestImage.src, bytes)],
        rawSha256: sha256Hex(bytes),
      }),
      OPTIMIZED_IMAGE_FAILURE.UNCHANGED_FROM_RAW,
    );
  });
  await test("optimized wait reports missing DOM editor result state", async () => {
    const bytes = optimizedTestBytes(0x53);
    assert.equal(
      await optimizedTerminalReason({
        responses: [optimizedTestResponse(optimizedTestImage.src, bytes)],
        changed: false,
      }),
      OPTIMIZED_IMAGE_FAILURE.DOM_RESULT_STATE_MISSING,
    );
  });
  await test("optimized wait preserves generic not-captured for ambiguous response bytes", async () => {
    const first = optimizedTestBytes(0x54);
    const second = optimizedTestBytes(0x55);
    assert.equal(
      await optimizedTerminalReason({
        responses: [
          optimizedTestResponse(optimizedTestImage.src, first),
          optimizedTestResponse(optimizedTestImage.src, second),
        ],
      }),
      OPTIMIZED_IMAGE_FAILURE.NOT_CAPTURED,
    );
  });
  await test("saved asset selection survives CDN CORS only for the SHA-bound identity", async () => {
    const bytes = Buffer.alloc(20000, 0x5a);
    Buffer.from([0xff, 0xd8, 0xff]).copy(bytes);
    const sha256 = sha256Hex(bytes);
    const sourceUrl = "https://ads-assetlibrary.usercontent.google.com/result/client.jpg?sig=saved";
    const pageFor = (src) => {
      let clicks = 0;
      const imageLocator = {
        locator: () => ({ count: async () => 0 }),
        click: async () => { clicks += 1; },
      };
      return {
        page: {
          evaluate: async () => null,
          mouse: { wheel: async () => {} },
          locator: (selector) => selector === "img" ? {
            evaluateAll: async () => [{ index: 0, src, visible: true, naturalWidth: 1200, naturalHeight: 675 }],
            nth: () => imageLocator,
          } : { evaluateAll: async () => [] },
        },
        clicks: () => clicks,
      };
    };
    const exact = pageFor(sourceUrl);
    assert.equal((await selectExactOptimizedAsset(exact.page, { sourceUrl, sha256, urlFingerprint: urlFingerprint(sourceUrl) }, { timeoutMs: 10 })).ok, false);
    assert.equal(exact.clicks(), 0, "an exact URL without current SHA bytes must fail closed");

    const rotatedUrl = "https://ads-assetlibrary.usercontent.google.com/result/client.jpg?sig=rotated";
    const rotated = pageFor(rotatedUrl);
    const responseCapture = { snapshot: async () => [{ url: rotatedUrl, sha256, bytes }] };
    assert.equal((await selectExactOptimizedAsset(rotated.page, { sourceUrl, sha256, urlFingerprint: urlFingerprint(sourceUrl) }, { timeoutMs: 100, responseCapture })).ok, true);
    assert.equal(rotated.clicks(), 1, "a rotated signature requires the captured expected SHA");
  });
  await test("only playable MP4 bytes pass", () => {
    const mp4 = syntheticMp4({ durationSeconds: 4 });
    const checked = validateMp4Bytes(mp4);
    assert.equal(checked.ok, true); assert.equal(checked.durationSeconds, 4); assert.equal(checked.sha256, sha256Hex(mp4));
    assert.equal(validateMp4Bytes(Buffer.alloc(2048), { durationHint: 4 }).reason, "clip_not_mp4");
    assert.equal(validateMp4Bytes(syntheticMp4({ durationSeconds: 60 })).reason, "clip_duration_out_of_range");
  });
  await test("clip approval is exact-SHA and never implied", () => {
    const sha256 = "a".repeat(64);
    assert.equal(validateClipApproval(null, { sha256 }).reason, "clip_approval_required");
    assert.equal(validateClipApproval({ approved: true }, { sha256 }).reason, "clip_approval_identity_required");
    assert.equal(validateClipApproval({ approved: true, sha256: "b".repeat(64) }, { sha256 }).reason, "approved_clip_sha_mismatch");
    assert.equal(validateClipApproval({ approved: true, sha256 }, { sha256 }).ok, true);
  });
  await test("generated count is read from Google and never assumed to be six", () => {
    assert.equal(expectedClipCount("Save 6 animated clips in Asset library"), 6);
    assert.equal(expectedClipCount("Save 1 animated clip in Asset library"), 1);
    assert.equal(expectedClipCount("Save animated clips"), null);
  });
  await test("AVIF responses are inspected but still-image AVIF never counts as a clip", () => {
    assert.equal(candidateMediaResponse("image/avif", "https://googleusercontent.com/a"), true);
    assert.equal(candidateMediaResponse("image/jpeg", "https://googleusercontent.com/a.jpg"), false);
    const still = candidateStreamPlan({
      format: { format_name: "avif" },
      streams: [{ index: 0, codec_type: "video", codec_name: "av1", nb_frames: "1", avg_frame_rate: "0/0", width: 1280, height: 720 }],
    });
    assert.equal(still.ok, false);
    assert.equal(still.reason, "candidate_timed_video_stream_missing");
  });
  await test("AV1 and dual-stream candidates require exact-stream H264 normalization", () => {
    const av1 = candidateStreamPlan({
      format: { duration: "4" },
      streams: [{ index: 2, codec_type: "video", codec_name: "av1", nb_frames: "120", avg_frame_rate: "30/1", width: 1280, height: 720 }],
    });
    assert.equal(av1.ok, true); assert.equal(av1.normalize, true); assert.equal(av1.streamIndex, 2);
    const dual = candidateStreamPlan({
      format: { duration: "4" },
      streams: [
        { index: 0, codec_type: "video", codec_name: "av1", nb_frames: "1", avg_frame_rate: "0/0", disposition: { attached_pic: 1 } },
        { index: 3, codec_type: "video", codec_name: "h264", nb_frames: "120", avg_frame_rate: "30/1", width: 1280, height: 720 },
      ],
    });
    assert.equal(dual.ok, true); assert.equal(dual.normalize, true); assert.equal(dual.streamIndex, 3);
    const args = ffmpegNormalizationArgs("in.bin", "out.mp4", dual);
    assert.deepEqual(args.slice(args.indexOf("-map"), args.indexOf("-map") + 2), ["-map", "0:3"]);
    assert.equal(args.includes("libx264"), true); assert.equal(args.includes("yuv420p"), true); assert.equal(args.includes("+faststart"), true);
  });
  await test("missing media probes fail closed before a candidate SHA is accepted", () => {
    const bytes = syntheticMp4({ durationSeconds: 4 });
    const result = normalizeCandidateBytes(bytes, {
      spawnImpl: () => ({ status: null, error: { code: "ENOENT" }, stdout: "" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "ffprobe_unavailable");
  });
  await test("candidate set is SHA-deduped and approval selects one exact clip", () => {
    const first = { sha256: "a".repeat(64), clipPath: "candidate-01.mp4" };
    const duplicate = { ...first, clipPath: "duplicate.mp4" };
    const second = { sha256: "b".repeat(64), clipPath: "candidate-02.mp4" };
    const candidates = dedupeClipCandidates([first, duplicate, second, { sha256: "invalid" }]);
    assert.deepEqual(candidates.map((item) => item.clipPath), ["candidate-01.mp4", "candidate-02.mp4"]);
    assert.equal(approvedCandidate(candidates, { approved: true, sha256: second.sha256 }).clipPath, "candidate-02.mp4");
    assert.equal(approvedCandidate(candidates, { approved: true, sha256: "c".repeat(64) }), null);
  });
  await test("workflow stages are awaited in locked order", async () => {
    const events = [];
    const handlers = Object.fromEntries(WORKFLOW_STAGES.map((stage) => [stage, async () => { await Promise.resolve(); events.push(stage); return { ok: true }; }]));
    const result = await runOrderedStages(handlers);
    assert.equal(result.ok, true); assert.deepEqual(events, WORKFLOW_STAGES);
  });
  await test("job shape fails closed", async () => { await assert.rejects(() => runJob({}), /job requires prospectId and sourceUrl/); });
  for (const name of passed) console.log(`PASS ${name}`);
  if (process.exitCode) throw new Error("self_test_failed");
}

function exitCliWithVerdict(verdict) {
  const code = verdict && (verdict.ok === true || verdict.status === "awaiting_review") ? 0 : 1;
  // A Playwright CDP connection keeps a socket handle active even after every
  // runner-owned page closes. Write synchronously, then terminate only this
  // CLI process. Never close the CDP browser object: that can close the owner's browser.
  fs.writeSync(1, `${JSON.stringify(verdict)}\n`);
  process.exit(code);
}

async function main({ argv = process.argv, runJobImpl = runJob } = {}) {
  const args = parseArgs(argv);
  if (argv.includes("--test")) { await runSelfTests(); return; }
  if (!args.job && !args.observe) {
    console.error("usage: animate-image-runner.cjs --job job.json | --observe | --test");
    process.exitCode = 2; return;
  }
  const job = args.job ? JSON.parse(fs.readFileSync(args.job, "utf8"))
    : { prospectId: "observe", sourceUrl: "https://example.com/", outDir: ".", adsParams: process.env.ADS_STATION_PARAMS || "" };
  const verdict = await runJobImpl(job).catch((error) => ({ ok: false, reason: "runner_crashed", detail: String(error.message).slice(0, 200) }));
  exitCliWithVerdict(verdict);
}

if (require.main === module) {
  main().catch((error) => {
    exitCliWithVerdict({ ok: false, reason: "runner_crashed", detail: String(error.message).slice(0, 200) });
  });
}

// ===========================================================================
// VEO BUILDER STATION — the Google Ads image-to-video Veo 3 Station driver.
//
// This is the SECOND workflow this file hosts. The primary workflow above
// drives the Animation Creator wizard (upload path, direct_client_photo).
// This section drives the image-to-video builder (scan path) with all six
// live-measured fixes from issue #353 / PR #350 ported here.
//
// THE STATION PAGE PROTOCOL (the seam that makes this testable)
//   goto(url)                         -> void
//   adBlockerNotice()                 -> { present, text }
//   videoLengthLabel()                -> string
//   adaptImagesChecked()              -> true | false | null
//   setAdaptImagesChecked(false)      -> boolean|null
//   sceneSlots()                      -> { addButtons, filled }
//   clickAddScene()                   -> boolean
//   modalTabs()                       -> string[]
//   clickModalTab(name)               -> boolean
//   fillScanUrl(url)                  -> boolean
//   submitScanUrl()                   -> boolean
//   scanResults()                     -> [{ index, src }]
//   selectScanResult(index)           -> boolean
//   resolveCropDialog()               -> { present, ok, detail? }   // FIX 2
//   imageAcceptanceCount()            -> 0 | 1 | null               // FIX 3
//   imageRequirementError()           -> string                     // FIX 4
//   saveEnabled()                     -> boolean
//   clickSave()                       -> boolean
//   uploadIntoModal(files)            -> boolean
//   generateEnabled()                 -> boolean
//   clickGenerate()                   -> boolean
//   expectedClipCount()               -> number                     // FIX 1
//   clipSources()                     -> string[]
//   downloadClip(src)                 -> Buffer
//   closeModal()                      -> boolean
// ===========================================================================

const VEO_BUILDER_BASE = 'https://ads.google.com/aw/video/builder';
const VEO_SCAN_TAB = 'Website or social';
const VEO_UPLOAD_TAB = 'Upload';
const VEO_URL_INPUT_SELECTOR = 'input[aria-label="Enter your URL"]';
const VEO_ADAPT_CHECKBOX_SELECTOR =
  'input[type=checkbox][aria-label="Adapt images for video templates"]';
const SIMGAD_PREFIX = 'https://tpc.googlesyndication.com/simgad/';
const VEO_SCENES_REQUIRED = 2;
// FIX 1 (measured 2026-08-21): two 5s clips per two-scene 10s job.
const VEO_MIN_CLIP_SECONDS = 3;
const VEO_MAX_CLIP_SECONDS = 12;
const VEO_MAX_SCENE_CLIP_SECONDS = 7;  // per-scene clip; the joined reel is wider
const VEO_MIN_REEL_SECONDS = 8;
const VEO_MAX_REEL_SECONDS = 12;
const VEO_REQUESTED_LENGTH_SECONDS = 10;

const VEO_DEFAULTS = {
  cdpUrl: 'http://127.0.0.1:9222',
  scanTimeoutMs: 25_000,
  scanPollMs: 1_000,
  saveTimeoutMs: 15_000,
  fillTimeoutMs: 20_000,
  generateTimeoutMs: 300_000,
  generatePollMs: 3_000,
  joinTimeoutMs: 120_000,
  stepPauseMs: 400,
  maxClipBytes: 80 * 1024 * 1024,
};

const FORBIDDEN_ACTIONS = Object.freeze([
  'publish',
  'upload to youtube',
  'create campaign',
  'publish campaign',
  'save and continue to campaign',
]);

function veoRefuse(reason, detail) {
  const out = { ok: false, reason: String(reason) };
  if (detail != null && String(detail) !== '') out.detail = String(detail).slice(0, 600);
  return out;
}

// ---------------------------------------------------------------------------
// BUILDER URL
// ---------------------------------------------------------------------------

function builderUrl(adsParams) {
  const raw = String(adsParams || '').replace(/^[?&]+/, '');
  const params = new URLSearchParams(raw);
  params.set('videoTool', 'imageToVideo');
  return `${VEO_BUILDER_BASE}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// CLIP VERIFICATION — pure bytes, no ffprobe.
// ---------------------------------------------------------------------------

function veoReadBoxSize(buffer, offset) {
  if (offset + 8 > buffer.length) return null;
  let size = buffer.readUInt32BE(offset);
  const type = buffer.toString('latin1', offset + 4, offset + 8);
  let headerBytes = 8;
  if (size === 1) {
    if (offset + 16 > buffer.length) return null;
    const high = buffer.readUInt32BE(offset + 8);
    const low = buffer.readUInt32BE(offset + 12);
    size = high * 2 ** 32 + low;
    headerBytes = 16;
  } else if (size === 0) {
    size = buffer.length - offset;
  }
  if (size < headerBytes) return null;
  return { size, type, headerBytes };
}

function veoFindBox(buffer, wanted, start = 0, end = buffer.length) {
  let offset = start;
  while (offset + 8 <= end) {
    const box = veoReadBoxSize(buffer, offset);
    if (!box) return null;
    if (box.type === wanted) {
      return { start: offset + box.headerBytes, end: Math.min(offset + box.size, end) };
    }
    offset += box.size;
  }
  return null;
}

function mp4DurationSeconds(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  const moov = veoFindBox(buffer, 'moov');
  if (!moov) return null;
  const mvhd = veoFindBox(buffer, 'mvhd', moov.start, moov.end);
  if (!mvhd) return null;
  const at = mvhd.start;
  if (at + 4 > buffer.length) return null;
  const version = buffer.readUInt8(at);
  let timescale;
  let duration;
  if (version === 1) {
    if (at + 28 > buffer.length) return null;
    timescale = buffer.readUInt32BE(at + 20);
    const high = buffer.readUInt32BE(at + 24);
    const low = at + 32 <= buffer.length ? buffer.readUInt32BE(at + 28) : 0;
    duration = high * 2 ** 32 + low;
  } else {
    if (at + 20 > buffer.length) return null;
    timescale = buffer.readUInt32BE(at + 12);
    duration = buffer.readUInt32BE(at + 16);
  }
  if (!timescale || !Number.isFinite(duration)) return null;
  return duration / timescale;
}

function looksLikeMp4(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  return buffer.toString('latin1', 4, 8) === 'ftyp';
}

function verifyClipBytes(buffer, opts = {}) {
  const minSec = Number(opts.minSeconds ?? VEO_MIN_CLIP_SECONDS);
  const maxSec = Number(opts.maxSeconds ?? VEO_MAX_CLIP_SECONDS);
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return veoRefuse('generation_unverified', 'downloaded clip is empty');
  }
  if (!looksLikeMp4(buffer)) {
    return veoRefuse('generation_unverified', 'downloaded bytes are not an mp4 (no ftyp box)');
  }
  const durationSec = mp4DurationSeconds(buffer);
  if (durationSec == null) {
    return veoRefuse('generation_unverified', 'mp4 carries no readable moov/mvhd duration');
  }
  if (durationSec < minSec || durationSec > maxSec) {
    return veoRefuse(
      'generation_unverified',
      `clip is ${durationSec.toFixed(2)}s, outside the ${minSec}-${maxSec}s window`,
    );
  }
  return { ok: true, durationSec, bytes: buffer.length };
}

// ---------------------------------------------------------------------------
// SOURCE IDENTITY
// ---------------------------------------------------------------------------

function simgadId(src) {
  const m = String(src || '').match(/\/simgad\/([^/?#]+)/);
  return m ? m[1] : '';
}

function sourceIdentity(src) {
  const id = simgadId(src);
  return id ? `simgad:${id}` : String(src || '');
}

// ---------------------------------------------------------------------------
// JOB VALIDATION
// ---------------------------------------------------------------------------

function validateJob(job = {}) {
  const sourceUrl = String(job.sourceUrl || '').trim();
  if (!sourceUrl) return veoRefuse('no_legacy_site_url', 'job.sourceUrl is empty');
  if (!/^https?:\/\//i.test(sourceUrl)) {
    return veoRefuse('no_legacy_site_url', `job.sourceUrl is not an http(s) URL: ${sourceUrl}`);
  }
  if (/(^|\.)wss-ai\.com$/i.test(new URL(sourceUrl).hostname)) {
    return veoRefuse('no_legacy_site_url', 'sourceUrl points at our own mirror host');
  }
  if (!String(job.adsParams || '').trim()) {
    return veoRefuse('ads_params_missing', 'job.adsParams is required');
  }
  return {
    ok: true,
    job: {
      prospectId: String(job.prospectId || job.prospect_id || '').trim(),
      sourceUrl,
      adsParams: String(job.adsParams).replace(/^[?&]+/, ''),
      outDir: job.outDir ? path.resolve(String(job.outDir)) : null,
      uploadFallbackFiles: Array.isArray(job.uploadFallbackFiles) ? job.uploadFallbackFiles.slice() : [],
      allowUnverifiedLength: job.allowUnverifiedLength === true,
      timing: { ...VEO_DEFAULTS, ...(job.timing && typeof job.timing === 'object' ? job.timing : {}) },
    },
  };
}

// ---------------------------------------------------------------------------
// CLIP JOIN — FIX 1
// ---------------------------------------------------------------------------

function execFileAsync(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.detail = String(stderr || error.message || error).trim();
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/** Google's live two-scene job returns two codec-matched 5s mp4s. Join those
 * exact scene streams without re-encoding, then independently verify the
 * resulting ten-second container before it can leave this process. */
async function joinMp4Clips(buffers, opts = {}) {
  if (!Array.isArray(buffers) || buffers.length !== VEO_SCENES_REQUIRED || buffers.some((b) => !Buffer.isBuffer(b))) {
    throw new Error(`expected ${VEO_SCENES_REQUIRED} mp4 buffers to join`);
  }
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wss-veo-join-'));
  const listPath = path.join(dir, 'clips.txt');
  const outPath = path.join(dir, 'joined.mp4');
  try {
    const names = [];
    for (let i = 0; i < buffers.length; i++) {
      const name = `scene-${i + 1}.mp4`;
      names.push(name);
      await fsp.writeFile(path.join(dir, name), buffers[i]);
    }
    await fsp.writeFile(listPath, names.map((name) => `file '${name}'`).join('\n') + '\n');
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c', 'copy', '-movflags', '+faststart', outPath,
    ], {
      cwd: dir,
      timeout: Number(opts.timeoutMs || VEO_DEFAULTS.joinTimeoutMs),
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return await fsp.readFile(outPath);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// ONE SCENE
// ---------------------------------------------------------------------------

async function fillOneScene(page, job, sceneIndex, usedSources, log) {
  const t = job.timing;

  const before = await page.sceneSlots();
  if (!before || Number(before.addButtons) < 1) {
    return veoRefuse('scene_add_button_missing', `scene ${sceneIndex + 1}: no button whose innerText is "add"`);
  }
  if (!(await page.clickAddScene())) {
    return veoRefuse('scene_add_button_missing', `scene ${sceneIndex + 1}: the add button would not take a click`);
  }
  await sleep(t.stepPauseMs);

  const tabs = await page.modalTabs();
  const tabList = Array.isArray(tabs) ? tabs.map((x) => String(x)) : [];
  if (!tabList.some((name) => name.toLowerCase() === VEO_SCAN_TAB.toLowerCase())) {
    return veoRefuse(
      'modal_tab_missing',
      `scene ${sceneIndex + 1}: no "${VEO_SCAN_TAB}" tab; saw [${tabList.join(' | ')}]`,
    );
  }
  if (!(await page.clickModalTab(VEO_SCAN_TAB))) {
    return veoRefuse('modal_tab_missing', `scene ${sceneIndex + 1}: "${VEO_SCAN_TAB}" tab would not open`);
  }
  await sleep(t.stepPauseMs);

  if (!(await page.fillScanUrl(job.sourceUrl))) {
    return veoRefuse('url_input_missing', `scene ${sceneIndex + 1}: no visible ${VEO_URL_INPUT_SELECTOR}`);
  }
  await page.submitScanUrl();

  const deadline = Date.now() + t.scanTimeoutMs;
  let results = [];
  while (Date.now() < deadline) {
    const found = await page.scanResults();
    results = (Array.isArray(found) ? found : [])
      .map((r, i) => ({ index: Number(r && r.index != null ? r.index : i), src: String((r && r.src) || '') }))
      .filter((r) => r.src.startsWith(SIMGAD_PREFIX));
    if (results.length) break;
    await sleep(t.scanPollMs);
  }

  let chosen = null;
  if (results.length) {
    chosen = results.find((r) => !usedSources.has(r.src)) || null;
  }

  if (!chosen) {
    const fallbackFile = job.uploadFallbackFiles[sceneIndex] || job.uploadFallbackFiles[0] || null;
    if (!fallbackFile) {
      return veoRefuse(
        results.length ? 'image_scan_returned_too_few_images' : 'image_scan_returned_no_images',
        `scene ${sceneIndex + 1}: scan of ${job.sourceUrl} yielded ${results.length} usable image(s)` +
          ` and no uploadFallbackFiles were supplied`,
      );
    }
    if (!tabList.some((name) => name.toLowerCase() === VEO_UPLOAD_TAB.toLowerCase())) {
      return veoRefuse('modal_tab_missing', `scene ${sceneIndex + 1}: no "${VEO_UPLOAD_TAB}" tab for the fallback`);
    }
    if (!(await page.clickModalTab(VEO_UPLOAD_TAB))) {
      return veoRefuse('modal_tab_missing', `scene ${sceneIndex + 1}: "${VEO_UPLOAD_TAB}" tab would not open`);
    }
    await sleep(t.stepPauseMs);
    if (!(await page.uploadIntoModal([fallbackFile]))) {
      return veoRefuse('upload_fallback_failed', `scene ${sceneIndex + 1}: modal upload input rejected ${fallbackFile}`);
    }
    chosen = { index: -1, src: `upload:${path.basename(String(fallbackFile))}` };
    log.push(`scene ${sceneIndex + 1}: upload fallback used (${chosen.src})`);
  } else {
    if (!(await page.selectScanResult(chosen.index))) {
      return veoRefuse('image_selection_failed', `scene ${sceneIndex + 1}: thumbnail ${chosen.index} would not select`);
    }
    log.push(`scene ${sceneIndex + 1}: selected ${chosen.src}`);
  }

  // FIX 2 + FIX 3 + FIX 4: crop dialog, acceptance counter, refusal text.
  // Save state is NOT acceptance: Google's only reliable success signal is
  // "Images for your ad (1/1)". A rejected image carries Google's own visible
  // refusal instead of being flattened into a generic timeout.
  if (typeof page.imageAcceptanceCount === 'function') {
    const acceptanceDeadline = Date.now() + t.saveTimeoutMs;
    let accepted = false;
    while (Date.now() < acceptanceDeadline) {
      if (typeof page.resolveCropDialog === 'function') {
        const crop = await page.resolveCropDialog();
        if (crop && crop.present === true && crop.ok !== true) {
          return veoRefuse(
            'image_crop_selection_failed',
            `scene ${sceneIndex + 1}: ${String(crop.detail || 'crop dialog could not be accepted')}`,
          );
        }
      }
      if (typeof page.imageRequirementError === 'function') {
        const requirementError = String((await page.imageRequirementError()) || '').trim();
        if (requirementError) {
          return veoRefuse('image_does_not_meet_requirements', `scene ${sceneIndex + 1}: ${requirementError}`);
        }
      }
      if (Number(await page.imageAcceptanceCount()) === 1) {
        accepted = true;
        break;
      }
      await sleep(t.scanPollMs);
    }
    if (!accepted) {
      const requirementError = typeof page.imageRequirementError === 'function'
        ? String((await page.imageRequirementError()) || '').trim()
        : '';
      if (requirementError) {
        return veoRefuse('image_does_not_meet_requirements', `scene ${sceneIndex + 1}: ${requirementError}`);
      }
      return veoRefuse(
        'image_selection_unconfirmed',
        `scene ${sceneIndex + 1}: Images for your ad never reached (1/1)`,
      );
    }
  }

  // Save itself must become pressable.
  const saveDeadline = Date.now() + t.saveTimeoutMs;
  let enabled = false;
  while (Date.now() < saveDeadline) {
    enabled = (await page.saveEnabled()) === true;
    if (enabled) break;
    await sleep(t.scanPollMs);
  }
  if (!enabled) {
    return veoRefuse('save_never_enabled', `scene ${sceneIndex + 1}: Save stayed aria-disabled after selection`);
  }
  if (!(await page.clickSave())) {
    return veoRefuse('save_never_enabled', `scene ${sceneIndex + 1}: Save would not take a click`);
  }

  // Real proof the scene FILLED: the slot count moved.
  const fillDeadline = Date.now() + t.fillTimeoutMs;
  let after = before;
  while (Date.now() < fillDeadline) {
    await sleep(t.scanPollMs);
    after = await page.sceneSlots();
    if (after && Number(after.filled) > Number(before.filled)) break;
  }
  if (!after || Number(after.filled) <= Number(before.filled)) {
    return veoRefuse(
      'scene_did_not_fill',
      `scene ${sceneIndex + 1}: filled stayed at ${Number(before.filled)} after Save`,
    );
  }

  usedSources.add(chosen.src);
  return { ok: true, source: chosen.src, slots: after };
}

// ---------------------------------------------------------------------------
// THE RUN
// ---------------------------------------------------------------------------

async function runVeoClipJob(rawJob, opts = {}) {
  const validated = validateJob(rawJob);
  if (validated.ok !== true) return validated;
  const job = validated.job;
  const page = opts.page;
  if (!page) return veoRefuse('station_unavailable', 'no Station page was supplied');

  const writeFile = opts.writeFile || ((file, buffer) => fsp.writeFile(file, buffer));
  const joinClips = opts.joinClips || ((buffers) => joinMp4Clips(buffers, { timeoutMs: job.timing.joinTimeoutMs }));
  const log = [];
  const t = job.timing;

  try {
    await page.goto(builderUrl(job.adsParams));
    await sleep(t.stepPauseMs);

    const notice = await page.adBlockerNotice();
    if (notice && notice.present === true) {
      return veoRefuse('ads_blocked_by_extension', String(notice.text || 'Turn off ad blockers'));
    }

    const lengthLabel = String((await page.videoLengthLabel()) || '').trim();
    const seconds = (lengthLabel.match(/(\d+)\s*s\b/i) || [])[1];
    if (!seconds) {
      if (!job.allowUnverifiedLength) {
        return veoRefuse('video_length_unreadable', `Video length control read as ${JSON.stringify(lengthLabel)}`);
      }
      log.push(`video length unreadable (${JSON.stringify(lengthLabel)}) — allowed by job.allowUnverifiedLength`);
    } else if (Number(seconds) !== VEO_REQUESTED_LENGTH_SECONDS) {
      return veoRefuse('video_length_not_10s', `Video length reads ${seconds}s`);
    } else {
      log.push('video length verified: 10s');
    }

    const adapt = await page.adaptImagesChecked();
    if (adapt === true && job.adaptImages !== true) {
      const now = await page.setAdaptImagesChecked(false);
      if (now === true) {
        log.push('adapt-images toggle would not turn off; proceeding with it on');
      } else {
        log.push('adapt-images toggle was on; turned off');
      }
    } else if (adapt === true) {
      log.push('adapt-images toggle left on by job.adaptImages');
    } else {
      log.push(adapt === false ? 'adapt-images toggle already off' : 'adapt-images toggle not present');
    }

    const usedSources = new Set();
    const sources = [];
    for (let i = 0; i < VEO_SCENES_REQUIRED; i++) {
      const filled = await fillOneScene(page, job, i, usedSources, log);
      if (filled.ok !== true) return filled;
      sources.push(filled.source);
    }

    const slots = await page.sceneSlots();
    if (!slots || Number(slots.filled) < VEO_SCENES_REQUIRED) {
      return veoRefuse(
        'scene_did_not_fill',
        `after both passes only ${Number(slots && slots.filled) || 0}/${VEO_SCENES_REQUIRED} scenes are filled`,
      );
    }

    // FIX 6: snapshot clip sources BEFORE generate so stale previews can be
    // excluded from the new-clip set.
    const expectedCount = typeof page.expectedClipCount === 'function'
      ? Math.max(1, Number(await page.expectedClipCount()) || VEO_SCENES_REQUIRED)
      : 1;
    const beforeRaw = expectedCount > 1 ? await page.clipSources() : [];
    const beforeClipSources = new Set((Array.isArray(beforeRaw) ? beforeRaw : []).map(String).filter(Boolean));

    if ((await page.generateEnabled()) !== true) {
      return veoRefuse('generate_still_disabled', 'both scenes report filled but "Generate video clips" is still aria-disabled');
    }
    if (!(await page.clickGenerate())) {
      return veoRefuse('generate_still_disabled', '"Generate video clips" would not take a click');
    }
    log.push('generation started');

    // FIX 1 + FIX 6: collect ALL expected per-scene clips; exclude stale previews.
    const genDeadline = Date.now() + t.generateTimeoutMs;
    let clipSrcs = [];
    while (Date.now() < genDeadline) {
      const raw = await page.clipSources();
      const srcs = (Array.isArray(raw) ? raw : []).map(String).filter(Boolean);
      clipSrcs = [...new Set(srcs.filter((src) => !beforeClipSources.has(src)))];
      if (clipSrcs.length >= expectedCount) break;
      await sleep(t.generatePollMs);
    }
    if (!clipSrcs.length) {
      return veoRefuse('clip_never_appeared', `no new clip after ${Math.round(t.generateTimeoutMs / 1000)}s`);
    }
    if (clipSrcs.length < expectedCount) {
      return veoRefuse(
        'clip_count_incomplete',
        `expected ${expectedCount} scene clips; only ${clipSrcs.length} appeared`,
      );
    }
    clipSrcs = clipSrcs.slice(0, expectedCount);

    const clipBuffers = [];
    const clipDurations = [];
    for (let i = 0; i < clipSrcs.length; i++) {
      let part;
      try {
        part = await page.downloadClip(clipSrcs[i]);
      } catch (e) {
        return veoRefuse('clip_download_failed', `scene clip ${i + 1}: ${String((e && e.message) || e)}`);
      }
      if (!Buffer.isBuffer(part)) {
        return veoRefuse('clip_download_failed', `scene clip ${i + 1}: download returned ${typeof part}, not bytes`);
      }
      if (part.length > t.maxClipBytes) {
        return veoRefuse('clip_download_failed', `scene clip ${i + 1}: ${part.length} bytes, over the ${t.maxClipBytes} cap`);
      }
      const partVerdict = verifyClipBytes(
        part,
        expectedCount > 1 ? { minSeconds: VEO_MIN_CLIP_SECONDS, maxSeconds: VEO_MAX_SCENE_CLIP_SECONDS } : {},
      );
      if (partVerdict.ok !== true) {
        return veoRefuse(partVerdict.reason, `scene clip ${i + 1}: ${String(partVerdict.detail || 'verification failed')}`);
      }
      clipBuffers.push(part);
      clipDurations.push(partVerdict.durationSec);
    }

    let buffer = clipBuffers[0];
    let verdict = verifyClipBytes(buffer);
    if (expectedCount > 1) {
      try {
        buffer = await joinClips(clipBuffers);
      } catch (e) {
        return veoRefuse('clip_join_failed', String((e && (e.detail || e.message)) || e));
      }
      if (!Buffer.isBuffer(buffer)) {
        return veoRefuse('clip_join_failed', `join returned ${typeof buffer}, not bytes`);
      }
      if (buffer.length > t.maxClipBytes) {
        return veoRefuse('clip_join_failed', `joined reel is ${buffer.length} bytes, over the ${t.maxClipBytes} cap`);
      }
      verdict = verifyClipBytes(buffer, { minSeconds: VEO_MIN_REEL_SECONDS, maxSeconds: VEO_MAX_REEL_SECONDS });
    }
    if (verdict.ok !== true) return verdict;

    let clipPath = null;
    if (job.outDir) {
      await fsp.mkdir(job.outDir, { recursive: true }).catch(() => {});
      clipPath = path.join(job.outDir, 'clip.mp4');
      await writeFile(clipPath, buffer);
    }

    return {
      ok: true,
      prospect_id: job.prospectId,
      source_url: job.sourceUrl,
      clipPath,
      clipCount: clipSrcs.length,
      clipDurations,
      bytes: buffer.length,
      durationSec: verdict.durationSec,
      sources,
      composed_from: sources.map(sourceIdentity),
      log,
      buffer,
    };
  } catch (e) {
    return veoRefuse('station_error', String((e && e.stack) || e));
  }
}

// ---------------------------------------------------------------------------
// THE REAL PLAYWRIGHT STATION PAGE — FIX 5: everything scoped to modal.
// ---------------------------------------------------------------------------

const VEO_PAGE_LIB = `(() => {
  if (window.__veoStation) return true;
  const norm = (s) => String(s == null ? '' : s).replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return !(cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0);
  };
  const label = (el) => norm(
    (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) ||
    el.innerText || el.textContent || ''
  );
  const disabled = (el) => {
    let n = el;
    for (let i = 0; i < 4 && n; i++) {
      const ad = n.getAttribute && n.getAttribute('aria-disabled');
      if (ad === 'true') return true;
      if (ad === 'false') return false;
      if (n.hasAttribute && n.hasAttribute('disabled')) return true;
      n = n.parentElement;
    }
    return el && el.disabled === true;
  };
  const clickables = () => Array.from(document.querySelectorAll(
    'material-button, material-icon-button, material-fab, button, [role="button"], [role="tab"], [role="option"]'
  )).filter(visible);
  const byLabel = (want) => clickables().find((el) => label(el).toLowerCase() === String(want).toLowerCase());
  const dialogs = () => Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], material-dialog')).filter(visible);
  const imageDialog = () => dialogs().find((el) => /Images for your ad\\s*\\(\\d+\\/1\\)/i.test(norm(el.innerText || el.textContent || ''))) || null;
  const doClick = (el) => {
    if (!el || disabled(el)) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    try { el.focus({ preventScroll: true }); } catch (e) {}
    el.click();
    return true;
  };
  window.__veoStation = { norm, visible, label, disabled, clickables, byLabel, dialogs, imageDialog, doClick };
  return true;
})()`;

function createStationPage(playwrightPage, options = {}) {
  const maxClipBytes = Number(options.maxClipBytes || VEO_DEFAULTS.maxClipBytes);

  async function lib() {
    await playwrightPage.evaluate(VEO_PAGE_LIB);
  }
  async function run(expr, arg) {
    await lib();
    return playwrightPage.evaluate(expr, arg);
  }

  return {
    async goto(url) {
      await playwrightPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await playwrightPage.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    },

    async adBlockerNotice() {
      return run(`(() => {
        const D = window.__veoStation;
        const nodes = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], material-dialog'))
          .filter(D.visible);
        for (const n of nodes) {
          const text = D.norm(n.innerText || n.textContent || '');
          if (/ad ?block/i.test(text)) return { present: true, text: text.slice(0, 600) };
        }
        const body = D.norm(document.body ? document.body.innerText : '');
        const m = body.match(/Turn off ad blockers[\\s\\S]{0,400}/i);
        if (m) return { present: true, text: D.norm(m[0]).slice(0, 600) };
        return { present: false, text: '' };
      })()`);
    },

    async videoLengthLabel() {
      return run(`(() => {
        const D = window.__veoStation;
        const labelled = Array.from(document.querySelectorAll('[aria-label], [role="combobox"], material-dropdown-select, select'))
          .filter(D.visible);
        for (const el of labelled) {
          const own = D.norm((el.getAttribute && el.getAttribute('aria-label')) || '');
          if (/video length/i.test(own)) return D.norm(el.innerText || el.textContent || own);
        }
        const all = Array.from(document.querySelectorAll('*')).filter(D.visible);
        for (const el of all) {
          const text = D.norm(el.innerText || '');
          if (/^video length\\b/i.test(text) && text.length < 80) return text;
        }
        return '';
      })()`);
    },

    async adaptImagesChecked() {
      return run(`(() => {
        const el = document.querySelector(${JSON.stringify(VEO_ADAPT_CHECKBOX_SELECTOR)});
        if (!el) return null;
        return el.checked === true || el.getAttribute('aria-checked') === 'true';
      })()`);
    },

    async setAdaptImagesChecked(next) {
      return run(`((want) => {
        const el = document.querySelector(${JSON.stringify(VEO_ADAPT_CHECKBOX_SELECTOR)});
        if (!el) return null;
        const is = () => el.checked === true || el.getAttribute('aria-checked') === 'true';
        if (is() !== want) el.click();
        return is();
      })`, next === true);
    },

    async sceneSlots() {
      return run(`(() => {
        const D = window.__veoStation;
        const add = D.clickables().filter((el) => D.norm(el.innerText || '').toLowerCase() === 'add');
        const filled = Array.from(document.querySelectorAll('img[src*="/simgad/"], img[src^="blob:"], img[src^="data:image"]'))
          .filter(D.visible)
          .filter((img) => !img.closest('[role="dialog"]'))
          .length;
        return { addButtons: add.length, filled };
      })()`);
    },

    async clickAddScene() {
      return run(`(() => {
        const D = window.__veoStation;
        const add = D.clickables().filter((el) => D.norm(el.innerText || '').toLowerCase() === 'add');
        return add.length ? D.doClick(add[0]) : false;
      })()`);
    },

    async modalTabs() {
      return run(`(() => {
        const D = window.__veoStation;
        const root = D.imageDialog() || document;
        return Array.from(root.querySelectorAll('[role="tab"], material-tab, .tab-button'))
          .filter(D.visible).map((el) => D.label(el)).filter(Boolean);
      })()`);
    },

    async clickModalTab(name) {
      return run(`((want) => {
        const D = window.__veoStation;
        const root = D.imageDialog() || document;
        const tabs = Array.from(root.querySelectorAll('[role="tab"], material-tab, .tab-button')).filter(D.visible);
        const hit = tabs.find((el) => D.label(el).toLowerCase() === String(want).toLowerCase());
        return hit ? D.doClick(hit) : false;
      })`, String(name));
    },

    async fillScanUrl(url) {
      const box = playwrightPage.locator(`${VEO_URL_INPUT_SELECTOR}:visible`).first();
      const count = await box.count().catch(() => 0);
      if (!count) return false;
      await box.fill(String(url));
      return true;
    },

    async submitScanUrl() {
      const box = playwrightPage.locator(`${VEO_URL_INPUT_SELECTOR}:visible`).first();
      const count = await box.count().catch(() => 0);
      if (!count) return false;
      await box.press('Enter');
      return true;
    },

    async scanResults() {
      return run(`(() => {
        const D = window.__veoStation;
        const root = D.imageDialog();
        if (!root) return [];
        const imgs = Array.from(root.querySelectorAll('img')).filter(D.visible)
          .filter((img) => String(img.currentSrc || img.src || '').indexOf('tpc.googlesyndication.com/simgad/') === 0);
        return imgs.map((img, index) => ({ index, src: String(img.currentSrc || img.src || '') }));
      })()`);
    },

    async selectScanResult(index) {
      return run(`((i) => {
        const D = window.__veoStation;
        const root = D.imageDialog();
        if (!root) return false;
        const imgs = Array.from(root.querySelectorAll('img')).filter(D.visible)
          .filter((img) => String(img.currentSrc || img.src || '').indexOf('tpc.googlesyndication.com/simgad/') === 0);
        const img = imgs[i];
        if (!img) return false;
        const target = img.closest('[role="option"], [role="button"], button, material-button, li') || img;
        try { target.scrollIntoView({ block: 'center' }); } catch (e) {}
        target.click();
        return true;
      })`, Number(index));
    },

    // FIX 2: crop dialog — choose 1.91:1 and press Select before Save opens.
    async resolveCropDialog() {
      return run(`(() => {
        const D = window.__veoStation;
        const dialog = D.dialogs().find((el) => /Choose how to crop your image/i.test(D.norm(el.innerText || el.textContent || '')));
        if (!dialog) return { present: false, ok: true };
        const controls = Array.from(dialog.querySelectorAll('button, material-button, [role="button"], [role="option"], [role="radio"]'))
          .filter(D.visible);
        const landscape = controls.find((el) => /(^|\\s)1\\.91:1(\\s|$)/i.test(D.label(el)));
        if (landscape && !D.doClick(landscape)) {
          return { present: true, ok: false, detail: '1.91:1 crop would not take a click' };
        }
        const select = controls.find((el) => D.label(el).toLowerCase() === 'select');
        if (!select) return { present: true, ok: false, detail: 'Select button missing in crop dialog' };
        if (!D.doClick(select)) return { present: true, ok: false, detail: 'Select stayed aria-disabled in crop dialog' };
        return { present: true, ok: true };
      })()`);
    },

    // FIX 3: read the (1/1) counter instead of polling saveEnabled.
    async imageAcceptanceCount() {
      return run(`(() => {
        const D = window.__veoStation;
        const root = D.imageDialog();
        if (!root) return null;
        const text = D.norm(root.innerText || root.textContent || '');
        const m = text.match(/Images for your ad\\s*\\((\\d+)\\/1\\)/i);
        return m ? Number(m[1]) : null;
      })()`);
    },

    // FIX 4: surface Google's verbatim refusal text.
    async imageRequirementError() {
      return run(`(() => {
        const D = window.__veoStation;
        for (const root of D.dialogs()) {
          const text = D.norm(root.innerText || root.textContent || '');
          const m = text.match(/Image doesn['']t meet requirements[^.\\n]*/i);
          if (m) return D.norm(m[0]);
        }
        return '';
      })()`);
    },

    async saveEnabled() {
      return run(`(() => {
        const D = window.__veoStation;
        const root = D.imageDialog();
        const el = D.byLabel('Save');
        return !!root && !!el && root.contains(el) && !D.disabled(el);
      })()`);
    },

    async clickSave() {
      return run(`(() => {
        const D = window.__veoStation;
        const root = D.imageDialog();
        const el = D.byLabel('Save');
        return !!root && !!el && root.contains(el) && D.doClick(el);
      })()`);
    },

    async uploadIntoModal(files) {
      // The modal's own upload input — NOT the page's fifteen stray file inputs.
      const dialog = playwrightPage.locator('[role="dialog"]:visible input[type=file]').first();
      const count = await dialog.count().catch(() => 0);
      if (!count) return false;
      await dialog.setInputFiles(files.map((f) => String(f)));
      return true;
    },

    async generateEnabled() {
      return run(`(() => {
        const D = window.__veoStation;
        const el = D.byLabel('Generate video clips');
        return !!el && !D.disabled(el);
      })()`);
    },

    async clickGenerate() {
      return run(`(() => {
        const D = window.__veoStation;
        return D.doClick(D.byLabel('Generate video clips'));
      })()`);
    },

    // FIX 1: expectedClipCount lets the runner know how many clips to wait for.
    async expectedClipCount() {
      return VEO_SCENES_REQUIRED;
    },

    async clipSources() {
      return run(`(() => {
        return Array.from(document.querySelectorAll('video'))
          .map((v) => String(v.currentSrc || v.src || ''))
          .filter(Boolean);
      })()`);
    },

    async closeModal() {
      return run(`(() => {
        const D = window.__veoStation;
        return D.doClick(D.byLabel('Cancel')) || D.doClick(D.byLabel('Close'));
      })()`);
    },

    async downloadClip(src) {
      const base64 = await playwrightPage.evaluate(async ({ url, cap }) => {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error('clip fetch HTTP ' + res.status);
        const blob = await res.blob();
        if (blob.size > cap) throw new Error('clip too large: ' + blob.size);
        const reader = new FileReader();
        return await new Promise((resolve, reject) => {
          reader.onerror = () => reject(new Error('clip read failed'));
          reader.onload = () => resolve(String(reader.result).split(',').pop());
          reader.readAsDataURL(blob);
        });
      }, { url: String(src), cap: maxClipBytes });
      return Buffer.from(String(base64 || ''), 'base64');
    },
  };
}

async function connectStationPage(opts = {}) {
  const cdpUrl = String(opts.cdpUrl || process.env.ADS_STATION_CDP_URL || VEO_DEFAULTS.cdpUrl);
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 20_000 });
  } catch (e) {
    return veoRefuse(
      'station_unavailable',
      `could not attach to the owner's Chrome at ${cdpUrl}: ${String((e && e.message) || e)}`,
    );
  }
  const context = browser.contexts()[0];
  if (!context) {
    // CDP law: a connected browser is the owner's — never close it, not even on
    // refusal. The connection drops when this invocation ends.
    return veoRefuse('station_unavailable', 'the attached Chrome exposes no browser context');
  }
  context.setDefaultTimeout(20_000);
  context.setDefaultNavigationTimeout(60_000);
  const raw = await context.newPage();
  return {
    ok: true,
    page: createStationPage(raw, opts),
    async close() {
      // CDP law: close the PAGE the station opened; the connected browser is
      // the owner's and must survive the session.
      await raw.close().catch(() => {});
    },
  };
}

// ===========================================================================
// END VEO BUILDER STATION
// ===========================================================================

module.exports = {
  runJob, runOrderedStages, wizardUrl, imageEditorUrl,
  REMASTER_PROMPT, REMASTER_PROMPT_SHA256, DIRECT_SOURCE_RECIPE, DIRECT_SOURCE_RECIPE_SHA256,
  CLICK_TEXT_WHITELIST, WORKFLOW_STAGES, DIRECT_WORKFLOW_STAGES, normalizeClickLabel,
  isClickWhitelisted, isDeniedMediaUrl, hasMp4Magic,
  parseMp4DurationSeconds, validateMp4Bytes, urlFingerprint, sha256Hex,
  exactOptimizedUploadPayload, exactDirectSourceUploadPayload, exactImageDimensions,
  imagePreparationMode, directSourceState,
  validateClipApproval, selectionEvidenceIsSelected, optimizedResponseMatchesSha,
  capturedImageFingerprint, capturedImageResponseForDom, responseBackedOptimizedImage,
  responseBackedOptimizedImageAssessment, imageLifecycleChangedFromBaseline, applyRemasterPrompt,
  armOptimizedImageLifecycle,
  selectExactOptimizedAsset, selectHorizontalEnhancedAsset,
  expectedClipCount, dedupeClipCandidates, approvedCandidate, candidateRecord,
  candidateMediaResponse, renderedMediaDescriptors, createMediaCapture, createImageResponseCapture,
  animationStepThreeTargetTabAssessment, animationStepThreeTabAssessment,
  animationStepThreePanelAssessment, resolveAnimationStepThreeTarget, resolveAnimationStepThree,
  candidateStreamPlan, ffmpegNormalizationArgs, normalizeCandidateBytes,
  ADS_ACCOUNT_PARAM_KEYS, WIZARD_SOURCE_BIND_TIMEOUT_MS, safeAdsAccountParamsFromUrl, resolveAdsParams,
  backgroundBrowserEnabled, resolveBackgroundBrowserExecutable, scopedGoogleStorageState, openAdsBrowserSession,
  adsPageScopeAssessment, adsEditorScopeAssessment, adsWizardScopeAssessment,
  editorUploadHandleIsUsable, waitForEditorUploadInput,
  wizardSourceUploadHandleIsUsable, wizardSourceUploadHandleIsOwnedByPanel, waitForWizardSourceUploadInput,
  wizardSourceCountValue, wizardSourceImageDescriptors, wizardSourceStepTabAssessment,
  wizardSourcePanelAssessment, resolveWizardSourceStepOne, activateWizardSourceStepOne,
  wizardSourcePanelState, wizardSourcePanelIsEmpty, wizardSourcePanelHasOneAsset,
  wizardSourcePanelRemoveControlIsUsable, waitForWizardSourcePanelRemoveControl,
  wizardSourcePanelUploadControlIsUsable, waitForWizardSourcePanelUploadControl,
  clearWizardSource, waitForBoundWizardSource, uploadExactWizardSource,
  editorControlHandleIsUsable, clickScopedEditorControl,
  createAnimatedClipsControlIsUsable, waitForCreateAnimatedClipsControl,
  armGeneratedMediaBaseline, animationMediaChangedAfterClick,
  animationLaunchChanged, startAnimationGeneration,
  waitForSaveAndCloseControl, saveAndCloseControlIsUsable,
  exitCliWithVerdict, main,
  // Veo Builder Station exports
  runVeoClipJob, createStationPage, connectStationPage,
  builderUrl, validateJob,
  verifyClipBytes, joinMp4Clips, mp4DurationSeconds, looksLikeMp4,
  simgadId, sourceIdentity,
  SIMGAD_PREFIX, FORBIDDEN_ACTIONS,
  VEO_DEFAULTS, VEO_SCENES_REQUIRED,
  VEO_MIN_CLIP_SECONDS, VEO_MAX_CLIP_SECONDS, VEO_MAX_SCENE_CLIP_SECONDS,
  VEO_MIN_REEL_SECONDS, VEO_MAX_REEL_SECONDS, VEO_REQUESTED_LENGTH_SECONDS,
};
