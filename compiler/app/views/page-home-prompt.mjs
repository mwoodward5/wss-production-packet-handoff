import { page } from "./layout.mjs";

export function landing({ user }) {
  return page({
    title: "A beautiful business website from one simple message",
    desc: "Tell WSS Launch about your business in your own words. Add any links or photos you have, see a free website preview, and publish only when you love it.",
    path: "/",
    user,
    body: `
<section class="prompt-hero molten-hero forge-glow" id="forge">
  <video class="prompt-hero-video" autoplay muted loop playsinline preload="metadata" aria-label="Cinematic local-business website showcase">
    <source src="/siteforge-showcase-optimized.mp4" type="video/mp4">
  </video>
  <div class="prompt-hero-grade" aria-hidden="true"></div>
  <div class="heat-lines" aria-hidden="true"><i></i><i></i></div>
  <div class="wrap prompt-hero-inner">
    <p class="prompt-kicker"><span></span>Tell us about your business. We take it from there.</p>
    <h1>A website you are <span class="heat-word"><em>proud</em></span><br> to show people.</h1>
    <p class="prompt-promise">Type a few sentences about your business, or paste any links you already have. WSS Launch gathers the useful details, creates a beautiful website, and checks every page before anyone else sees it.</p>

    <form id="intake-genie-form" class="prompt-composer" data-endpoint="/api/try/intake" enctype="multipart/form-data">
      <label class="sr-only" for="forge-prompt">Tell us about your business and add any helpful links</label>
      <div class="prompt-writing-plane">
        <textarea id="forge-prompt" name="description" rows="4" maxlength="2000" required placeholder="My business is called Summit Roofing. We repair roofs around Plano, Texas. Here is our current website and Google page..."></textarea>
        <button class="prompt-icon-button" type="button" data-voice-button aria-label="Tell us about your business by voice" title="Tell us about your business by voice">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"/></svg>
        </button>
        <div class="voice-state" data-voice-state aria-live="polite"></div>
      </div>
      <div class="prompt-source-rail" id="prompt-source-rail" aria-live="polite">
        <span data-source-chip="website">Website</span>
        <span data-source-chip="gbp">Google</span>
        <span data-source-chip="social">Social</span>
        <span data-source-chip="asset">Drive</span>
        <span data-source-chip="files">Files</span>
      </div>
      <div class="prompt-drive-panel" data-drive-panel hidden>
        <label for="drive-link">Public Google Drive link</label>
        <div><input id="drive-link" name="asset_url" type="url" inputmode="url" placeholder="https://drive.google.com/..."><button type="button" data-drive-done>Use link</button></div>
        <p data-drive-status aria-live="polite"></p>
      </div>
      <div class="prompt-file-tray" data-file-tray aria-live="polite"></div>
      <div class="prompt-actions">
        <div class="prompt-toolset">
          <label class="prompt-tool" for="ig-files" title="Add photos, a brief, or a ZIP">
            <input id="ig-files" name="files" type="file" accept="image/png,image/jpeg,image/webp,image/gif,.zip,.txt,.md,.csv,.json,.html" multiple>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg><span>Add files</span>
          </label>
          <button class="prompt-tool" type="button" data-drive-button title="Import a public Google Drive file">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 3-6 10 3 5h12l3-5-6-10H9Z"/><path d="m9 3 6 10M3 13h12M6 18l6-10"/></svg><span>Drive</span>
          </button>
          <button class="prompt-tool prompt-clear" type="button" data-clear-draft title="Clear prompt">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/></svg><span class="sr-only">Clear prompt</span>
          </button>
          <small data-draft-state aria-live="polite"></small>
        </div>
        <button class="prompt-submit" type="submit"><span>Make my free preview</span><i aria-hidden="true">→</i></button>
      </div>
    </form>
    <p class="prompt-footnote">No account or credit card needed. Start with whatever you have: a few words, a website, a Google page, social links, photos, or a folder of files.</p>
    <div id="try-result" class="prompt-result" aria-live="polite"></div>
  </div>
</section>

<section class="proof-band" aria-label="WSS Launch standards">
  <div class="wrap proof-grid">
    <div><strong>11/11</strong><span>important checks before launch</span></div>
    <div><strong>One of one</strong><span>designed around your business</span></div>
    <div><strong>Nothing fake</strong><span>only your real facts and reviews</span></div>
    <div><strong>Every screen</strong><span>made to work beautifully</span></div>
  </div>
</section>

<section class="molten-standard" id="how" aria-labelledby="standard-title">
  <div class="wrap">
    <div class="standard-heading"><p class="label hot">Why WSS Launch feels different</p><h2 id="standard-title">You know your business.<br>We handle the <em>website.</em></h2></div>
    <div class="standard-grid">
      <article class="standard-card panel hot-rule"><img src="/brand/grade-seal.svg" width="62" height="62" alt=""><h3>Checked before you see it</h3><p>We look for broken links, weak writing, awkward phone layouts, missing details, and design problems before we show you the result.</p></article>
      <article class="standard-card panel hot-rule"><span class="standard-icon" aria-hidden="true">01</span><h3>Made for your business</h3><p>Your website is shaped around your work, your customers, and your personality. It is not your name pasted into somebody else's template.</p></article>
      <article class="standard-card panel hot-rule"><span class="standard-icon" aria-hidden="true">✓</span><h3>Your real story</h3><p>We use your actual services, photos, hours, and reviews. If something cannot be confirmed, we leave it out instead of making it up.</p></article>
    </div>
  </div>
</section>

<section class="showcase-band" aria-labelledby="showcase-title">
  <div class="wrap">
    <div class="showcase-heading">
      <div><p class="eyebrow">Real examples</p><h2 id="showcase-title">The kind of website we can make for you.</h2></div>
      <a href="https://wss-ca-landscape-landscape-connection-inc.vercel.app/" target="_blank" rel="noopener">Visit a finished website →</a>
    </div>
    <div class="showcase-reel">
      <a href="https://wss-ca-landscape-landscape-connection-inc.vercel.app/" target="_blank" rel="noopener"><img src="/showcase/landscape-connection.webp" width="960" height="666" alt="Landscape Connection cinematic website hero" loading="lazy"><span>Estate editorial</span></a>
      <div><img src="/showcase/signature-landscape.webp" width="960" height="666" alt="Signature Landscape cinematic website hero" loading="lazy"><span>Architectural field notes</span></div>
      <div><img src="/showcase/richard-diaz.webp" width="960" height="666" alt="Richard Diaz Landscape cinematic website hero" loading="lazy"><span>Warm owner-led narrative</span></div>
    </div>
  </div>
</section>

<section class="forge-sequence">
  <div class="wrap forge-sequence-grid">
    <div class="forge-sequence-intro"><p class="eyebrow">What happens next</p><h2>One message in. A complete website out.</h2><p>Most of the work happens quietly in the background. You do not need to learn design software, write website copy, or fill out a giant questionnaire.</p></div>
    <ol>
      <li><b>01</b><div><h3>We gather what already exists</h3><p>We can read your website, Google page, social links, logo, photos, services, reviews, hours, and contact details.</p></div></li>
      <li><b>02</b><div><h3>We design around you</h3><p>Your colors, words, photos, services, and customers guide the look. Every section has a clear job and every button leads somewhere useful.</p></div></li>
      <li><b>03</b><div><h3>We check every detail</h3><p>We test the writing, links, forms, phones, accessibility, search setup, and overall design before your website can go live.</p></div></li>
    </ol>
  </div>
</section>

<section class="quality-statement">
  <div class="wrap quality-statement-inner">
    <p class="label">Simple pricing. No surprise charges.</p>
    <h2>See your website free. Pay only when you are ready to make it public.</h2>
    <a class="btn primary" href="#forge">Make my free preview</a>
  </div>
</section>`,
  });
}
