// onboarding-emails.cjs
'use strict';

/*
SHARED CONTRACT (embed exactly): email renderers are Node 20 CJS exporting render(data)->{html,text}; table-based inline-styled HTML, Gmail-web+iOS safe, https images only with width/height/alt, render ONLY supplied data (skip absent modules cleanly), throw without data.unsubscribeUrl, footer contact hello@wss-ai.com, accent from data.business.accentColor with dark-text fallback. business={name,trade,city,accentColor,logoUrl}. Never invent claims, reviews, numbers, or names.
*/

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ACCENT = '#1a73e8';
const DARK_TEXT = '#202124';
const MUTED_TEXT = '#5f6368';
const BORDER = '#dadce0';
const PAGE_BG = '#f5f7f9';
const WHITE = '#ffffff';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeText(value) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
}

function safeUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return '';

  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function safeColor(value) {
  const color = normalizeText(value);
  if (!color) return DEFAULT_ACCENT;

  if (/^#[0-9a-f]{3}$/i.test(color)) return color;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{8}$/i.test(color)) return color;

  return DEFAULT_ACCENT;
}

function colorToRgb(color) {
  let hex = color.replace('#', '');

  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }

  if (hex.length === 8) {
    hex = hex.slice(0, 6);
  }

  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    return { r: 26, g: 115, b: 232 };
  }

  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function srgbChannel(value) {
  const channel = value / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function luminance(color) {
  const { r, g, b } = colorToRgb(color);
  return (
    0.2126 * srgbChannel(r) +
    0.7152 * srgbChannel(g) +
    0.0722 * srgbChannel(b)
  );
}

function accentTextColor(accent) {
  const lum = luminance(accent);
  const whiteContrast = 1.05 / (lum + 0.05);
  const darkLum = luminance(DARK_TEXT);
  const darkContrast =
    Math.max(lum, darkLum) + 0.05
      ? (Math.max(lum, darkLum) + 0.05) /
        (Math.min(lum, darkLum) + 0.05)
      : 1;

  return darkContrast >= whiteContrast ? DARK_TEXT : WHITE;
}

function businessMeta(business) {
  const parts = [
    normalizeText(business?.trade),
    normalizeText(business?.city),
  ].filter(Boolean);

  return parts.join(' · ');
}

function renderLogo(business) {
  const logoUrl = safeUrl(business?.logoUrl);
  if (!logoUrl) return '';

  const name = normalizeText(business?.name);
  const alt = name ? `${name} logo` : 'Business logo';

  return `
    <tr>
      <td style="padding:0 0 18px 0;">
        <img
          src="${esc(logoUrl)}"
          width="120"
          height="40"
          alt="${esc(alt)}"
          style="display:block;width:120px;height:40px;max-width:120px;object-fit:contain;border:0;outline:none;text-decoration:none;"
        >
      </td>
    </tr>`;
}

function button(label, url, accent, accentText) {
  const href = safeUrl(url);
  if (!href) return '';

  return `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0 8px 0;">
      <tr>
        <td bgcolor="${esc(accent)}" style="border-radius:8px;background:${esc(accent)};">
          <a href="${esc(href)}"
             style="display:inline-block;padding:14px 20px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;font-weight:700;color:${esc(accentText)};text-decoration:none;border-radius:8px;">
            ${esc(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

function paragraph(content) {
  if (!content) return '';

  return `
    <tr>
      <td style="padding:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:${DARK_TEXT};">
        ${content}
      </td>
    </tr>`;
}

function heading(content) {
  if (!content) return '';

  return `
    <tr>
      <td style="padding:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:32px;font-weight:700;color:${DARK_TEXT};">
        ${content}
      </td>
    </tr>`;
}

function buildShell({
  data,
  subject,
  headingHtml,
  bodyHtml,
  textBody,
}) {
  const business = data.business || {};
  const accent = safeColor(business.accentColor);
  const accentText = accentTextColor(accent);
  const unsubscribeUrl = safeUrl(data.unsubscribeUrl);

  if (!unsubscribeUrl) {
    throw new Error(
      'data.unsubscribeUrl is required and must be a valid https URL'
    );
  }

  const name = normalizeText(business.name);
  const meta = businessMeta(business);

  const brandHeader =
    name || meta
      ? `
        <tr>
          <td style="padding:0 0 20px 0;">
            ${
              name
                ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:24px;font-weight:700;color:${DARK_TEXT};">${esc(name)}</div>`
                : ''
            }
            ${
              meta
                ? `<div style="padding-top:2px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:${MUTED_TEXT};">${esc(meta)}</div>`
                : ''
            }
          </td>
        </tr>`
      : '';

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:${PAGE_BG};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:collapse;background:${WHITE};border:1px solid ${BORDER};border-radius:12px;">
          <tr>
            <td style="padding:28px 24px 8px 24px;">
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
                ${renderLogo(business)}
                ${brandHeader}
                ${heading(headingHtml)}
                ${bodyHtml(accent, accentText)}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 24px 26px 24px;border-top:1px solid ${BORDER};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${MUTED_TEXT};">
              <div>hello@wss-ai.com</div>
              <div style="padding-top:8px;">
                <a href="${esc(unsubscribeUrl)}" style="color:${MUTED_TEXT};text-decoration:underline;">Unsubscribe</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const footerText = [
    'hello@wss-ai.com',
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join('\n');

  return {
    html,
    text: `${textBody.trim()}\n\n${footerText}`,
    subject,
  };
}

function greeting(data) {
  const customerName = normalizeText(data.customerName);
  return customerName ? `Hi ${customerName},` : 'Hi,';
}

function welcomeEmail(data) {
  const mirrorUrl = safeUrl(data.mirrorUrl);
  const dashboardUrl = safeUrl(data.dashboardUrl);
  const phone = normalizeText(data.contactPhoneDisplay);
  const businessName = normalizeText(data.business?.name);
  const greet = greeting(data);

  const subject = businessName
    ? `Your ${businessName} site is live`
    : 'Your new site is live';

  const title = businessName
    ? `${esc(businessName)} is live`
    : 'Your new site is live';

  const text = [
    greet,
    '',
    'Thanks for getting started with us.',
    mirrorUrl ? `Your live site: ${mirrorUrl}` : '',
    '',
    'Next, we’ll help you get your domain connected and handle the site changes you send our way.',
    '',
    'You can also meet Riley, your assistant. Riley can help with site edits and questions.',
    mirrorUrl ? `Chat with Riley: ${mirrorUrl}` : '',
    dashboardUrl ? `Dashboard: ${dashboardUrl}` : '',
    phone ? `Our phone: ${phone}` : '',
  ]
    .filter((line, index, arr) => {
      if (line !== '') return true;
      return index > 0 && arr[index - 1] !== '';
    })
    .join('\n')
    .trim();

  return buildShell({
    data,
    subject,
    headingHtml: title,
    textBody: text,
    bodyHtml: (accent, accentText) => `
      ${paragraph(esc(greet))}
      ${paragraph('Thanks for getting started with us.')}
      ${
        mirrorUrl
          ? `<tr><td>${button('Open your live site', mirrorUrl, accent, accentText)}</td></tr>`
          : ''
      }
      ${paragraph(
        'Next, we’ll help you get your domain connected and handle the site changes you send our way.'
      )}
      ${paragraph(
        'You can also meet <strong>Riley</strong>, your assistant. Riley can help with site edits and questions.'
      )}
      ${
        mirrorUrl
          ? `<tr><td>${button('Chat with Riley', mirrorUrl, accent, accentText)}</td></tr>`
          : ''
      }
      ${
        dashboardUrl
          ? `<tr><td>${button('Open your dashboard', dashboardUrl, accent, accentText)}</td></tr>`
          : ''
      }
      ${
        phone
          ? paragraph(
              `Our phone: <strong>${esc(phone)}</strong>`
            )
          : ''
      }`,
  });
}

function domainEmail(data) {
  const businessName = normalizeText(data.business?.name);
  const greet = greeting(data);

  const subject = businessName
    ? `Next step for ${businessName}: your domain`
    : 'Next step: your domain';

  const text = [
    greet,
    '',
    'Your next step is connecting your own domain.',
    '',
    'We handle the connection work. Just reply with the domain name you want to use.',
    '',
    'Your registrar login stays yours. Depending on the registrar, we may send you the exact DNS change needed or walk you through it.',
  ].join('\n');

  return buildShell({
    data,
    subject,
    headingHtml: 'Let’s connect your domain',
    textBody: text,
    bodyHtml: () => `
      ${paragraph(esc(greet))}
      ${paragraph('Your next step is connecting your own domain.')}
      ${paragraph(
        '<strong>We handle the connection work.</strong> Just reply with the domain name you want to use.'
      )}
      ${paragraph(
        'Your registrar login stays yours. Depending on the registrar, we may send you the exact DNS change needed or walk you through it.'
      )}`,
  });
}

function firstEditEmail(data) {
  const mirrorUrl = safeUrl(data.mirrorUrl);
  const businessName = normalizeText(data.business?.name);
  const greet = greeting(data);

  const subject = businessName
    ? `Want to make your first ${businessName} edit?`
    : 'Want to make your first site edit?';

  const text = [
    greet,
    '',
    'Now that your site is up, try your first free edit.',
    '',
    'Tell us what you want changed by replying to this email or sending it to Riley.',
    mirrorUrl ? `Chat with Riley: ${mirrorUrl}` : '',
    '',
    'Edits land within a day.',
  ]
    .filter((line, index, arr) => {
      if (line !== '') return true;
      return index > 0 && arr[index - 1] !== '';
    })
    .join('\n')
    .trim();

  return buildShell({
    data,
    subject,
    headingHtml: 'Try your first edit',
    textBody: text,
    bodyHtml: (accent, accentText) => `
      ${paragraph(esc(greet))}
      ${paragraph('Now that your site is up, try your first free edit.')}
      ${paragraph(
        'Tell us what you want changed by replying to this email or sending it to Riley.'
      )}
      ${
        mirrorUrl
          ? `<tr><td>${button('Ask Riley for an edit', mirrorUrl, accent, accentText)}</td></tr>`
          : ''
      }
      ${paragraph('<strong>Edits land within a day.</strong>')}`,
  });
}

function renderOnboarding(step, data) {
  if (!data || typeof data !== 'object') {
    throw new TypeError('data must be an object');
  }

  if (!data.unsubscribeUrl) {
    throw new Error('data.unsubscribeUrl is required');
  }

  switch (step) {
    case 1:
    case 'welcome':
      return welcomeEmail(data);

    case 2:
    case 'domain':
      return domainEmail(data);

    case 3:
    case 'first-edit':
      return firstEditEmail(data);

    default:
      throw new Error(
        "Unknown onboarding step. Use 1/'welcome', 2/'domain', or 3/'first-edit'."
      );
  }
}

function render(data) {
  const step = data && data.step;
  return renderOnboarding(step, data);
}

function main() {
  const sample = {
    customerName: 'Sam',
    mirrorUrl: 'https://example.com/',
    dashboardUrl: 'https://example.com/dashboard',
    contactPhoneDisplay: '(555) 010-0200',
    unsubscribeUrl: 'https://example.com/unsubscribe',
    business: {
      name: 'Sample Service Co.',
      trade: 'Plumbing',
      city: 'Sample City',
      accentColor: '#1a73e8',
      logoUrl: 'https://example.com/logo.png',
    },
  };

  const outputs = [
    ['onboarding-1-welcome.html', renderOnboarding('welcome', sample)],
    ['onboarding-2-domain.html', renderOnboarding('domain', sample)],
    ['onboarding-3-first-edit.html', renderOnboarding('first-edit', sample)],
  ];

  for (const [filename, rendered] of outputs) {
    fs.writeFileSync(
      path.join(process.cwd(), filename),
      rendered.html,
      'utf8'
    );
  }
}

module.exports = {
  render,
  renderOnboarding,
};

if (require.main === module) {
  main();
}
