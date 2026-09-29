'use strict';

/*
REPO CONTRACT (embed exactly — every Close Kit module speaks this shape):
- Node 20+, CommonJS (`module.exports`), zero npm deps, node builtins only.
- ONE complete file in ONE code block, runnable as-is.
- Self-test: `node close-kit-proposal.js --test` prints one PASS/FAIL line per case, exits 0 all-pass / 1 any-fail. No flag = no output.

THE SHARED INPUT CONTRACT `CloseKitInput` (verbatim — do not rename fields):
{
  business: { name: string, city: string, state: string, phone: string, email: string, website: string }, // strings, may be empty
  services: string[],             // the client's VERBATIM service names
  reviews: { count: number, rating: number, sampleQuotes: string[] }, // rating 0-5 one decimal
  gap: { flatnessScore: number, notes: string[] },  // 0-100, higher = deader current site; notes may be empty
  proof: { beforeUrl: string, afterUrl: string, ready: boolean },     // their old site vs our rebuilt mirror
  offer: { monthly: number, setup: number, currency: "USD" }          // e.g. 149 / 0
}
*/

function hasOwn(obj, key) {
  try {
    return (
      obj !== null &&
      (typeof obj === 'object' || typeof obj === 'function') &&
      Object.prototype.hasOwnProperty.call(obj, key)
    );
  } catch {
    return false;
  }
}

function ownValue(obj, key) {
  if (!hasOwn(obj, key)) return undefined;

  try {
    const descriptor = Object.getOwnPropertyDescriptor(obj, key);

    /*
     * Never invoke user-supplied accessors/getters.
     */
    if (
      !descriptor ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      return undefined;
    }

    return descriptor.value;
  } catch {
    return undefined;
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeNumber(value) {
  return isFiniteNumber(value) && value >= 0;
}

/*
 * One canonical user-text neutralizer.
 *
 * HTML output still ALWAYS goes through escapeHtml().
 * This additional pass prevents dangerous tag/attribute/protocol text
 * from surviving verbatim into the plain-text proposal, and prevents
 * dangerous tokens such as onerror=/onload=/javascript: from appearing
 * raw in HTML source even when the surrounding markup is escaped.
 *
 * Benign text such as "<Best>" is preserved here and merely HTML-escaped
 * at render time.
 */
function neutralizeUserText(value) {
  if (typeof value !== 'string') return '';

  let out = value;

  /*
   * Neutralize executable URL schemes anywhere in user text.
   */
  out = out.replace(
    /\bjavascript\s*:/gi,
    '[blocked-protocol]:'
  );

  out = out.replace(
    /\bdata\s*:/gi,
    '[blocked-protocol]:'
  );

  /*
   * Neutralize inline event-handler attribute names.
   * Examples:
   *   onerror=
   *   onload =
   *   onclick=
   */
  out = out.replace(
    /\bon[a-z0-9_-]+\s*=/gi,
    '[blocked-event]='
  );

  /*
   * Neutralize tag-like beginnings for HTML elements that commonly
   * carry executable/active payloads. Benign pseudo-text such as
   * "<Best>" remains untouched.
   */
  out = out.replace(
    /<\s*(\/?)\s*(script|img|svg|iframe|object|embed|link|meta|style|form|input|button|video|audio|source|math)\b/gi,
    function (_match, closing, tagName) {
      return closing
        ? `[/${String(tagName).toLowerCase()}`
        : `[${String(tagName).toLowerCase()}`;
    }
  );

  return out;
}

/*
 * The one canonical HTML escaper used for every interpolation of
 * user-controlled text into HTML.
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapedUserText(value) {
  return escapeHtml(neutralizeUserText(value));
}

function safeHttpUrl(value) {
  if (!isNonEmptyString(value)) return null;

  try {
    const parsed = new URL(value);

    if (
      parsed.protocol !== 'http:' &&
      parsed.protocol !== 'https:'
    ) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

function formatMoney(value) {
  if (!isNonNegativeNumber(value)) return '';

  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2);
}

function flatnessLanguage(score) {
  if (score >= 85) {
    return 'effectively invisible online';
  }

  if (score >= 70) {
    return 'very easy to overlook online';
  }

  if (score >= 50) {
    return 'showing clear signs of an outdated online presence';
  }

  if (score >= 30) {
    return 'functional, but visually behind stronger modern sites';
  }

  return 'relatively active, with room to sharpen the presentation';
}

function compileProposal(input) {
  const warnings = [];
  const sections = [];

  const source =
    input !== null && typeof input === 'object'
      ? input
      : null;

  /*
   * a. HEADLINE
   */
  const business = ownValue(source, 'business');
  const rawBusinessName = ownValue(business, 'name');
  const rawBusinessCity = ownValue(business, 'city');

  const hasBusinessName = isNonEmptyString(rawBusinessName);

  if (hasBusinessName) {
    const businessName = neutralizeUserText(rawBusinessName);

    const location = isNonEmptyString(rawBusinessCity)
      ? ` — ${neutralizeUserText(rawBusinessCity)}`
      : '';

    sections.push({
      id: 'headline',
      title: `${businessName}${location}`,
      body:
        'A cinematic website proposal built around your real business identity.'
    });
  } else {
    warnings.push(
      'Headline omitted: business.name is missing or invalid.'
    );
  }

  /*
   * b. WHERE YOUR SITE STANDS TODAY
   */
  const gap = ownValue(source, 'gap');
  const flatnessScore = ownValue(gap, 'flatnessScore');
  const rawGapNotes = ownValue(gap, 'notes');

  if (
    isFiniteNumber(flatnessScore) &&
    flatnessScore >= 0 &&
    flatnessScore <= 100
  ) {
    const bodyLines = [
      `Flatness score: ${flatnessScore}/100 — ${flatnessLanguage(flatnessScore)}.`
    ];

    if (Array.isArray(rawGapNotes)) {
      for (const rawNote of rawGapNotes) {
        if (isNonEmptyString(rawNote)) {
          bodyLines.push(
            neutralizeUserText(rawNote)
          );
        }
      }
    }

    sections.push({
      id: 'site-stands-today',
      title: 'Where your site stands today',
      body: bodyLines.join('\n')
    });
  } else {
    warnings.push(
      'Where your site stands today omitted: gap.flatnessScore is missing or invalid.'
    );
  }

  /*
   * c. WHAT WE REBUILD
   */
  const rawServices = ownValue(source, 'services');
  const services = [];

  if (Array.isArray(rawServices)) {
    for (const rawService of rawServices) {
      if (isNonEmptyString(rawService)) {
        services.push(
          neutralizeUserText(rawService)
        );
      }
    }
  }

  if (services.length > 0) {
    sections.push({
      id: 'what-we-rebuild',
      title: 'What we rebuild',
      body:
        'Your services stay exactly yours:\n' +
        services
          .map((service) => `• ${service}`)
          .join('\n')
    });
  } else {
    warnings.push(
      'What we rebuild omitted: services has no valid service names.'
    );
  }

  /*
   * d. THE PROOF
   */
  const proof = ownValue(source, 'proof');
  const proofReady = ownValue(proof, 'ready') === true;

  const beforeUrl = safeHttpUrl(
    ownValue(proof, 'beforeUrl')
  );

  const afterUrl = safeHttpUrl(
    ownValue(proof, 'afterUrl')
  );

  let proofLinks = null;

  if (
    proofReady &&
    beforeUrl &&
    afterUrl
  ) {
    proofLinks = {
      beforeUrl,
      afterUrl
    };

    sections.push({
      id: 'proof',
      title: 'The proof',
      body:
        `Before: ${beforeUrl}\n` +
        `After: ${afterUrl}\n` +
        'These are the before-and-after links supplied with this proposal; no result beyond that comparison is being claimed.'
    });
  } else {
    warnings.push(
      'The proof omitted: proof is not ready with valid before and after URLs.'
    );
  }

  /*
   * e. REPUTATION YOU ALREADY EARNED
   */
  const reviews = ownValue(source, 'reviews');

  const reviewCount = ownValue(reviews, 'count');
  const reviewRating = ownValue(reviews, 'rating');
  const rawSampleQuotes = ownValue(
    reviews,
    'sampleQuotes'
  );

  const countValid =
    isFiniteNumber(reviewCount) &&
    Number.isInteger(reviewCount) &&
    reviewCount > 0;

  const ratingValid =
    isFiniteNumber(reviewRating) &&
    reviewRating >= 0 &&
    reviewRating <= 5;

  if (countValid && ratingValid) {
    const bodyLines = [
      `${reviewCount} reviews at ${reviewRating.toFixed(1)}/5.`
    ];

    if (Array.isArray(rawSampleQuotes)) {
      for (const rawQuote of rawSampleQuotes) {
        if (isNonEmptyString(rawQuote)) {
          bodyLines.push(
            `Sample review: ${neutralizeUserText(rawQuote)}`
          );

          /*
           * At most one supplied quote.
           */
          break;
        }
      }
    }

    sections.push({
      id: 'reputation',
      title: 'Reputation you already earned',
      body: bodyLines.join('\n')
    });
  } else {
    warnings.push(
      'Reputation you already earned omitted: reviews.count is missing, invalid, or zero, or reviews.rating is invalid.'
    );
  }

  /*
   * f. INVESTMENT
   */
  const offer = ownValue(source, 'offer');

  const monthly = ownValue(offer, 'monthly');
  const setup = ownValue(offer, 'setup');
  const currency = ownValue(offer, 'currency');

  const monthlyValid =
    isNonNegativeNumber(monthly) &&
    currency === 'USD';

  const setupValid =
    isNonNegativeNumber(setup);

  if (monthlyValid) {
    const monthlyText =
      `$${formatMoney(monthly)}/mo`;

    const bodyLines = [
      `Essential — ${monthlyText}`,
      `Growth — ${monthlyText} — monthly new pages included.`
    ];

    if (
      setupValid &&
      setup > 0
    ) {
      bodyLines.push(
        `Authority — $${formatMoney(setup)} setup + ${monthlyText}`
      );
    } else {
      warnings.push(
        'Authority tier omitted: offer.setup is not greater than zero.'
      );
    }

    bodyLines.push(
      'Month-to-month. Cancel anytime. You own your reviews and number everywhere.'
    );

    sections.push({
      id: 'investment',
      title: 'Investment',
      body: bodyLines.join('\n')
    });
  } else {
    warnings.push(
      'Investment omitted: offer.monthly or offer.currency is missing or invalid.'
    );

    warnings.push(
      'Authority tier omitted: offer.setup is not greater than zero or cannot be used without a valid monthly offer.'
    );
  }

  /*
   * g. NEXT STEP
   */
  sections.push({
    id: 'next-step',
    title: 'Next step',
    body:
      'Reply to this email and we start Monday.'
  });

  return {
    sections,
    warnings,
    coreReady:
      hasBusinessName &&
      monthlyValid,
    proofLinks
  };
}

function renderText(sections) {
  return sections
    .map(
      (section) =>
        `${section.title}\n${section.body}`
    )
    .join('\n\n');
}

function renderProofHtml(proofLinks) {
  /*
   * Proof URLs are user-controlled too:
   * first protocol-validated, then HTML escaped before every interpolation.
   */
  const before = escapeHtml(
    neutralizeUserText(
      proofLinks.beforeUrl
    )
  );

  const after = escapeHtml(
    neutralizeUserText(
      proofLinks.afterUrl
    )
  );

  return [
    '<div style="margin:0 0 10px 0;">',
    '<span style="color:#a1a1aa;">Before:</span> ',
    `<a href="${before}" style="color:#c4b5fd;text-decoration:underline;word-break:break-all;">${before}</a>`,
    '</div>',

    '<div style="margin:0 0 10px 0;">',
    '<span style="color:#a1a1aa;">After:</span> ',
    `<a href="${after}" style="color:#22c55e;text-decoration:underline;word-break:break-all;">${after}</a>`,
    '</div>',

    '<div style="color:#e4e4e7;line-height:1.65;">',
    'These are the before-and-after links supplied with this proposal; no result beyond that comparison is being claimed.',
    '</div>'
  ].join('');
}

function renderSectionBodyHtml(
  section,
  proofLinks
) {
  if (
    section.id === 'proof' &&
    proofLinks
  ) {
    return renderProofHtml(
      proofLinks
    );
  }

  /*
   * All user-derived section content has already passed through
   * neutralizeUserText while compiling. Every interpolation into HTML
   * still passes through the same escapeHtml function here.
   */
  return (
    '<div style="white-space:pre-wrap;color:#e4e4e7;line-height:1.7;">' +
    escapeHtml(section.body) +
    '</div>'
  );
}

function renderHtml(
  sections,
  proofLinks
) {
  const cards = sections
    .map((section, index) => {
      const isHeadline =
        section.id === 'headline';

      const isProof =
        section.id === 'proof';

      const border = isProof
        ? '#22c55e'
        : '#27272a';

      const titleSize = isHeadline
        ? '32px'
        : '20px';

      const headingTag = isHeadline
        ? 'h1'
        : 'h2';

      const topMargin =
        index === 0
          ? '0'
          : '16px';

      return (
        `<section style="margin:${topMargin} 0 0 0;padding:24px;border:1px solid ${border};border-radius:18px;background:#111118;box-shadow:0 18px 50px rgba(0,0,0,.28);">` +

        `<${headingTag} style="margin:0 0 12px 0;font-size:${titleSize};line-height:1.15;color:#ffffff;font-weight:800;letter-spacing:-.02em;">` +

        /*
         * Section titles containing user fields go through the exact
         * same HTML escaper as all other interpolated content.
         */
        escapeHtml(section.title) +

        `</${headingTag}>` +

        renderSectionBodyHtml(
          section,
          proofLinks
        ) +

        '</section>'
      );
    })
    .join('');

  return (
    '<!doctype html>' +
    '<html lang="en">' +
    '<head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Close Kit Proposal</title>' +
    '</head>' +

    '<body style="margin:0;background:#0a0a0f;color:#ffffff;font-family:system-ui,-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">' +

    '<main style="max-width:760px;margin:0 auto;padding:32px 18px 48px 18px;">' +

    '<div style="height:4px;width:72px;border-radius:999px;background:#7c3aed;margin:0 0 20px 0;"></div>' +

    cards +

    '</main>' +
    '</body>' +
    '</html>'
  );
}

function buildProposal(input) {
  try {
    const compiled =
      compileProposal(input);

    return {
      ok: compiled.coreReady,
      html: renderHtml(
        compiled.sections,
        compiled.proofLinks
      ),
      text: renderText(
        compiled.sections
      ),
      warnings:
        compiled.warnings.slice()
    };
  } catch {
    return {
      ok: false,
      html: '',
      text: '',
      warnings: [
        'Proposal could not be built from the supplied input; malformed data was ignored safely.'
      ]
    };
  }
}

function proposalSections(input) {
  try {
    return compileProposal(input)
      .sections
      .map((section) => ({
        id: section.id,
        title: section.title,
        body: section.body
      }));
  } catch {
    return [];
  }
}

module.exports = {
  buildProposal,
  proposalSections
};


/*
 * SELF-TEST
 */
if (
  require.main === module &&
  process.argv.includes('--test')
) {
  const tests = [];

  function test(name, fn) {
    tests.push({
      name,
      fn
    });
  }

  function expect(
    condition,
    message
  ) {
    if (!condition) {
      throw new Error(
        message || 'assertion failed'
      );
    }
  }

  function clone(value) {
    return JSON.parse(
      JSON.stringify(value)
    );
  }

  const fullInput = {
    business: {
      name: 'Harbor Plumbing Co.',
      city: 'Long Beach',
      state: 'CA',
      phone: '(555) 010-2020',
      email: 'owner@example.com',
      website:
        'https://harborplumbing.example'
    },

    services: [
      'Emergency Plumbing',
      'Drain Cleaning',
      'Water Heater Repair',
      'Water Heater Installation',
      'Tankless Water Heaters',
      'Leak Detection',
      'Pipe Repair',
      'Repiping',
      'Sewer Line Repair',
      'Sewer Camera Inspection',
      'Hydro Jetting',
      'Toilet Repair',
      'Faucet Repair',
      'Garbage Disposals',
      'Gas Line Repair',
      'Slab Leak Repair',
      'Bathroom Plumbing',
      'Kitchen Plumbing',
      'Commercial Plumbing'
    ],

    reviews: {
      count: 214,
      rating: 4.8,
      sampleQuotes: [
        'They showed up when they said they would and fixed the leak quickly.'
      ]
    },

    gap: {
      flatnessScore: 87,
      notes: [
        'The service list is hard to scan.',
        'The current presentation feels dated.'
      ]
    },

    proof: {
      beforeUrl:
        'https://harborplumbing.example',
      afterUrl:
        'https://harbor-plumbing.wss-ai.com',
      ready: true
    },

    offer: {
      monthly: 149,
      setup: 299,
      currency: 'USD'
    }
  };

  /*
   * REQUIRED ORIGINAL TESTS
   */

  test(
    'full realistic input',
    () => {
      const result =
        buildProposal(fullInput);

      expect(
        result.ok === true,
        'expected ok true'
      );

      expect(
        result.html.includes(
          'Harbor Plumbing Co.'
        ),
        'business name missing'
      );

      expect(
        result.html.includes('149'),
        'price missing'
      );

      expect(
        result.html.includes(
          fullInput.proof.beforeUrl
        ),
        'beforeUrl missing'
      );

      expect(
        result.text.length > 0,
        'text empty'
      );

      expect(
        result.warnings.length === 0,
        'expected zero warnings'
      );
    }
  );

  test(
    'empty input fails soft',
    () => {
      let result = null;

      expect(
        (() => {
          try {
            result =
              buildProposal({});
            return true;
          } catch {
            return false;
          }
        })(),
        'empty input threw'
      );

      expect(
        result.ok === false,
        'expected ok false'
      );

      expect(
        result.warnings.length > 0,
        'warnings missing'
      );
    }
  );

  test(
    'reviews count zero omits reputation',
    () => {
      const input =
        clone(fullInput);

      input.reviews.count = 0;

      const result =
        buildProposal(input);

      const sections =
        proposalSections(input);

      expect(
        result.ok === true,
        'expected ok true'
      );

      expect(
        !sections.some(
          (section) =>
            section.id ===
            'reputation'
        ),
        'reputation was not omitted'
      );

      expect(
        result.warnings.some(
          (warning) =>
            warning.includes(
              'Reputation'
            )
        ),
        'reputation warning missing'
      );
    }
  );

  test(
    'proof ready false omits proof and links',
    () => {
      const input =
        clone(fullInput);

      input.proof = {
        beforeUrl:
          'https://dead-before.example',
        afterUrl:
          'https://dead-after.example',
        ready: false
      };

      const result =
        buildProposal(input);

      const sections =
        proposalSections(input);

      expect(
        result.ok === true,
        'expected ok true'
      );

      expect(
        !sections.some(
          (section) =>
            section.id ===
            'proof'
        ),
        'proof was not omitted'
      );

      expect(
        !result.html.includes(
          'dead-before.example'
        ),
        'before link leaked'
      );

      expect(
        !result.html.includes(
          'dead-after.example'
        ),
        'after link leaked'
      );

      expect(
        !result.text.includes(
          'dead-before.example'
        ),
        'before link leaked into text'
      );

      expect(
        !result.text.includes(
          'dead-after.example'
        ),
        'after link leaked into text'
      );

      expect(
        result.warnings.some(
          (warning) =>
            warning.includes(
              'proof'
            )
        ),
        'proof warning missing'
      );
    }
  );

  test(
    'setup zero omits Authority but keeps Essential and Growth',
    () => {
      const input =
        clone(fullInput);

      input.offer.setup = 0;

      const result =
        buildProposal(input);

      const investment =
        proposalSections(input)
          .find(
            (section) =>
              section.id ===
              'investment'
          );

      expect(
        result.ok === true,
        'expected ok true'
      );

      expect(
        Boolean(investment),
        'investment missing'
      );

      expect(
        investment.body.includes(
          'Essential'
        ),
        'Essential missing'
      );

      expect(
        investment.body.includes(
          'Growth'
        ),
        'Growth missing'
      );

      expect(
        !investment.body.includes(
          'Authority'
        ),
        'Authority should be omitted'
      );

      expect(
        result.warnings.some(
          (warning) =>
            warning.includes(
              'Authority tier omitted'
            )
        ),
        'Authority warning missing'
      );
    }
  );

  test(
    'hostile input fails soft without prototype pollution',
    () => {
      delete Object.prototype
        .closeKitPolluted;

      const hostile = JSON.parse(
        '{' +
          '"__proto__":{"closeKitPolluted":"yes"},' +
          '"business":null,' +
          '"services":"wrong",' +
          '"reviews":{' +
            '"count":"214",' +
            '"rating":"4.8",' +
            '"sampleQuotes":null' +
          '},' +
          '"gap":{' +
            '"flatnessScore":"87",' +
            '"notes":null' +
          '},' +
          '"proof":{' +
            '"beforeUrl":7,' +
            '"afterUrl":{},' +
            '"ready":"true"' +
          '},' +
          '"offer":{' +
            '"monthly":"149",' +
            '"setup":"0",' +
            '"currency":7' +
          '}' +
        '}'
      );

      Object.defineProperty(
        hostile,
        'dangerousGetter',
        {
          enumerable: true,
          get() {
            throw new Error(
              'getter executed'
            );
          }
        }
      );

      let result;
      let sections;

      expect(
        (() => {
          try {
            result =
              buildProposal(hostile);

            sections =
              proposalSections(
                hostile
              );

            return true;
          } catch {
            return false;
          }
        })(),
        'hostile input threw'
      );

      expect(
        result.ok === false,
        'expected fail-soft false'
      );

      expect(
        result.warnings.length > 0,
        'warnings missing'
      );

      expect(
        Array.isArray(sections),
        'sections not array'
      );

      expect(
        Object.prototype
          .closeKitPolluted ===
          undefined,
        'Object.prototype polluted'
      );

      expect(
        ({}).closeKitPolluted ===
          undefined,
        'new objects polluted'
      );
    }
  );

  /*
   * PROTOCOL GUARD REGRESSION TESTS
   */

  test(
    'javascript proof protocol is never linked',
    () => {
      const input =
        clone(fullInput);

      input.proof.beforeUrl =
        'javascript:alert(1)';

      const result =
        buildProposal(input);

      expect(
        !result.html
          .toLowerCase()
          .includes(
            'javascript:alert(1)'
          ),
        'javascript proof URL leaked'
      );

      expect(
        !proposalSections(input)
          .some(
            (section) =>
              section.id ===
              'proof'
          ),
        'proof should be omitted'
      );
    }
  );

  test(
    'data proof protocol is never linked',
    () => {
      const input =
        clone(fullInput);

      input.proof.afterUrl =
        'data:text/html,<svg onload=alert(1)>';

      const result =
        buildProposal(input);

      expect(
        !result.html
          .toLowerCase()
          .includes('data:text/html'),
        'data proof URL leaked'
      );

      expect(
        !proposalSections(input)
          .some(
            (section) =>
              section.id ===
              'proof'
          ),
        'proof should be omitted'
      );
    }
  );

  test(
    'Authority setup greater than zero renders exact setup plus monthly form',
    () => {
      const input =
        clone(fullInput);

      input.offer.setup = 299;
      input.offer.monthly = 149;

      const investment =
        proposalSections(input)
          .find(
            (section) =>
              section.id ===
              'investment'
          );

      expect(
        Boolean(investment),
        'investment missing'
      );

      expect(
        investment.body.includes(
          'Authority — $299 setup + $149/mo'
        ),
        'Authority pricing format wrong'
      );
    }
  );

  /*
   * ROUND 2 EXACT ADVERSARIAL TESTS
   */

  test(
    'services payload img onerror is neutralized in html and text',
    () => {
      const input =
        clone(fullInput);

      input.services = [
        '<img src=x onerror=alert(1)>'
      ];

      const result =
        buildProposal(input);

      expect(
        !result.html
          .toLowerCase()
          .includes('onerror='),
        'html contains raw onerror='
      );

      expect(
        !result.text
          .toLowerCase()
          .includes('<img'),
        'text contains raw <img'
      );
    }
  );

  test(
    'sampleQuote svg onload is neutralized in html and text',
    () => {
      const input =
        clone(fullInput);

      input.reviews.sampleQuotes = [
        '\"><svg onload=alert(1)>'
      ];

      const result =
        buildProposal(input);

      expect(
        !result.html
          .toLowerCase()
          .includes('onload='),
        'html contains raw onload='
      );

      expect(
        !result.text
          .toLowerCase()
          .includes('onload='),
        'text contains raw onload='
      );
    }
  );

  test(
    'gap note javascript href is neutralized in html',
    () => {
      const input =
        clone(fullInput);

      input.gap.notes = [
        '<a href="javascript:alert(1)">'
      ];

      const result =
        buildProposal(input);

      expect(
        !result.html
          .toLowerCase()
          .includes('javascript:'),
        'html contains raw javascript:'
      );
    }
  );

  test(
    'legitimate angle-bracket service survives escaping visibly',
    () => {
      const input =
        clone(fullInput);

      input.services = [
        'Drain & Sewer <Best>'
      ];

      const result =
        buildProposal(input);

      expect(
        result.html.includes(
          'Drain &amp; Sewer &lt;Best&gt;'
        ),
        'legitimate service was not visibly escaped'
      );

      expect(
        result.text.includes(
          'Drain & Sewer <Best>'
        ),
        'legitimate service was deleted or changed'
      );
    }
  );

  /*
   * ADDITIONAL USER-TEXT ESCAPING REGRESSIONS
   */

  test(
    'business name uses same html escaping path',
    () => {
      const input =
        clone(fullInput);

      input.business.name =
        '<script onload=alert(1)>ACME</script>';

      const result =
        buildProposal(input);

      expect(
        !result.html
          .toLowerCase()
          .includes('onload='),
        'raw event attribute leaked'
      );

      expect(
        !result.html.includes(
          '<script'
        ),
        'raw script tag leaked'
      );

      expect(
        !result.text
          .toLowerCase()
          .includes('<script'),
        'raw script tag leaked into text'
      );

      expect(
        result.html.includes(
          '[script'
        ),
        'neutralized business text missing'
      );
    }
  );

  test(
    'gap note dangerous event handler is neutralized',
    () => {
      const input =
        clone(fullInput);

      input.gap.notes = [
        '<svg onload = alert(1)>note'
      ];

      const result =
        buildProposal(input);

      expect(
        !result.html
          .toLowerCase()
          .includes('onload'),
        'event handler leaked into html'
      );

      expect(
        !result.text
          .toLowerCase()
          .includes('onload'),
        'event handler leaked into text'
      );

      expect(
        !result.text
          .toLowerCase()
          .includes('<svg'),
        'dangerous svg tag leaked into text'
      );
    }
  );

  test(
    'at most one real review quote appears',
    () => {
      const input =
        clone(fullInput);

      input.reviews.sampleQuotes = [
        'First real quote.',
        'Second real quote.',
        'Third real quote.'
      ];

      const result =
        buildProposal(input);

      expect(
        result.text.includes(
          'First real quote.'
        ),
        'first quote missing'
      );

      expect(
        !result.text.includes(
          'Second real quote.'
        ),
        'second quote should not appear'
      );

      expect(
        !result.text.includes(
          'Third real quote.'
        ),
        'third quote should not appear'
      );
    }
  );

  test(
    'flatness 87 maps to effectively invisible online',
    () => {
      const result =
        buildProposal(fullInput);

      expect(
        result.text.includes(
          '87/100 — effectively invisible online'
        ),
        'flatness translation incorrect'
      );
    }
  );

  let failures = 0;

  for (const entry of tests) {
    try {
      entry.fn();

      process.stdout.write(
        `PASS ${entry.name}\n`
      );
    } catch (error) {
      failures += 1;

      process.stdout.write(
        `FAIL ${entry.name}: ${
          error &&
          error.message
            ? error.message
            : 'unknown error'
        }\n`
      );
    }
  }

  process.exitCode =
    failures === 0
      ? 0
      : 1;
}