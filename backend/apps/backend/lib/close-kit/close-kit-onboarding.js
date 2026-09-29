'use strict';

/*
REPO CONTRACT (embed exactly — every Close Kit module speaks this shape):
- Node 20+, CommonJS (`module.exports`), zero npm deps, node builtins only.
- ONE complete file in ONE code block, runnable as-is.
- Self-test: `node close-kit-onboarding.js --test` prints one PASS/FAIL line per case, exits 0 all-pass / 1 any-fail. No flag = no output.

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

const hasOwn = (obj, key) =>
  obj !== null &&
  typeof obj === 'object' &&
  Object.prototype.hasOwnProperty.call(obj, key);

function ownValue(obj, key) {
  return hasOwn(obj, key) ? obj[key] : undefined;
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : '';
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validCount(value) {
  return finiteNumber(value) && Number.isInteger(value) && value >= 0;
}

function validRating(value) {
  return finiteNumber(value) && value >= 0 && value <= 5;
}

function validHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return '';

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? value
      : '';
  } catch {
    return '';
  }
}

function readInput(input) {
  const root = record(input) || Object.create(null);
  const business = record(ownValue(root, 'business')) || Object.create(null);
  const reviews = record(ownValue(root, 'reviews')) || Object.create(null);
  const proof = record(ownValue(root, 'proof')) || Object.create(null);
  const gap = record(ownValue(root, 'gap')) || Object.create(null);
  const offer = record(ownValue(root, 'offer')) || Object.create(null);

  const rawServices = ownValue(root, 'services');
  const services = Array.isArray(rawServices)
    ? rawServices.filter(
        (service) =>
          typeof service === 'string' && service.trim().length > 0
      )
    : [];

  return {
    rootWasObject: record(input) !== null,

    business: {
      name: nonEmptyString(ownValue(business, 'name')),
      city: nonEmptyString(ownValue(business, 'city')),
      state: nonEmptyString(ownValue(business, 'state')),
      phone: nonEmptyString(ownValue(business, 'phone')),
      email: nonEmptyString(ownValue(business, 'email')),
      website: nonEmptyString(ownValue(business, 'website'))
    },

    services,

    servicesFieldValid: Array.isArray(rawServices),

    reviews: {
      count: ownValue(reviews, 'count'),
      rating: ownValue(reviews, 'rating'),
      sampleQuotes: Array.isArray(ownValue(reviews, 'sampleQuotes'))
        ? ownValue(reviews, 'sampleQuotes').filter(
            (quote) => typeof quote === 'string'
          )
        : []
    },

    gap: {
      flatnessScore: ownValue(gap, 'flatnessScore'),
      notes: Array.isArray(ownValue(gap, 'notes'))
        ? ownValue(gap, 'notes').filter((note) => typeof note === 'string')
        : []
    },

    proof: {
      beforeUrl: validHttpUrl(ownValue(proof, 'beforeUrl')),
      afterUrl: validHttpUrl(ownValue(proof, 'afterUrl')),
      ready: ownValue(proof, 'ready') === true
    },

    offer: {
      monthly: ownValue(offer, 'monthly'),
      setup: ownValue(offer, 'setup'),
      currency: ownValue(offer, 'currency')
    }
  };
}

function sequencePlan(_input) {
  return [
    {
      day: 0,
      needs: [
        'business.name',
        'services',
        'proof.ready',
        'proof.afterUrl'
      ]
    },
    {
      day: 1,
      needs: ['services']
    },
    {
      day: 3,
      needs: [
        'business.website',
        'business.phone'
      ]
    },
    {
      day: 7,
      needs: []
    },
    {
      day: 30,
      needs: [
        'reviews.count',
        'reviews.rating',
        'services'
      ]
    }
  ];
}

function onboardingSequence(input) {
  try {
    const data = readInput(input);
    const warnings = [];
    const emails = [];

    const warn = (message) => {
      warnings.push(message);
    };

    const name = data.business.name;
    const greetingName = name || 'there';

    if (!name) {
      warn(
        'Missing business.name; day 0 uses a generic welcome instead of business-name personalization.'
      );
    }

    /*
     * DAY 0
     */
    const day0 = [];

    day0.push(`Hi ${greetingName},`);
    day0.push(
      'Welcome aboard. We’ll get the rebuilt site ready for launch and keep the handoff simple.'
    );
    day0.push(
      'If you have any photos you really love, send them over. Those are useful, but you do not need to create a new content package for us.'
    );

    if (data.proof.ready && data.proof.afterUrl) {
      day0.push(
        `Please look over the preview and send us any corrections to anything you see: ${data.proof.afterUrl}`
      );
    } else {
      warn(
        'Day 0 preview-corrections line omitted because proof.ready and a valid proof.afterUrl were not both present.'
      );
    }

    if (data.services.length > 0) {
      day0.push(
        'You do not need to retype your services. We already carried the service names you gave us exactly as written.'
      );
    } else {
      warn(
        'Day 0 services handoff line omitted because no usable services were provided.'
      );
    }

    day0.push(
      'That is all we need from you right now: favorite photos if you have them, and corrections if you spot anything.'
    );

    emails.push({
      day: 0,
      subject: name
        ? `Welcome, ${name} — here's what happens next`
        : `Welcome there — here's what happens next`,
      body: day0.join('\n\n')
    });

    /*
     * DAY 1
     */
    const day1 = [];

    day1.push(`Hi ${greetingName},`);
    day1.push(
      'Here is the quick content check. It should take about a minute.'
    );

    if (data.services.length > 0) {
      day1.push(
        [
          'Confirm these are exactly right:',
          ...data.services.map((service) => `- [ ] ${service}`)
        ].join('\n')
      );
      day1.push(
        'If one needs to change, reply with the exact wording you want us to use.'
      );
    } else {
      warn(
        'Day 1 service checklist omitted because no usable services were provided.'
      );
    }

    emails.push({
      day: 1,
      subject: 'Your 60-second content check',
      body: day1.join('\n\n')
    });

    /*
     * DAY 3
     */
    const day3 = [];

    day3.push(`Hi ${greetingName},`);
    day3.push(
      'Going live comes down to one simple choice.'
    );
    day3.push(
      'Option 1: We host the new site and point a fresh web address to it.'
    );

    if (data.business.website) {
      day3.push(
        `Option 2: Keep your current web address, ${data.business.website}, and point that address to the new site.`
      );
    } else {
      warn(
        'Day 3 existing-address option omitted because business.website was not provided.'
      );
    }

    day3.push(
      'Either way, changing the website does not change who owns the customer relationship.'
    );

    if (data.business.phone) {
      day3.push(
        `Your business phone number stays your phone number: ${data.business.phone}`
      );
    } else {
      warn(
        'Day 3 phone-number continuity line omitted because business.phone was not provided.'
      );
    }

    day3.push(
      'Any Google reviews you already have stay with your business; the website does not take ownership of them.'
    );
    day3.push(
      'Your customer relationships stay yours.'
    );

    emails.push({
      day: 3,
      subject: 'Going live — the only decision you make',
      body: day3.join('\n\n')
    });

    /*
     * DAY 7
     */
    const day7 = [];

    day7.push(`Hi ${greetingName},`);
    day7.push(
      'One week in, keep the check simple.'
    );
    day7.push(
      'Open the site on your own phone and use it the way a customer would.'
    );
    day7.push(
      'Notice how many people mention the site to you. No guessing and no special dashboard needed — just pay attention to what real customers say.'
    );
    day7.push(
      'If anything looks off, forward it to us so we can see exactly what you saw.'
    );

    emails.push({
      day: 7,
      subject: 'One week in — what to watch',
      body: day7.join('\n\n')
    });

    /*
     * DAY 30
     */
    const day30 = [];

    day30.push(`Hi ${greetingName},`);
    day30.push(
      'You’ve reached the end of the first month, so here is the simple recap.'
    );

    const hasReviewFacts =
      validCount(data.reviews.count) &&
      validRating(data.reviews.rating);

    const hasServiceFacts = data.services.length > 0;

    if (hasReviewFacts) {
      day30.push(
        `At onboarding, the information you gave us showed ${data.reviews.count} reviews with a ${data.reviews.rating.toFixed(1)}-star rating.`
      );
    } else {
      warn(
        'Day 30 review recap line omitted because valid numeric reviews.count and reviews.rating were not both present.'
      );
    }

    if (hasServiceFacts) {
      day30.push(
        `We carried ${data.services.length} service ${data.services.length === 1 ? 'name' : 'names'} from the information you gave us.`
      );
    } else {
      warn(
        'Day 30 service-count recap line omitted because no usable services were provided.'
      );
    }

    if (!hasReviewFacts && !hasServiceFacts) {
      day30.push(
        'We do not have enough verified review or service data in this onboarding record to give you a numbers-based recap, so we will keep this one simple: please send us anything on the site that needs correcting.'
      );
      warn(
        'Day 30 uses a generic recap because neither verified review facts nor usable service facts were available.'
      );
    } else {
      day30.push(
        'For the next month, keep doing the useful part: look at the site like a customer and send us anything that needs correcting.'
      );
    }

    emails.push({
      day: 30,
      subject: 'Month one recap',
      body: day30.join('\n\n')
    });

    const usableBusinessFact = Object.values(data.business).some(Boolean);
    const usableReviewFact =
      validCount(data.reviews.count) ||
      validRating(data.reviews.rating);
    const usableGapFact =
      finiteNumber(data.gap.flatnessScore) &&
      data.gap.flatnessScore >= 0 &&
      data.gap.flatnessScore <= 100;
    const usableProofFact =
      Boolean(data.proof.beforeUrl) ||
      Boolean(data.proof.afterUrl) ||
      data.proof.ready === true;
    const usableOfferFact =
      finiteNumber(data.offer.monthly) ||
      finiteNumber(data.offer.setup) ||
      data.offer.currency === 'USD';

    const hasAnyUsableFact =
      usableBusinessFact ||
      data.services.length > 0 ||
      usableReviewFact ||
      usableGapFact ||
      usableProofFact ||
      usableOfferFact;

    if (!data.rootWasObject || !hasAnyUsableFact) {
      warn(
        'Input contained no usable CloseKit facts; generic fail-soft onboarding copy was returned.'
      );
    }

    return {
      ok: data.rootWasObject && hasAnyUsableFact,
      emails,
      warnings
    };
  } catch {
    /*
     * Highest-law fail-safe: public API must never throw on bad input.
     * Keep all five required emails present even if an unforeseen value
     * defeats the normal normalization path.
     */
    return {
      ok: false,
      emails: [
        {
          day: 0,
          subject: `Welcome there — here's what happens next`,
          body:
            'Hi there,\n\nWelcome aboard. We’ll keep the next steps simple.\n\nIf you have any photos you really love, send them over. That is all we can safely ask for from the information currently available.'
        },
        {
          day: 1,
          subject: 'Your 60-second content check',
          body:
            'Hi there,\n\nWe do not have verified service names to put into the content checklist yet.'
        },
        {
          day: 3,
          subject: 'Going live — the only decision you make',
          body:
            'Hi there,\n\nGoing live comes down to a simple choice.\n\nOption 1: We host the new site and point a fresh web address to it.\n\nYour customer relationships stay yours.'
        },
        {
          day: 7,
          subject: 'One week in — what to watch',
          body:
            'Hi there,\n\nOpen the site on your own phone and use it the way a customer would.\n\nNotice what real customers say, and forward anything that looks off.'
        },
        {
          day: 30,
          subject: 'Month one recap',
          body:
            'Hi there,\n\nWe do not have enough verified facts in this onboarding record for a numbers-based recap. Please send us anything on the site that needs correcting.'
        }
      ],
      warnings: [
        'Input could not be safely normalized; generic fail-soft onboarding copy was returned.'
      ]
    };
  }
}

module.exports = {
  onboardingSequence,
  sequencePlan
};

/*
 * SELF-TEST
 */
if (require.main === module && process.argv.includes('--test')) {
  const assert = require('node:assert/strict');

  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  function fullInput() {
    return {
      business: {
        name: 'Harbor Plumbing',
        city: 'Mission Viejo',
        state: 'CA',
        phone: '(949) 555-0147',
        email: 'hello@harborplumbing.example',
        website: 'https://harborplumbing.example'
      },
      services: [
        'Emergency Plumbing',
        'Water Heater Repair',
        'Leak Detection',
        'Drain Cleaning'
      ],
      reviews: {
        count: 187,
        rating: 4.8,
        sampleQuotes: [
          'Fast and professional.',
          'Showed up when promised.'
        ]
      },
      gap: {
        flatnessScore: 82,
        notes: [
          'Flat hero',
          'Weak mobile hierarchy'
        ]
      },
      proof: {
        beforeUrl: 'https://harborplumbing.example',
        afterUrl: 'https://harbor-plumbing.wss-ai.com',
        ready: true
      },
      offer: {
        monthly: 149,
        setup: 0,
        currency: 'USD'
      }
    };
  }

  test('full realistic input', () => {
    const result = onboardingSequence(fullInput());

    assert.equal(result.ok, true);
    assert.equal(result.emails.length, 5);
    assert.deepEqual(
      result.emails.map((email) => email.day),
      [0, 1, 3, 7, 30]
    );

    const day1 = result.emails.find((email) => email.day === 1);
    assert.ok(day1.body.includes('Emergency Plumbing'));
    assert.ok(day1.body.includes('Water Heater Repair'));
    assert.ok(day1.body.includes('Leak Detection'));

    const day30 = result.emails.find((email) => email.day === 30);
    assert.ok(day30.body.includes('187'));
    assert.equal(result.warnings.length, 0);
  });

  test('empty object fails soft', () => {
    let result;

    assert.doesNotThrow(() => {
      result = onboardingSequence({});
    });

    assert.equal(result.ok, false);
    assert.equal(result.emails.length, 5);
    assert.ok(result.warnings.length > 0);
  });

  test('empty services keeps day 1 and omits checklist', () => {
    const input = fullInput();
    input.services = [];

    const result = onboardingSequence(input);
    const day1 = result.emails.find((email) => email.day === 1);

    assert.ok(day1);
    assert.equal(day1.body.includes('- [ ]'), false);
    assert.ok(
      result.warnings.some((warning) =>
        warning.includes('Day 1 service checklist omitted')
      )
    );
  });

  test('missing business name reads naturally', () => {
    const input = fullInput();
    input.business.name = '';

    const result = onboardingSequence(input);
    const allText = result.emails
      .map((email) => `${email.subject}\n${email.body}`)
      .join('\n');

    assert.equal(allText.includes('undefined'), false);
    assert.equal(allText.includes('null'), false);
    assert.ok(
      result.emails[0].subject.startsWith('Welcome there')
    );
    assert.ok(
      result.emails.every((email) => email.body.includes('Hi there,'))
    );
  });

  test('hostile input cannot throw or pollute prototypes', () => {
    delete Object.prototype.closeKitPolluted;

    const hostile = JSON.parse(`{
      "__proto__": {
        "closeKitPolluted": "yes"
      },
      "business": {
        "__proto__": {
          "name": "Injected Name"
        },
        "name": null,
        "city": 123,
        "state": [],
        "phone": {},
        "email": false,
        "website": 99
      },
      "services": [
        null,
        123,
        {},
        "Real Service"
      ],
      "reviews": {
        "count": "999",
        "rating": "5.0",
        "sampleQuotes": null
      },
      "gap": {
        "flatnessScore": "100",
        "notes": {}
      },
      "proof": {
        "beforeUrl": null,
        "afterUrl": {},
        "ready": "true"
      },
      "offer": {
        "monthly": "149",
        "setup": "0",
        "currency": {
          "toString": "USD"
        }
      }
    }`);

    let result;

    assert.doesNotThrow(() => {
      result = onboardingSequence(hostile);
    });

    assert.equal(Object.prototype.closeKitPolluted, undefined);
    assert.equal(({}).closeKitPolluted, undefined);
    assert.equal(result.emails.length, 5);

    const allText = JSON.stringify(result);
    assert.equal(allText.includes('Injected Name'), false);
    assert.equal(allText.includes('"999 reviews'), false);

    delete Object.prototype.closeKitPolluted;
  });

  test('service names remain verbatim', () => {
    const input = fullInput();
    input.services = [
      '24/7 Emergency Service',
      'A/C & Heating',
      'Roof Repair — Tile & Shingle'
    ];

    const result = onboardingSequence(input);
    const day1 = result.emails.find((email) => email.day === 1);

    for (const service of input.services) {
      assert.ok(
        day1.body.includes(`- [ ] ${service}`),
        `missing verbatim service: ${service}`
      );
    }
  });

  test('sequence plan declares all five days and dependencies', () => {
    const plan = sequencePlan(fullInput());

    assert.deepEqual(
      plan.map((entry) => entry.day),
      [0, 1, 3, 7, 30]
    );

    assert.ok(
      plan.find((entry) => entry.day === 1).needs.includes('services')
    );
    assert.ok(
      plan.find((entry) => entry.day === 30).needs.includes('reviews.count')
    );
    assert.ok(
      plan.find((entry) => entry.day === 30).needs.includes('reviews.rating')
    );
  });

  test('exports exactly the required public API', () => {
    assert.deepEqual(
      Object.keys(module.exports).sort(),
      ['onboardingSequence', 'sequencePlan']
    );
    assert.equal(typeof module.exports.onboardingSequence, 'function');
    assert.equal(typeof module.exports.sequencePlan, 'function');
  });

  let failed = 0;

  for (const current of tests) {
    try {
      current.fn();
      console.log(`PASS: ${current.name}`);
    } catch (error) {
      failed += 1;
      const message =
        error && typeof error.message === 'string'
          ? error.message.replace(/\s+/g, ' ').trim()
          : 'unknown test failure';

      console.log(`FAIL: ${current.name} — ${message}`);
    }
  }

  process.exitCode = failed === 0 ? 0 : 1;
}
