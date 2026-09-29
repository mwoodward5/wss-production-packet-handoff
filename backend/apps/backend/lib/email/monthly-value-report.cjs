// monthly-report-email.cjs
'use strict';

/*
SHARED CONTRACT (embed exactly): email renderers are Node 20 CJS exporting render(data)->{html,text}; table-based inline-styled HTML, Gmail-web+iOS safe, https images only with width/height/alt, render ONLY supplied data (skip absent modules cleanly), throw without data.unsubscribeUrl, footer contact hello@wss-ai.com, accent from data.business.accentColor with dark-text fallback. business={name,trade,city,accentColor,logoUrl}. Never invent claims, reviews, numbers, or names.
*/

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function safeHttpsUrl(value) {
  const raw = cleanText(value);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeAccent(value) {
  const raw = cleanText(value);

  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();

  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return (
      '#' +
      raw
        .slice(1)
        .split('')
        .map((char) => char + char)
        .join('')
        .toLowerCase()
    );
  }

  return '#1a73e8';
}

function contrastTextForAccent(hex) {
  const normalized = normalizeAccent(hex).slice(1);
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);

  function linearize(channel) {
    const c = channel / 255;
    return c <= 0.03928
      ? c / 12.92
      : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  const luminance =
    0.2126 * linearize(r) +
    0.7152 * linearize(g) +
    0.0722 * linearize(b);

  // Dark-text fallback for bright accent colors.
  return luminance > 0.45 ? '#202124' : '#ffffff';
}

function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0
  }).format(value);
}

function formatMonth(value) {
  const raw = cleanText(value);
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!match) return raw || null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;

  if (monthIndex < 0 || monthIndex > 11) return raw;

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, monthIndex, 1)));
}

function statInsight(key, value) {
  if (value === 0) {
    switch (key) {
      case 'siteVisits':
        return 'No site visits were recorded this month.';
      case 'leads':
        return 'No new leads were recorded this month.';
      case 'rileyCalls':
        return 'Riley handled no calls this month.';
      case 'reviewsNew':
        return 'Quiet month for reviews — want us to ask happy customers? Reply and Riley sets it up.';
      case 'editsMade':
        return 'No site edits were made this month.';
      default:
        return null;
    }
  }

  switch (key) {
    case 'siteVisits':
      return value === 1
        ? '1 visit was recorded this month.'
        : `${formatNumber(value)} visits were recorded this month.`;

    case 'leads':
      return value === 1
        ? '1 new lead came through this month.'
        : `${formatNumber(value)} new leads came through this month.`;

    case 'rileyCalls':
      return value === 1
        ? 'Riley handled 1 call this month.'
        : `Riley handled ${formatNumber(value)} calls this month.`;

    case 'reviewsNew':
      return value === 1
        ? '1 new review was recorded this month.'
        : `${formatNumber(value)} new reviews were recorded this month.`;

    case 'editsMade':
      return value === 1
        ? '1 site edit was completed this month.'
        : `${formatNumber(value)} site edits were completed this month.`;

    default:
      return null;
  }
}

const STAT_DEFS = {
  siteVisits: {
    label: 'Site visits'
  },
  leads: {
    label: 'New leads'
  },
  rileyCalls: {
    label: 'Riley calls'
  },
  reviewsNew: {
    label: 'New reviews'
  },
  editsMade: {
    label: 'Site edits'
  }
};

function suppliedStats(stats) {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
    return [];
  }

  return Object.keys(STAT_DEFS)
    .filter(
      (key) =>
        Object.prototype.hasOwnProperty.call(stats, key) &&
        typeof stats[key] === 'number' &&
        Number.isFinite(stats[key])
    )
    .map((key) => ({
      key,
      label: STAT_DEFS[key].label,
      value: stats[key],
      formatted: formatNumber(stats[key]),
      insight: statInsight(key, stats[key])
    }));
}

function renderStatsHtml(stats, accent, accentText) {
  if (!stats.length) return '';

  return stats
    .map(
      (stat) => `
        <tr>
          <td style="padding:0 0 10px 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
              style="width:100%;border-collapse:collapse;background:#f8f9fa;border:1px solid #e8eaed;border-radius:10px;">
              <tr>
                <td width="110" valign="middle"
                  style="width:110px;padding:14px 12px;text-align:center;background:${accent};color:${accentText};border-radius:10px 0 0 10px;">
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:34px;font-weight:700;">
                    ${escapeHtml(stat.formatted)}
                  </div>
                </td>
                <td valign="middle" style="padding:12px 14px;">
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:700;color:#202124;">
                    ${escapeHtml(stat.label)}
                  </div>
                  ${
                    stat.insight
                      ? `<div style="padding-top:3px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#5f6368;">
                          ${escapeHtml(stat.insight)}
                        </div>`
                      : ''
                  }
                </td>
              </tr>
            </table>
          </td>
        </tr>`
    )
    .join('');
}

function renderLeadsHtml(leads) {
  if (!Array.isArray(leads) || !leads.length) return '';

  const rows = leads.slice(0, 8).map((lead) => {
    if (!lead || typeof lead !== 'object') return '';

    const name = cleanText(lead.name);
    const phone = cleanText(lead.phone);
    const source = cleanText(lead.source);

    if (!name && !phone && !source) return '';

    const details = [phone, source].filter(Boolean).join(' · ');

    return `
      <tr>
        <td style="padding:9px 0;border-top:1px solid #e8eaed;">
          ${
            name
              ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:19px;font-weight:700;color:#202124;">
                  ${escapeHtml(name)}
                </div>`
              : ''
          }
          ${
            details
              ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#5f6368;">
                  ${escapeHtml(details)}
                </div>`
              : ''
          }
        </td>
      </tr>`;
  }).filter(Boolean);

  if (!rows.length) return '';

  return `
    <tr>
      <td style="padding:6px 0 18px 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:0 0 7px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:700;color:#202124;">
              Leads this month
            </td>
          </tr>
          ${rows.join('')}
        </table>
      </td>
    </tr>`;
}

function renderLeadsText(leads) {
  if (!Array.isArray(leads) || !leads.length) return '';

  const lines = leads.slice(0, 8).map((lead) => {
    if (!lead || typeof lead !== 'object') return null;

    const parts = [
      cleanText(lead.name),
      cleanText(lead.phone),
      cleanText(lead.source)
    ].filter(Boolean);

    return parts.length ? `- ${parts.join(' | ')}` : null;
  }).filter(Boolean);

  if (!lines.length) return '';

  return `\nLEADS THIS MONTH\n${lines.join('\n')}\n`;
}

function renderMonthlyReport(data) {
  if (!data || typeof data !== 'object') {
    throw new TypeError('data is required');
  }

  const unsubscribeUrl = safeHttpsUrl(data.unsubscribeUrl);
  if (!unsubscribeUrl) {
    throw new Error('data.unsubscribeUrl is required and must be a valid https URL');
  }

  const business =
    data.business && typeof data.business === 'object'
      ? data.business
      : {};

  const businessName = cleanText(business.name);
  const trade = cleanText(business.trade);
  const city = cleanText(business.city);
  const accent = normalizeAccent(business.accentColor);
  const accentText = contrastTextForAccent(accent);
  const logoUrl = safeHttpsUrl(business.logoUrl);
  const dashboardUrl = safeHttpsUrl(data.dashboardUrl);
  const month = formatMonth(data.month);
  const stats = suppliedStats(data.stats);

  const subjectParts = [];
  if (month) subjectParts.push(month);
  subjectParts.push('website report');
  if (businessName) subjectParts.push(businessName);

  const subject = subjectParts.join(' — ');

  const businessMeta = [trade, city].filter(Boolean).join(' · ');

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f3f4;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
    style="width:100%;border-collapse:collapse;background:#f1f3f4;">
    <tr>
      <td align="center" style="padding:18px 10px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="width:100%;max-width:600px;border-collapse:collapse;background:#ffffff;border-radius:14px;">
          <tr>
            <td style="padding:22px 22px 8px 22px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                style="width:100%;border-collapse:collapse;">
                <tr>
                  ${
                    logoUrl
                      ? `<td width="58" valign="middle" style="width:58px;padding-right:12px;">
                          <img src="${escapeHtml(logoUrl)}" width="48" height="48" alt="${escapeHtml(
                            businessName ? `${businessName} logo` : 'Business logo'
                          )}" style="display:block;width:48px;height:48px;border:0;object-fit:contain;">
                        </td>`
                      : ''
                  }
                  <td valign="middle">
                    ${
                      businessName
                        ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:23px;font-weight:700;color:#202124;">
                            ${escapeHtml(businessName)}
                          </div>`
                        : ''
                    }
                    ${
                      businessMeta
                        ? `<div style="padding-top:2px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#5f6368;">
                            ${escapeHtml(businessMeta)}
                          </div>`
                        : ''
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:10px 22px 16px 22px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:30px;font-weight:700;color:#202124;">
                ${month ? `${escapeHtml(month)} report` : 'Your monthly website report'}
              </div>
              <div style="padding-top:5px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#5f6368;">
                Here’s what your site did this month.
              </div>
            </td>
          </tr>

          ${
            stats.length
              ? `<tr>
                  <td style="padding:0 22px 8px 22px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                      style="width:100%;border-collapse:collapse;">
                      ${renderStatsHtml(stats, accent, accentText)}
                    </table>
                  </td>
                </tr>`
              : ''
          }

          ${
            Array.isArray(data.leads) && data.leads.length
              ? `<tr>
                  <td style="padding:0 22px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                      style="width:100%;border-collapse:collapse;">
                      ${renderLeadsHtml(data.leads)}
                    </table>
                  </td>
                </tr>`
              : ''
          }

          ${
            dashboardUrl
              ? `<tr>
                  <td align="center" style="padding:0 22px 22px 22px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0"
                      style="border-collapse:collapse;">
                      <tr>
                        <td align="center" bgcolor="${accent}" style="border-radius:8px;">
                          <a href="${escapeHtml(dashboardUrl)}"
                            style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:18px;font-weight:700;color:${accentText};text-decoration:none;">
                            Open your dashboard
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`
              : ''
          }

          <tr>
            <td style="padding:16px 22px 20px 22px;border-top:1px solid #e8eaed;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#80868b;text-align:center;">
                WSS ·
                <a href="mailto:hello@wss-ai.com" style="color:#5f6368;text-decoration:underline;">hello@wss-ai.com</a>
                ·
                <a href="${escapeHtml(unsubscribeUrl)}" style="color:#5f6368;text-decoration:underline;">Unsubscribe</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textLines = [];

  if (businessName) textLines.push(businessName);
  if (businessMeta) textLines.push(businessMeta);

  if (month) {
    textLines.push(`${month} report`);
  } else {
    textLines.push('Your monthly website report');
  }

  textLines.push("Here's what your site did this month.");

  if (stats.length) {
    textLines.push('');
    for (const stat of stats) {
      textLines.push(`${stat.label}: ${stat.formatted}`);
      if (stat.insight) textLines.push(stat.insight);
    }
  }

  const leadsText = renderLeadsText(data.leads);
  if (leadsText) textLines.push(leadsText.trim());

  if (dashboardUrl) {
    textLines.push('');
    textLines.push(`Open your dashboard: ${dashboardUrl}`);
  }

  textLines.push('');
  textLines.push('WSS');
  textLines.push('hello@wss-ai.com');
  textLines.push(`Unsubscribe: ${unsubscribeUrl}`);

  return {
    html,
    text: textLines.join('\n'),
    subject
  };
}

function main() {
  const demoData = {
    business: {
      name: 'Demo Plumbing Co.',
      trade: 'Plumbing',
      city: 'Demo City',
      accentColor: '#1a73e8',
      logoUrl: 'https://example.com/logo.png'
    },
    month: '2026-08',
    stats: {
      siteVisits: 184,
      leads: 7,
      rileyCalls: 12,
      reviewsNew: 0,
      editsMade: 3
    },
    leads: [
      {
        name: 'Demo Lead',
        phone: '(555) 010-1000',
        source: 'Website'
      }
    ],
    dashboardUrl: 'https://example.com/dashboard',
    unsubscribeUrl: 'https://example.com/unsubscribe'
  };

  const result = renderMonthlyReport(demoData);
  process.stdout.write(
    JSON.stringify(
      {
        subject: result.subject,
        text: result.text,
        html: result.html
      },
      null,
      2
    ) + '\n'
  );
}

module.exports = {
  renderMonthlyReport
};

if (require.main === module) {
  main();
}
