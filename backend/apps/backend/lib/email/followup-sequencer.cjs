'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid ${fieldName}`);
  }
  return date;
}

function plan(sentRecord, now = new Date()) {
  if (!sentRecord || typeof sentRecord !== 'object') {
    throw new TypeError('sentRecord is required');
  }

  if (
    sentRecord.repliedAt ||
    sentRecord.bouncedAt ||
    sentRecord.unsubscribedAt
  ) {
    return { due: false, step: null, sendAfter: null };
  }

  const firstSentAt = toDate(sentRecord.firstSentAt, 'firstSentAt');
  const currentTime = toDate(now, 'now');
  const lastStep = Number(sentRecord.lastStep || 1);

  if (lastStep < 2) {
    const sendAfter = new Date(firstSentAt.getTime() + 3 * DAY_MS);
    return {
      due: currentTime.getTime() >= sendAfter.getTime(),
      step: 2,
      sendAfter: sendAfter.toISOString()
    };
  }

  if (lastStep < 3) {
    const sendAfter = new Date(firstSentAt.getTime() + 7 * DAY_MS);
    return {
      due: currentTime.getTime() >= sendAfter.getTime(),
      step: 3,
      sendAfter: sendAfter.toISOString()
    };
  }

  return { due: false, step: null, sendAfter: null };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeUrl(value) {
  if (!value || typeof value !== 'string' || !/^https:\/\//i.test(value)) {
    return null;
  }
  return value;
}

function getAccentColor(data) {
  const color =
    data &&
    data.business &&
    typeof data.business.accentColor === 'string' &&
    data.business.accentColor.trim();

  return color || '#1a1a1a';
}

function getBusinessName(data) {
  return data && data.business && data.business.name
    ? String(data.business.name)
    : '';
}

function footerHtml(data) {
  const unsubscribeUrl = escapeHtml(data.unsubscribeUrl);
  return [
    '<tr>',
    '<td style="padding:16px 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#555555;">',
    'Questions? Contact <a href="mailto:hello@wss-ai.com" style="color:#1a1a1a;text-decoration:underline;">hello@wss-ai.com</a>.<br>',
    `<a href="${unsubscribeUrl}" style="color:#555555;text-decoration:underline;">Unsubscribe</a>`,
    '</td>',
    '</tr>'
  ].join('');
}

function logoHtml(data) {
  const logoUrl = normalizeUrl(data.business && data.business.logoUrl);
  const businessName = escapeHtml(getBusinessName(data));

  if (!logoUrl) return '';

  return [
    '<tr>',
    '<td style="padding:24px 24px 0;">',
    `<img src="${escapeHtml(logoUrl)}" width="160" height="48" alt="${businessName}" style="display:block;width:160px;height:48px;border:0;outline:none;text-decoration:none;object-fit:contain;">`,
    '</td>',
    '</tr>'
  ].join('');
}

function renderFollowup(step, data) {
  if (!data || typeof data !== 'object') {
    throw new TypeError('data is required');
  }

  if (!data.unsubscribeUrl) {
    throw new TypeError('data.unsubscribeUrl is required');
  }

  if (step !== 2 && step !== 3) {
    throw new TypeError('step must be 2 or 3');
  }

  const businessName = getBusinessName(data);
  const safeBusinessName = escapeHtml(businessName);
  const accent = escapeHtml(getAccentColor(data));
  const siteUrl = normalizeUrl(data.siteUrl || data.websiteUrl || data.linkUrl);
  const screenshotUrl = normalizeUrl(data.screenshotUrl);
  const hasCommercialVideo = Boolean(data.commercialVideo);

  const subject =
    step === 2
      ? `Did you see the site for ${businessName}?`
      : `Final note about your ${businessName} site`;

  let bodyHtml = '';
  let bodyText = '';

  if (step === 2) {
    const screenshotBlock =
      screenshotUrl && siteUrl
        ? [
            '<tr>',
            '<td style="padding:0 24px 16px;">',
            `<a href="${escapeHtml(siteUrl)}" style="text-decoration:none;">`,
            `<img src="${escapeHtml(screenshotUrl)}" width="552" height="310" alt="Website preview for ${safeBusinessName}" style="display:block;width:100%;max-width:552px;height:auto;border:0;outline:none;text-decoration:none;">`,
            '</a>',
            '</td>',
            '</tr>'
          ].join('')
        : '';

    const linkHtml = siteUrl
      ? `<a href="${escapeHtml(siteUrl)}" style="color:${accent};text-decoration:underline;">View your site</a>`
      : '';

    bodyHtml = [
      '<tr>',
      '<td style="padding:24px 24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#1a1a1a;">',
      `<p style="margin:0 0 12px;">Just checking whether you saw the site we put together for ${safeBusinessName}.</p>`,
      linkHtml
        ? `<p style="margin:0;">${linkHtml}</p>`
        : '',
      '</td>',
      '</tr>',
      screenshotBlock
    ].join('');

    bodyText = [
      `Just checking whether you saw the site we put together for ${businessName}.`,
      siteUrl ? `View your site: ${siteUrl}` : ''
    ]
      .filter(Boolean)
      .join('\n');
  } else {
    const videoHtml = hasCommercialVideo
      ? '<p style="margin:0 0 12px;">If you want it, we can also include the commercial video with the site.</p>'
      : '';

    const videoText = hasCommercialVideo
      ? 'If you want it, we can also include the commercial video with the site.'
      : '';

    const linkHtml = siteUrl
      ? `<a href="${escapeHtml(siteUrl)}" style="color:${accent};text-decoration:underline;">Grab your site here</a>`
      : '';

    bodyHtml = [
      '<tr>',
      '<td style="padding:24px 24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#1a1a1a;">',
      `<p style="margin:0 0 12px;">One final note about the site we made for ${safeBusinessName}.</p>`,
      '<p style="margin:0 0 12px;">We will keep it up this week, then archive it—grab it any time before then.</p>',
      videoHtml,
      linkHtml ? `<p style="margin:0;">${linkHtml}</p>` : '',
      '</td>',
      '</tr>'
    ].join('');

    bodyText = [
      `One final note about the site we made for ${businessName}.`,
      'We will keep it up this week, then archive it—grab it any time before then.',
      videoText,
      siteUrl ? `Grab your site here: ${siteUrl}` : ''
    ]
      .filter(Boolean)
      .join('\n');
  }

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    '<body style="margin:0;padding:0;background-color:#f5f5f5;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0;padding:0;background-color:#f5f5f5;">',
    '<tr>',
    '<td align="center" style="padding:16px;">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;">',
    logoHtml(data),
    bodyHtml,
    footerHtml(data),
    '</table>',
    '</td>',
    '</tr>',
    '</table>',
    '</body>',
    '</html>'
  ].join('');

  const text = [
    bodyText,
    '',
    'Questions? Contact hello@wss-ai.com.',
    `Unsubscribe: ${data.unsubscribeUrl}`
  ].join('\n');

  return { html, text, subject };
}

module.exports = { plan, renderFollowup };

if (require.main === module) {
  if (process.argv.includes('--test')) {
    const test = require('node:test');
    const assert = require('node:assert/strict');

    const firstSentAt = '2026-01-01T12:00:00.000Z';

    test('step 2 is not due before three days', () => {
      const result = plan(
        { firstSentAt, lastStep: 1, repliedAt: null, bouncedAt: null, unsubscribedAt: null },
        '2026-01-04T11:59:59.999Z'
      );
      assert.deepEqual(result, {
        due: false,
        step: 2,
        sendAfter: '2026-01-04T12:00:00.000Z'
      });
    });

    test('step 2 is due exactly three days after first send', () => {
      const result = plan(
        { firstSentAt, lastStep: 1, repliedAt: null, bouncedAt: null, unsubscribedAt: null },
        '2026-01-04T12:00:00.000Z'
      );
      assert.equal(result.due, true);
      assert.equal(result.step, 2);
    });

    test('step 3 is not due before seven days', () => {
      const result = plan(
        { firstSentAt, lastStep: 2, repliedAt: null, bouncedAt: null, unsubscribedAt: null },
        '2026-01-08T11:59:59.999Z'
      );
      assert.equal(result.due, false);
      assert.equal(result.step, 3);
    });

    test('step 3 is due exactly seven days after first send', () => {
      const result = plan(
        { firstSentAt, lastStep: 2, repliedAt: null, bouncedAt: null, unsubscribedAt: null },
        '2026-01-08T12:00:00.000Z'
      );
      assert.equal(result.due, true);
      assert.equal(result.step, 3);
    });

    test('reply suppresses all follow-ups', () => {
      const result = plan(
        { firstSentAt, lastStep: 1, repliedAt: '2026-01-02T00:00:00.000Z', bouncedAt: null, unsubscribedAt: null },
        '2026-01-10T12:00:00.000Z'
      );
      assert.deepEqual(result, { due: false, step: null, sendAfter: null });
    });

    test('bounce suppresses all follow-ups', () => {
      const result = plan(
        { firstSentAt, lastStep: 1, repliedAt: null, bouncedAt: '2026-01-02T00:00:00.000Z', unsubscribedAt: null },
        '2026-01-10T12:00:00.000Z'
      );
      assert.deepEqual(result, { due: false, step: null, sendAfter: null });
    });

    test('unsubscribe suppresses all follow-ups', () => {
      const result = plan(
        { firstSentAt, lastStep: 1, repliedAt: null, bouncedAt: null, unsubscribedAt: '2026-01-02T00:00:00.000Z' },
        '2026-01-10T12:00:00.000Z'
      );
      assert.deepEqual(result, { due: false, step: null, sendAfter: null });
    });

    test('completed step 3 sequence is never due', () => {
      const result = plan(
        { firstSentAt, lastStep: 3, repliedAt: null, bouncedAt: null, unsubscribedAt: null },
        '2026-01-10T12:00:00.000Z'
      );
      assert.deepEqual(result, { due: false, step: null, sendAfter: null });
    });

    test('render throws without unsubscribeUrl', () => {
      assert.throws(
        () => renderFollowup(2, { business: { name: 'Example Co.' } }),
        /unsubscribeUrl/
      );
    });

    test('step 3 includes commercial video angle only when supplied', () => {
      const result = renderFollowup(3, {
        unsubscribeUrl: 'https://example.com/unsubscribe',
        commercialVideo: true,
        business: { name: 'Example Co.', accentColor: '#0044cc' }
      });
      assert.match(result.text, /commercial video/i);
    });
  } else {
    const fs = require('node:fs');
    const path = process.argv[2];

    if (!path) {
      process.stderr.write('Usage: node followup-sequencer.cjs plan records.json\n');
      process.exitCode = 1;
    } else if (process.argv[2] !== 'plan' || !process.argv[3]) {
      process.stderr.write('Usage: node followup-sequencer.cjs plan records.json\n');
      process.exitCode = 1;
    } else {
      const recordsPath = process.argv[3];
      const records = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
      const now = new Date();
      const due = records
        .map((record) => ({ record, ...plan(record, now) }))
        .filter((item) => item.due);

      process.stdout.write(`${JSON.stringify(due, null, 2)}\n`);
    }
  }
}