'use strict';

/**
 * email-template-v2.cjs
 *
 * Node 20 / CommonJS
 *
 * Exports:
 *   renderProspectEmail(data) -> { html, text }
 *
 * Input contract:
 *
 * data = {
 *   business: {
 *     name,
 *     trade,
 *     city,
 *     accentColor,
 *     logoUrl
 *   },
 *   contactPhoneDisplay,
 *   beforeShotUrl,
 *   afterShotUrl,
 *   mirrorUrl,
 *   dashboardShotUrl,
 *   unsubscribeUrl, // REQUIRED, HTTPS
 *   reviews: [{
 *     name,
 *     avatarUrl,
 *     stars,
 *     text,
 *     source // "google" renders Google G badge
 *   }],
 *   commercialVideo: {
 *     posterUrl,
 *     downloadUrl
 *   },
 *   assets: {
 *     animatedWGifUrl,
 *     flagBadgeUrl,
 *     rileyIllustrationUrl,
 *     inboxGraphicUrl,
 *     mobileMotionGifUrl
 *   },
 *   honestMath: {
 *     leadsPerMonth,
 *     costPerLead
 *   }
 * }
 *
 * Production constraints:
 * - Table-based email layout.
 * - Inline styles only.
 * - No JavaScript in rendered email.
 * - No external CSS.
 * - Gmail web + iOS Mail friendly.
 * - Every rendered image has explicit width, height, and alt.
 * - Images must resolve to HTTPS.
 * - HTTP image URLs are upgraded to HTTPS.
 * - No invented claims, reviews, offers, phones, or URLs.
 * - Missing optional modules skip cleanly.
 * - A valid unsubscribe URL is mandatory.
 */

const DEFAULT_ACCENT = '#0B63F6';
const WSS_EMAIL = 'hello@wss-ai.com';

/**
 * Escape HTML text and attribute values.
 *
 * @param {*} value
 * @returns {string}
 */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Accept only HTTPS links.
 *
 * For HTTP input, upgrade the URL to HTTPS.
 * All other protocols and malformed URLs are rejected.
 *
 * @param {*} value
 * @returns {string}
 */
function safeUrl(value) {
  if (!value) return '';

  try {
    const url = new URL(String(value).trim());

    if (url.protocol === 'http:') {
      url.protocol = 'https:';
    }

    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

/**
 * Accept only valid hex colors with 3, 4, 6, or 8 hex digits.
 * All other input falls back to DEFAULT_ACCENT.
 *
 * The return value is normalized:
 * - #abc      -> #AABBCC
 * - #abcd     -> #AABBCCDD
 * - #aabbcc   -> #AABBCC
 * - #aabbccdd -> #AABBCCDD
 *
 * @param {*} value
 * @returns {string}
 */
function safeColor(value) {
  const input = String(value || '').trim();

  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(input)) {
    return DEFAULT_ACCENT;
  }

  const hex = input.slice(1);

  if (hex.length === 3 || hex.length === 4) {
    return (
      '#' +
      hex
        .split('')
        .map((char) => char + char)
        .join('')
        .toUpperCase()
    );
  }

  return `#${hex.toUpperCase()}`;
}

/**
 * Choose readable foreground text for normalized hex color.
 *
 * Ignores alpha for luminance calculation because email clients may render
 * alpha inconsistently. safeColor() guarantees normalized hex input.
 *
 * @param {string} color
 * @returns {"#111111"|"#FFFFFF"}
 */
function contrastText(color) {
  const normalized = safeColor(color);
  const rgbHex = normalized.length === 9
    ? normalized.slice(0, 7)
    : normalized;

  const r = parseInt(rgbHex.slice(1, 3), 16);
  const g = parseInt(rgbHex.slice(3, 5), 16);
  const b = parseInt(rgbHex.slice(5, 7), 16);

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.68 ? '#111111' : '#FFFFFF';
}

/**
 * @param {*} value
 * @returns {number|null}
 */
function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {*} value
 * @returns {string}
 */
function initials(value) {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return parts
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/**
 * Clamp visible review text to 220 characters.
 *
 * @param {*} value
 * @returns {string}
 */
function clampReviewText(value) {
  const text = String(value || '').trim();

  if (text.length <= 220) return text;

  return `${text.slice(0, 219).trimEnd()}…`;
}

/**
 * Render five honest star positions.
 *
 * Example:
 * 3 -> ★★★☆☆
 *
 * Fractional values round to nearest whole star because the email uses
 * text glyphs rather than half-star graphics.
 *
 * @param {*} value
 * @returns {string}
 */
function starString(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) return '';

  const filled = Math.max(0, Math.min(5, Math.round(n)));
  return `${'★'.repeat(filled)}${'☆'.repeat(5 - filled)}`;
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatNumber(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2
  }).format(value);
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatMoney(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}

/**
 * Render an email-safe image.
 *
 * @param {string} src
 * @param {string} alt
 * @param {number} width
 * @param {number} height
 * @param {string} extraStyle
 * @returns {string}
 */
function img(src, alt, width, height, extraStyle = '') {
  const url = safeUrl(src);
  if (!url) return '';

  return (
    `<img` +
    ` src="${esc(url)}"` +
    ` width="${width}"` +
    ` height="${height}"` +
    ` alt="${esc(alt || '')}"` +
    ` style="display:block;width:${width}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;${extraStyle}"` +
    `>`
  );
}

/**
 * Render Gmail/iOS-compatible CTA button.
 *
 * @param {string} href
 * @param {string} label
 * @param {string} background
 * @param {string} foreground
 * @returns {string}
 */
function button(href, label, background, foreground = '#FFFFFF') {
  const url = safeUrl(href);
  if (!url || !label) return '';

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td
          bgcolor="${esc(background)}"
          style="border-radius:8px;background:${esc(background)};"
        >
          <a
            href="${esc(url)}"
            style="display:inline-block;padding:14px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;font-weight:700;color:${esc(foreground)};text-decoration:none;border-radius:8px;"
          >${esc(label)}</a>
        </td>
      </tr>
    </table>
  `;
}

/**
 * @param {{eyebrow?:string,title?:string,copy?:string}} params
 * @returns {string}
 */
function sectionHeading({ eyebrow = '', title = '', copy = '' }) {
  return `
    ${
      eyebrow
        ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#676767;margin:0 0 6px 0;">${esc(eyebrow)}</div>`
        : ''
    }
    ${
      title
        ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:25px;line-height:31px;font-weight:800;color:#111111;margin:0 0 8px 0;">${esc(title)}</div>`
        : ''
    }
    ${
      copy
        ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#4B4B4B;margin:0;">${esc(copy)}</div>`
        : ''
    }
  `;
}

/**
 * Shared before/after renderer.
 *
 * Used both:
 * - as the hero fallback when no commercial video exists
 * - as the dedicated comparison module when commercial video exists
 *
 * The rebuild CTA renders whenever mirrorUrl exists.
 *
 * @param {{
 *   beforeUrl:string,
 *   afterUrl:string,
 *   mirrorUrl:string,
 *   businessName:string,
 *   accent:string,
 *   accentText:string,
 *   eyebrow?:string,
 *   title?:string
 * }} params
 * @returns {string}
 */
function beforeAfterBlock({
  beforeUrl,
  afterUrl,
  mirrorUrl,
  businessName,
  accent,
  accentText,
  eyebrow = 'Website',
  title = 'Before and rebuilt'
}) {
  if (!beforeUrl && !afterUrl) return '';

  return `
    ${sectionHeading({
      eyebrow,
      title,
      copy: ''
    })}

    <table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      border="0"
      style="margin-top:12px;"
    >
      <tr>
        ${
          beforeUrl
            ? `
              <td
                width="${afterUrl ? '50%' : '100%'}"
                valign="top"
                style="padding:${afterUrl ? '0 6px 0 0' : '0'};"
              >
                <div
                  style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;font-weight:700;color:#777777;margin:0 0 6px 0;"
                >BEFORE</div>

                ${img(
                  beforeUrl,
                  businessName
                    ? `${businessName} current website`
                    : 'Current website',
                  270,
                  320,
                  'width:100%;border-radius:10px;border:1px solid #DDDDDD;'
                )}
              </td>
            `
            : ''
        }

        ${
          afterUrl
            ? `
              <td
                width="${beforeUrl ? '50%' : '100%'}"
                valign="top"
                style="padding:${beforeUrl ? '0 0 0 6px' : '0'};"
              >
                <div
                  style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;font-weight:700;color:${esc(accent)};margin:0 0 6px 0;"
                >REBUILD</div>

                ${
                  mirrorUrl
                    ? `<a href="${esc(mirrorUrl)}" style="display:block;text-decoration:none;">`
                    : ''
                }

                ${img(
                  afterUrl,
                  businessName
                    ? `${businessName} rebuilt website`
                    : 'Rebuilt website',
                  270,
                  320,
                  'width:100%;border-radius:10px;border:1px solid #DDDDDD;'
                )}

                ${mirrorUrl ? '</a>' : ''}
              </td>
            `
            : ''
        }
      </tr>
    </table>

    ${
      mirrorUrl
        ? `
          <div style="padding-top:14px;">
            ${button(
              mirrorUrl,
              'Open the rebuild',
              accent,
              accentText
            )}
          </div>
        `
        : ''
    }
  `;
}

/**
 * Render cold-prospect HTML + plain-text email.
 *
 * @param {object} data
 * @returns {{html:string,text:string}}
 */
function renderProspectEmail(data = {}) {
  const unsubscribeUrl = safeUrl(data.unsubscribeUrl);

  if (!unsubscribeUrl) {
    throw new Error(
      'renderProspectEmail: data.unsubscribeUrl is required and must be a valid HTTP(S) URL.'
    );
  }

  const business = data.business || {};
  const assets = data.assets || {};
  const commercial = data.commercialVideo || null;
  const honestMath = data.honestMath || {};

  const name = String(business.name || '').trim();
  const trade = String(business.trade || '').trim();
  const city = String(business.city || '').trim();
  const contactPhoneDisplay = String(data.contactPhoneDisplay || '').trim();

  const accent = safeColor(business.accentColor);
  const accentText = contrastText(accent);

  const logoUrl = safeUrl(business.logoUrl);
  const animatedWUrl = safeUrl(assets.animatedWGifUrl);
  const flagBadgeUrl = safeUrl(assets.flagBadgeUrl);
  const rileyUrl = safeUrl(assets.rileyIllustrationUrl);
  const inboxGraphicUrl = safeUrl(assets.inboxGraphicUrl);
  const mobileMotionGifUrl = safeUrl(assets.mobileMotionGifUrl);

  const beforeUrl = safeUrl(data.beforeShotUrl);
  const afterUrl = safeUrl(data.afterShotUrl);
  const mirrorUrl = safeUrl(data.mirrorUrl);
  const dashboardUrl = safeUrl(data.dashboardShotUrl);

  const commercialPosterUrl = commercial
    ? safeUrl(commercial.posterUrl)
    : '';

  const commercialDownloadUrl = commercial
    ? safeUrl(commercial.downloadUrl)
    : '';

  /*
   * commercialVideo.downloadUrl is the actual video destination in the
   * supplied contract. A poster without a video URL still renders as a
   * static visual, but never receives a play label.
   */
  const videoUrl = commercialDownloadUrl;

  const rawReviews = Array.isArray(data.reviews)
    ? data.reviews
    : [];

  const reviews = rawReviews
    .filter((review) => review && String(review.name || '').trim())
    .map((review) => ({
      name: String(review.name || '').trim(),
      avatarUrl: safeUrl(review.avatarUrl),
      stars: finiteNumber(review.stars),
      text: clampReviewText(review.text),
      source: String(review.source || '').trim().toLowerCase()
    }));

  const leadsPerMonth = finiteNumber(honestMath.leadsPerMonth);
  const costPerLead = finiteNumber(honestMath.costPerLead);

  const hasMath =
    leadsPerMonth !== null ||
    costPerLead !== null;

  const titleName = name || 'Your business';

  const textParts = [];

  function pushText(value) {
    const text = String(value || '').trim();
    if (text) textParts.push(text);
  }

  /* ------------------------------------------------------------------ */
  /* 1. Header                                                          */
  /* ------------------------------------------------------------------ */

  let headerModule = '';

  if (logoUrl || animatedWUrl || name) {
    headerModule = `
      <tr>
        <td style="padding:24px 28px 20px 28px;background:#FFFFFF;">
          <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            border="0"
          >
            <tr>
              <td
                valign="middle"
                align="left"
                style="width:78%;padding:0;"
              >
                ${
                  logoUrl
                    ? img(
                        logoUrl,
                        name ? `${name} logo` : 'Business logo',
                        280,
                        100,
                        'object-fit:contain;object-position:left center;'
                      )
                    : `
                      <div
                        style="font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:36px;font-weight:900;color:#111111;"
                      >${esc(name)}</div>
                    `
                }
              </td>

              <td
                valign="middle"
                align="right"
                style="width:22%;padding:0 0 0 12px;"
              >
                ${
                  animatedWUrl
                    ? img(
                        animatedWUrl,
                        'WSS animated W',
                        64,
                        64,
                        'margin-left:auto;'
                      )
                    : ''
                }
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;

    pushText(titleName);
  }

  /* ------------------------------------------------------------------ */
  /* 2. Hero video square OR before/after fallback                      */
  /* ------------------------------------------------------------------ */

  let heroModule = '';

  if (commercialPosterUrl) {
    heroModule = `
      <tr>
        <td style="padding:0 28px 26px 28px;background:#FFFFFF;">
          <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            border="0"
          >
            <tr>
              <td>
                ${sectionHeading({
                  eyebrow:
                    trade || city
                      ? [trade, city].filter(Boolean).join(' · ')
                      : '',
                  title: 'Your commercial',
                  copy: ''
                })}
              </td>
            </tr>

            <tr>
              <td style="padding-top:12px;">
                ${
                  videoUrl
                    ? `<a href="${esc(videoUrl)}" style="text-decoration:none;display:block;">`
                    : ''
                }

                <table
                  role="presentation"
                  width="100%"
                  cellpadding="0"
                  cellspacing="0"
                  border="0"
                  style="border-collapse:separate;border-spacing:0;"
                >
                  <tr>
                    <td
                      align="center"
                      valign="middle"
                      style="background:#111111;border-radius:12px;overflow:hidden;border:1px solid #E5E5E5;"
                    >
                      ${img(
                        commercialPosterUrl,
                        name
                          ? `${name} commercial video preview`
                          : 'Commercial video preview',
                        560,
                        560,
                        'width:100%;max-width:560px;'
                      )}
                    </td>
                  </tr>

                  ${
                    videoUrl
                      ? `
                        <tr>
                          <td
                            align="center"
                            style="padding-top:12px;"
                          >
                            <span
                              style="display:inline-block;background:${esc(accent)};color:${esc(accentText)};font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;font-weight:800;padding:12px 19px;border-radius:999px;"
                            >▶ Play commercial</span>
                          </td>
                        </tr>
                      `
                      : ''
                  }
                </table>

                ${videoUrl ? '</a>' : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;

    pushText('Your commercial');

    if (videoUrl) {
      pushText(`Play commercial: ${videoUrl}`);
    }
  } else if (beforeUrl || afterUrl) {
    heroModule = `
      <tr>
        <td style="padding:0 28px 26px 28px;background:#FFFFFF;">
          ${beforeAfterBlock({
            beforeUrl,
            afterUrl,
            mirrorUrl,
            businessName: name,
            accent,
            accentText,
            eyebrow:
              trade || city
                ? [trade, city].filter(Boolean).join(' · ')
                : 'Website',
            title: 'A new look at your website'
          })}
        </td>
      </tr>
    `;

    pushText('Website preview');

    if (beforeUrl) {
      pushText(`Before: ${beforeUrl}`);
    }

    if (afterUrl) {
      pushText(`Rebuild screenshot: ${afterUrl}`);
    }

    if (mirrorUrl) {
      pushText(`Open the rebuild: ${mirrorUrl}`);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 3. Before/after comparison                                         */
  /* ------------------------------------------------------------------ */

  let comparisonModule = '';

  /*
   * When a commercial poster owns the hero slot, the before/after block
   * gets its dedicated module here.
   *
   * When no commercial poster exists, beforeAfterBlock already rendered
   * as the hero fallback and is intentionally not repeated.
   */
  if (commercialPosterUrl && (beforeUrl || afterUrl)) {
    comparisonModule = `
      <tr>
        <td style="padding:0 28px 26px 28px;background:#FFFFFF;">
          ${beforeAfterBlock({
            beforeUrl,
            afterUrl,
            mirrorUrl,
            businessName: name,
            accent,
            accentText,
            eyebrow: 'Website',
            title: 'Before and rebuilt'
          })}
        </td>
      </tr>
    `;

    pushText('Before and rebuilt');

    if (beforeUrl) {
      pushText(`Before: ${beforeUrl}`);
    }

    if (afterUrl) {
      pushText(`Rebuild screenshot: ${afterUrl}`);
    }

    if (mirrorUrl) {
      pushText(`Open the rebuild: ${mirrorUrl}`);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 4. Dashboard                                                       */
  /* ------------------------------------------------------------------ */

  let dashboardModule = '';

  if (dashboardUrl) {
    dashboardModule = `
      <tr>
        <td style="padding:0 28px 26px 28px;background:#FFFFFF;">
          ${sectionHeading({
            eyebrow: 'Dashboard',
            title: 'The business side, in one place',
            copy: ''
          })}

          <div style="padding-top:12px;">
            ${
              mirrorUrl
                ? `<a href="${esc(mirrorUrl)}" style="display:block;text-decoration:none;">`
                : ''
            }

            ${img(
              dashboardUrl,
              name
                ? `${name} dashboard preview`
                : 'Dashboard preview',
              560,
              350,
              'width:100%;border-radius:12px;border:1px solid #DDDDDD;'
            )}

            ${mirrorUrl ? '</a>' : ''}
          </div>
        </td>
      </tr>
    `;

    pushText('Dashboard preview');
  }

  /* ------------------------------------------------------------------ */
  /* 5. Reviews                                                         */
  /* ------------------------------------------------------------------ */

  let reviewsModule = '';

  if (reviews.length) {
    const reviewRows = reviews
      .map((review) => {
        const reviewInitials = initials(review.name);
        const stars = starString(review.stars);
        const isGoogle = review.source === 'google';

        return `
          <tr>
            <td style="padding:14px 0;border-top:1px solid #E9E9E9;">
              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
              >
                <tr>
                  <td
                    width="48"
                    valign="top"
                    style="padding:0 12px 0 0;"
                  >
                    ${
                      review.avatarUrl
                        ? img(
                            review.avatarUrl,
                            `${review.name} reviewer avatar`,
                            42,
                            42,
                            'border-radius:21px;object-fit:cover;'
                          )
                        : `
                          <table
                            role="presentation"
                            width="42"
                            cellpadding="0"
                            cellspacing="0"
                            border="0"
                          >
                            <tr>
                              <td
                                width="42"
                                height="42"
                                align="center"
                                valign="middle"
                                style="width:42px;height:42px;border-radius:21px;background:#EFEFEF;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;line-height:42px;color:#333333;"
                              >${esc(reviewInitials)}</td>
                            </tr>
                          </table>
                        `
                    }
                  </td>

                  <td valign="top">
                    <table
                      role="presentation"
                      width="100%"
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                    >
                      <tr>
                        <td valign="middle">
                          <span
                            style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:800;color:#111111;"
                          >${esc(review.name)}</span>

                          ${
                            isGoogle
                              ? `
                                <span
                                  aria-label="Google review"
                                  style="display:inline-block;margin-left:7px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;font-weight:900;color:#4285F4;"
                                >G</span>
                              `
                              : ''
                          }
                        </td>
                      </tr>

                      ${
                        stars
                          ? `
                            <tr>
                              <td
                                style="padding-top:2px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;color:#F4B400;letter-spacing:1px;"
                              >${esc(stars)}</td>
                            </tr>
                          `
                          : ''
                      }

                      ${
                        review.text
                          ? `
                            <tr>
                              <td
                                style="padding-top:5px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#444444;"
                              >${esc(review.text)}</td>
                            </tr>
                          `
                          : ''
                      }
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        `;
      })
      .join('');

    reviewsModule = `
      <tr>
        <td style="padding:0 28px 26px 28px;background:#FFFFFF;">
          ${sectionHeading({
            eyebrow: 'Reviews',
            title: 'Your customers, in their own words',
            copy: ''
          })}

          <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            border="0"
            style="margin-top:8px;"
          >
            ${reviewRows}
          </table>
        </td>
      </tr>
    `;

    pushText('Customer reviews');

    for (const review of reviews) {
      const reviewText = [
        review.name,
        starString(review.stars),
        review.source === 'google' ? 'Google' : '',
        review.text
      ]
        .filter(Boolean)
        .join(' — ');

      pushText(reviewText);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 6. Riley                                                           */
  /* ------------------------------------------------------------------ */

  let rileyModule = '';

  /*
   * Riley exists only when the mirror chat destination exists.
   * Illustration is optional decoration and never controls module presence.
   */
  if (mirrorUrl) {
    rileyModule = `
      <tr>
        <td style="padding:0 28px 26px 28px;background:#FFFFFF;">
          <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            border="0"
            bgcolor="#F6FAFF"
            style="background:#F6FAFF;border:1px solid #DCE9F7;border-radius:12px;"
          >
            <tr>
              ${
                rileyUrl
                  ? `
                    <td
                      width="150"
                      valign="middle"
                      align="center"
                      style="padding:18px 10px 18px 18px;"
                    >
                      ${img(
                        rileyUrl,
                        'Riley assistant illustration',
                        120,
                        120,
                        'margin:0 auto;'
                      )}
                    </td>
                  `
                  : ''
              }

              <td
                valign="middle"
                style="padding:${rileyUrl ? '18px 18px 18px 8px' : '20px'};"
              >
                <div
                  style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:27px;font-weight:800;color:#111111;margin:0 0 7px 0;"
                >Meet Riley</div>

                <div style="padding-top:7px;">
                  ${button(
                    mirrorUrl,
                    'Chat with Riley',
                    accent,
                    accentText
                  )}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;

    pushText('Meet Riley');
    pushText(`Chat with Riley: ${mirrorUrl}`);
  }

  /* ------------------------------------------------------------------ */
  /* 7. Honest math                                                     */
  /* ------------------------------------------------------------------ */

  let mathModule = '';

  if (hasMath) {
    const leadCell =
      leadsPerMonth !== null
        ? `
          <td
            width="${costPerLead !== null ? '50%' : '100%'}"
            valign="top"
            style="padding:${costPerLead !== null ? '0 8px 0 0' : '0'};"
          >
            <table
              role="presentation"
              width="100%"
              cellpadding="0"
              cellspacing="0"
              border="0"
            >
              <tr>
                ${
                  inboxGraphicUrl
                    ? `
                      <td
                        width="54"
                        valign="middle"
                        style="padding:0 12px 0 0;"
                      >
                        ${img(
                          inboxGraphicUrl,
                          'Lead volume icon',
                          44,
                          44
                        )}
                      </td>
                    `
                    : ''
                }

                <td valign="middle">
                  <div
                    style="font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:28px;font-weight:900;color:#111111;"
                  >${esc(formatNumber(leadsPerMonth))}</div>

                  <div
                    style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:17px;font-weight:700;color:#666666;text-transform:uppercase;letter-spacing:.7px;"
                  >Leads / month</div>
                </td>
              </tr>
            </table>
          </td>
        `
        : '';

    const costIconUrl =
      mobileMotionGifUrl ||
      inboxGraphicUrl;

    const costCell =
      costPerLead !== null
        ? `
          <td
            width="${leadsPerMonth !== null ? '50%' : '100%'}"
            valign="top"
            style="padding:${leadsPerMonth !== null ? '0 0 0 8px' : '0'};"
          >
            <table
              role="presentation"
              width="100%"
              cellpadding="0"
              cellspacing="0"
              border="0"
            >
              <tr>
                ${
                  costIconUrl
                    ? `
                      <td
                        width="54"
                        valign="middle"
                        style="padding:0 12px 0 0;"
                      >
                        ${img(
                          costIconUrl,
                          'Cost per lead icon',
                          44,
                          44
                        )}
                      </td>
                    `
                    : ''
                }

                <td valign="middle">
                  <div
                    style="font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:28px;font-weight:900;color:#111111;"
                  >${esc(formatMoney(costPerLead))}</div>

                  <div
                    style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:17px;font-weight:700;color:#666666;text-transform:uppercase;letter-spacing:.7px;"
                  >Cost / lead</div>
                </td>
              </tr>
            </table>
          </td>
        `
        : '';

    mathModule = `
      <tr>
        <td style="padding:0 28px 26px 28px;background:#FFFFFF;">
          <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            border="0"
            bgcolor="#FFF7E7"
            style="background:#FFF7E7;border:1px solid #F1D796;border-radius:12px;"
          >
            <tr>
              <td style="padding:17px 18px;">
                <div
                  style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:17px;font-weight:800;color:#735400;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;"
                >Honest math</div>

                <table
                  role="presentation"
                  width="100%"
                  cellpadding="0"
                  cellspacing="0"
                  border="0"
                >
                  <tr>
                    ${leadCell}
                    ${costCell}
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;

    pushText('Honest math');

    if (leadsPerMonth !== null) {
      pushText(`Leads per month: ${formatNumber(leadsPerMonth)}`);
    }

    if (costPerLead !== null) {
      pushText(`Cost per lead: ${formatMoney(costPerLead)}`);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 8. Gift footer                                                     */
  /* ------------------------------------------------------------------ */

  let giftModule = '';

  if (commercialDownloadUrl) {
    const giftButtonBackground =
      accentText === '#FFFFFF'
        ? '#FFFFFF'
        : '#111111';

    const giftButtonText =
      accentText === '#FFFFFF'
        ? '#111111'
        : '#FFFFFF';

    giftModule = `
      <tr>
        <td style="padding:0 28px 26px 28px;background:#FFFFFF;">
          <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            border="0"
            bgcolor="${esc(accent)}"
            style="background:${esc(accent)};border-radius:12px;"
          >
            <tr>
              <td style="padding:22px;">
                <div
                  style="font-family:Arial,Helvetica,sans-serif;font-size:23px;line-height:29px;font-weight:900;color:${esc(accentText)};margin:0 0 12px 0;"
                >Our gift to you - download your commercial</div>

                ${button(
                  commercialDownloadUrl,
                  'Download your commercial',
                  giftButtonBackground,
                  giftButtonText
                )}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;

    pushText('Our gift to you - download your commercial');
    pushText(commercialDownloadUrl);
  }

  /* ------------------------------------------------------------------ */
  /* 9. Footer                                                          */
  /* ------------------------------------------------------------------ */

  const footerModule = `
    <tr>
      <td style="padding:22px 28px 30px 28px;background:#111111;">
        <table
          role="presentation"
          width="100%"
          cellpadding="0"
          cellspacing="0"
          border="0"
        >
          <tr>
            <td valign="middle">
              <div
                style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#FFFFFF;"
              >
                <a
                  href="mailto:${esc(WSS_EMAIL)}"
                  style="color:#FFFFFF;text-decoration:none;font-weight:700;"
                >${esc(WSS_EMAIL)}</a>
              </div>

              ${
                contactPhoneDisplay
                  ? `
                    <div
                      style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#CFCFCF;"
                    >${esc(contactPhoneDisplay)}</div>
                  `
                  : ''
              }
            </td>

            ${
              flagBadgeUrl
                ? `
                  <td
                    width="84"
                    valign="middle"
                    align="right"
                    style="padding-left:14px;"
                  >
                    ${img(
                      flagBadgeUrl,
                      'USA badge',
                      72,
                      36,
                      'margin-left:auto;'
                    )}
                  </td>
                `
                : ''
            }
          </tr>

          <tr>
            <td
              colspan="2"
              style="padding-top:15px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#8F8F8F;"
            >
              <a
                href="${esc(unsubscribeUrl)}"
                style="color:#BDBDBD;text-decoration:underline;"
              >Unsubscribe</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;

  pushText(WSS_EMAIL);

  if (contactPhoneDisplay) {
    pushText(contactPhoneDisplay);
  }

  pushText(`Unsubscribe: ${unsubscribeUrl}`);

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width,initial-scale=1"
  >
  <meta
    name="x-apple-disable-message-reformatting"
  >
  <title>${esc(name || 'Website preview')}</title>
</head>

<body style="margin:0;padding:0;background:#ECECEC;">
  <table
    role="presentation"
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    bgcolor="#ECECEC"
    style="width:100%;margin:0;padding:0;background:#ECECEC;border-collapse:collapse;"
  >
    <tr>
      <td
        align="center"
        style="padding:24px 10px;"
      >
        <table
          role="presentation"
          width="620"
          cellpadding="0"
          cellspacing="0"
          border="0"
          style="width:620px;max-width:100%;background:#FFFFFF;border-collapse:separate;border-spacing:0;border-radius:14px;overflow:hidden;"
        >
          ${headerModule}
          ${heroModule}
          ${comparisonModule}
          ${dashboardModule}
          ${reviewsModule}
          ${rileyModule}
          ${mathModule}
          ${giftModule}
          ${footerModule}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    html,
    text: textParts.join('\n\n')
  };
}

module.exports = {
  renderProspectEmail
};
