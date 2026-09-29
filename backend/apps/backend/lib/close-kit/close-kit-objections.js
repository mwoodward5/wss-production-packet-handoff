'use strict';

/*
  close-kit-objections.js

  Node 20+, CommonJS, zero dependencies.

  Run self-tests:
    node close-kit-objections.js --test
*/

const OWN = Object.prototype.hasOwnProperty;

function hasOwn(value, key) {
  return value !== null && typeof value === 'object' && OWN.call(value, key);
}

function asPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return Object.create(null);
  }
  return value;
}

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNonNegativeNumber(value) {
  const number = asFiniteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function asNonNegativeInteger(value) {
  const number = asNonNegativeNumber(value);
  return number !== null ? Math.floor(number) : null;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string').map((item) => item.trim());
}

function normalizeForMatch(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function formatMoney(amount, currency) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    return '';
  }

  if (currency !== 'USD') return '';

  const rounded = Math.round(amount * 100) / 100;
  const decimals = Number.isInteger(rounded) ? 0 : 2;
  return `$${rounded.toFixed(decimals)}`;
}

function uniqueWarnings(warnings) {
  return Array.from(new Set(warnings));
}

function buildContext(input) {
  const warnings = [];
  const root = asPlainObject(input);

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    warnings.push('Input was not an object; honest fallback language was used.');
  }

  const business = asPlainObject(hasOwn(root, 'business') ? root.business : null);
  const services = asStringArray(hasOwn(root, 'services') ? root.services : null);
  const reviews = asPlainObject(hasOwn(root, 'reviews') ? root.reviews : null);
  const gap = asPlainObject(hasOwn(root, 'gap') ? root.gap : null);
  const proof = asPlainObject(hasOwn(root, 'proof') ? root.proof : null);
  const offer = asPlainObject(hasOwn(root, 'offer') ? root.offer : null);

  const businessName = asString(hasOwn(business, 'name') ? business.name : '');
  const reviewCount = asNonNegativeInteger(hasOwn(reviews, 'count') ? reviews.count : null);
  const serviceCount = services.length;
  const monthly = asNonNegativeNumber(hasOwn(offer, 'monthly') ? offer.monthly : null);
  const currency = hasOwn(offer, 'currency') ? offer.currency : '';
  const monthlyPrice = formatMoney(monthly, currency);
  const proofReady = hasOwn(proof, 'ready') && proof.ready === true;
  const beforeUrl = asString(hasOwn(proof, 'beforeUrl') ? proof.beforeUrl : '');
  const afterUrl = asString(hasOwn(proof, 'afterUrl') ? proof.afterUrl : '');

  if (reviewCount === null || reviewCount <= 0) {
    warnings.push('No usable review count was provided; review-count claims were omitted.');
  }

  if (serviceCount <= 0) {
    warnings.push('No usable service list was provided; service-count claims were omitted.');
  }

  if (!monthlyPrice) {
    warnings.push('No usable USD monthly price was provided; price claims were omitted.');
  }

  if (!proofReady) {
    warnings.push('Proof is not marked ready; entries point to the before/after email instead of links.');
  } else if (!beforeUrl && !afterUrl) {
    warnings.push('Proof is marked ready but no before/after link was provided.');
  }

  if (!businessName) {
    warnings.push('Business name was not provided; generic owner language was used.');
  }

  return {
    warnings: uniqueWarnings(warnings),
    businessName,
    reviewCount,
    serviceCount,
    monthlyPrice,
    proofReady,
    beforeUrl,
    afterUrl,
    gapNotes: asStringArray(hasOwn(gap, 'notes') ? gap.notes : null)
  };
}

function proofHook(context) {
  if (!context.proofReady) return 'Show the before/after email.';

  if (context.beforeUrl && context.afterUrl) {
    return `Show the before/after: ${context.beforeUrl} → ${context.afterUrl}`;
  }

  if (context.afterUrl) {
    return `Show the rebuilt mirror: ${context.afterUrl}`;
  }

  if (context.beforeUrl) {
    return `Show the current-site reference and the before/after email: ${context.beforeUrl}`;
  }

  return 'Show the before/after email.';
}

function reviewSentence(context) {
  if (context.reviewCount !== null && context.reviewCount > 0) {
    return `You already earned ${context.reviewCount} Google reviews; the site should make that trust impossible to miss.`;
  }

  return 'The site should make the trust you have earned easy for a new visitor to see.';
}

function serviceSentence(context) {
  if (context.serviceCount > 0) {
    return `With ${context.serviceCount} services listed, a clearer site helps the right customer find the right reason to call.`;
  }

  return 'A clearer site helps the right customer quickly see why they should call you.';
}

function priceSentence(context) {
  if (context.monthlyPrice) {
    return `The ongoing cost is ${context.monthlyPrice} per month, so the question is whether a clearer first impression is worth that steady investment.`;
  }

  return 'The better question is whether a clearer first impression is worth a predictable ongoing investment.';
}

function proofSentence(context) {
  if (context.proofReady) {
    return 'You do not have to decide from a promise; you can look at the rebuilt mirror first.';
  }

  return 'You do not have to decide from a promise; the before/after email gives you something concrete to review.';
}

function createEntry(id, triggers, objection, reframe, context) {
  return {
    id,
    triggers,
    objection,
    reframe,
    proofHook: proofHook(context)
  };
}

function objectionPlaybook(input) {
  try {
    const context = buildContext(input);

    const entries = [
      createEntry(
        'too-expensive',
        [
          'too expensive',
          'too pricey',
          'costs too much',
          'out of budget',
          'cant afford it',
          'expensive',
          'pricey',
          'cost',
          'afford'
        ],
        'This feels too expensive right now.',
        `${priceSentence(context)} ${proofSentence(context)}`,
        context
      ),
      createEntry(
        'already-have-web-guy',
        [
          'already have a web guy',
          'have a web guy',
          'my web guy',
          'already have someone',
          'our developer handles it',
          'web guy',
          'web designer',
          'our developer',
          'agency handles'
        ],
        'We already have someone who handles our website.',
        `That makes sense; this is not about replacing a relationship for the sake of it. ${proofSentence(context)} If the mirror is stronger, you can decide whether it gives your current person a useful benchmark.`,
        context
      ),
      createEntry(
        'nephew-handles-it',
        [
          'my nephew handles it',
          'nephew handles it',
          'my nephew does it',
          'family handles our website',
          'my son handles it',
          'nephew',
          'cousin',
          'family does',
          'brother in law'
        ],
        'My nephew handles the website.',
        `That is great when family can help. This is simply a finished, business-focused option you can compare side by side before asking anyone to change course. ${serviceSentence(context)}`,
        context
      ),
      createEntry(
        'we-get-referrals',
        [
          'we get by on referrals',
          'we live on referrals',
          'mostly referrals',
          'word of mouth',
          'we dont need leads',
          'referral'
        ],
        'We get by on referrals.',
        `${reviewSentence(context)} Referrals still tend to check you online before they call, so the site can reinforce the recommendation instead of trying to replace it.`,
        context
      ),
      createEntry(
        'ai-sites-look-cheap',
        [
          'ai sites look cheap',
          'ai websites look cheap',
          'ai looks cheap',
          'dont want an ai site',
          'robot made website',
          'ai sites',
          'template',
          'cookie cutter'
        ],
        'AI sites look cheap.',
        `That concern is fair; the standard should be whether the result feels credible to your customers, not how it was produced. ${proofSentence(context)}`,
        context
      ),
      createEntry(
        'happy-with-current-site',
        [
          'happy with our current site',
          'happy with my current site',
          'our site is fine',
          'website is fine',
          'dont need a new website',
          'site is fine',
          'works fine',
          'no need'
        ],
        'We are happy with our current website.',
        `If it is doing its job, there is no reason to force a change. ${proofSentence(context)} A side-by-side look can tell you whether the current site is still presenting the business as strongly as it could.`,
        context
      ),
      createEntry(
        'no-time',
        [
          'no time for this',
          'dont have time',
          'too busy',
          'no bandwidth',
          'cant deal with this now',
          'no time',
          'swamped'
        ],
        'I do not have time for another website project.',
        `That is exactly why the process should stay lightweight for you. ${proofSentence(context)} You can review the direction without turning this into a long project on your calendar.`,
        context
      ),
      createEntry(
        'let-me-think',
        [
          'let me think about it',
          'need to think about it',
          'ill think about it',
          'want to sleep on it',
          'get back to you',
          'think about',
          'sleep on it'
        ],
        'Let me think about it.',
        `Absolutely; a good decision does not need pressure. ${proofSentence(context)} Keep it as a simple comparison point while you decide whether it better reflects the business.`,
        context
      ),
      createEntry(
        'too-good-to-be-true',
        [
          'too good to be true',
          'sounds too good',
          'whats the catch',
          'seems too easy',
          'hard to believe',
          'too good',
          'scam'
        ],
        'This sounds too good to be true.',
        `Skepticism is reasonable, especially with marketing promises. ${proofSentence(context)} The useful next step is to judge the work itself, not the claim around it.`,
        context
      ),
      createEntry(
        'what-if-i-cancel',
        [
          'what happens if i cancel',
          'if i cancel',
          'cancel anytime',
          'cancellation policy',
          'what if we stop',
          'cancel',
          'lock in',
          'contract'
        ],
        'What happens if I cancel?',
        `That is worth clarifying before you start, and the terms should be stated plainly rather than assumed. ${priceSentence(context)} Review the before/after first, then make sure the cancellation details fit your comfort level.`,
        context
      ),
      createEntry(
        'dont-trust-ai',
        [
          'dont trust ai',
          'do not trust ai',
          'i dont trust ai',
          'ai with my business',
          'worried about ai',
          'trust ai',
          'ai slop',
          'ai junk'
        ],
        'I do not trust AI with my business.',
        `You should not hand over judgment about your business to a tool. The point is a human-reviewed presentation that you can inspect before using it. ${proofSentence(context)}`,
        context
      ),
      createEntry(
        'older-customers-call',
        [
          'customers are older',
          'older customers call',
          'they call they dont browse',
          'dont browse websites',
          'our customers just call',
          'older customers',
          'not online',
          'dont use the internet'
        ],
        'My customers are older; they call instead of browsing.',
        `A website does not replace the phone call; it gives callers and their families reassurance before they make one. ${reviewSentence(context)}`,
        context
      ),
      createEntry(
        'already-on-google',
        [
          'already on google',
          'we are on google',
          'why a website',
          'google is enough',
          'have a google business profile',
          'on google',
          'google listing',
          'gbp'
        ],
        'We are already on Google, so why do we need a website?',
        `Google helps people discover you, while a website gives them a place to understand and choose you. ${serviceSentence(context)} ${reviewSentence(context)}`,
        context
      )
    ];

    return {
      ok: true,
      entries,
      warnings: context.warnings
    };
  } catch (error) {
    return {
      ok: false,
      entries: [],
      warnings: ['Unable to build the objection playbook; honest fallback was applied.']
    };
  }
}

function refute(input, objectionText) {
  try {
    const playbook = objectionPlaybook(input);
    const normalizedText = normalizeForMatch(objectionText);

    if (!normalizedText || !playbook.ok) {
      return {
        ok: false,
        reason: 'no_match',
        warnings: playbook.ok ? [] : playbook.warnings
      };
    }

    let best = null;

    for (const entry of playbook.entries) {
      for (const trigger of entry.triggers) {
        const normalizedTrigger = normalizeForMatch(trigger);

        if (!normalizedTrigger || !normalizedText.includes(normalizedTrigger)) {
          continue;
        }

        const score = normalizedTrigger.length;

        if (!best || score > best.score) {
          best = { entry, score };
        }
      }
    }

    if (!best) {
      return { ok: false, reason: 'no_match', warnings: [] };
    }

    return {
      ok: true,
      entry: best.entry,
      warnings: playbook.warnings
    };
  } catch (error) {
    return { ok: false, reason: 'no_match', warnings: [] };
  }
}

module.exports = {
  objectionPlaybook,
  refute
};

function runTests() {
  const realisticInput = {
    business: {
      name: 'Mission Viejo Plumbing Co.',
      city: 'Mission Viejo',
      state: 'CA',
      phone: '949-555-0111',
      email: 'hello@example.com',
      website: 'https://example.com'
    },
    services: [
      'Emergency Plumbing',
      'Drain Cleaning',
      'Hydro Jetting',
      'Water Heater Repair',
      'Water Heater Installation',
      'Tankless Water Heaters',
      'Leak Detection',
      'Slab Leak Repair',
      'Sewer Line Repair',
      'Sewer Camera Inspection',
      'Toilet Repair',
      'Faucet Repair',
      'Garbage Disposal Repair',
      'Gas Line Repair',
      'Repiping',
      'Pipe Repair',
      'Fixture Installation',
      'Commercial Plumbing',
      'Backflow Testing'
    ],
    reviews: {
      count: 214,
      rating: 4.8,
      sampleQuotes: ['Fast, honest, and professional.']
    },
    gap: {
      flatnessScore: 88,
      notes: ['Outdated visual hierarchy.']
    },
    proof: {
      beforeUrl: 'https://example.com/before',
      afterUrl: 'https://example.com/after',
      ready: true
    },
    offer: {
      monthly: 149,
      setup: 0,
      currency: 'USD'
    }
  };

  const noReviewsInput = {
    ...realisticInput,
    reviews: {
      count: 0,
      rating: 0,
      sampleQuotes: []
    }
  };

  const hostileInput = JSON.parse(
    '{"business":null,"services":[null,42,{}],"reviews":{"count":null,"__proto__":{"polluted":true}},"proof":{"ready":null},"offer":{"monthly":"149","currency":"USD"},"__proto__":{"polluted":true}}'
  );

  const tests = [
    {
      name: 'full input creates 13 entries with referrals review count and zero warnings',
      run() {
        const result = objectionPlaybook(realisticInput);
        const referrals = result.entries.find((entry) => entry.id === 'we-get-referrals');

        return result.ok === true &&
          result.entries.length === 13 &&
          referrals &&
          referrals.reframe.includes('214') &&
          result.warnings.length === 0;
      }
    },
    {
      name: 'zero reviews omits review count and produces warnings',
      run() {
        const result = objectionPlaybook(noReviewsInput);

        return result.ok === true &&
          result.entries.length === 13 &&
          result.warnings.length > 0 &&
          result.entries.every((entry) => !/\b214\b/.test(entry.reframe));
      }
    },
    {
      name: 'refute matches too pricey',
      run() {
        const result = refute(realisticInput, "That's too pricey for us");
        return result.ok === true && result.entry.id === 'too-expensive';
      }
    },
    {
      name: 'refute ignores case punctuation and whitespace',
      run() {
        const result = refute(realisticInput, 'TOO   PRICEY!!!');
        return result.ok === true && result.entry.id === 'too-expensive';
      }
    },
    {
      name: 'refute catches nephew handles our website',
      run() {
        const result = refute(realisticInput, 'my nephew handles our website');
        return result.ok === true && result.entry.id === 'nephew-handles-it';
      }
    },
    {
      name: 'refute catches cousin family website phrasing',
      run() {
        const result = refute(realisticInput, 'my cousins son does our site');
        return result.ok === true && result.entry.id === 'nephew-handles-it';
      }
    },
    {
      name: 'refute catches word of mouth referrals',
      run() {
        const result = refute(realisticInput, 'we live on word of mouth referrals');
        return result.ok === true && result.entry.id === 'we-get-referrals';
      }
    },
    {
      name: 'refute catches too-good-to-be-true scam phrasing',
      run() {
        const result = refute(realisticInput, 'sounds like a scam whats the catch');
        return result.ok === true && result.entry.id === 'too-good-to-be-true';
      }
    },
    {
      name: 'refute catches developer handles it',
      run() {
        const result = refute(realisticInput, 'our developer handles it');
        return result.ok === true && result.entry.id === 'already-have-web-guy';
      }
    },
    {
      name: 'refute returns no_match for unrelated text',
      run() {
        const result = refute(realisticInput, 'do you sell fishing licenses');
        return result.ok === false && result.reason === 'no_match';
      }
    },
    {
      name: 'empty input never throws or invents numeric claims',
      run() {
        const result = objectionPlaybook({});

        return (result.ok === false || result.entries.length === 13) &&
          result.entries.every((entry) => !/\b\d+\b/.test(entry.reframe));
      }
    },
    {
      name: 'hostile input never throws or pollutes prototypes',
      run() {
        const before = ({}).polluted;
        const result = objectionPlaybook(hostileInput);
        const refuted = refute(hostileInput, 'too pricey');
        const after = ({}).polluted;

        return before === undefined &&
          after === undefined &&
          result.entries.length === 13 &&
          refuted.ok === true &&
          refuted.entry.id === 'too-expensive';
      }
    },
    {
      name: 'proof hook uses links when proof is ready',
      run() {
        const result = objectionPlaybook(realisticInput);

        return result.entries.every((entry) => {
          return entry.proofHook.includes('https://example.com/before') &&
            entry.proofHook.includes('https://example.com/after');
        });
      }
    },
    {
      name: 'proof hook falls back to email when proof is not ready',
      run() {
        const input = {
          ...realisticInput,
          proof: {
            beforeUrl: '',
            afterUrl: '',
            ready: false
          }
        };

        const result = objectionPlaybook(input);

        return result.entries.every((entry) => {
          return entry.proofHook === 'Show the before/after email.';
        });
      }
    }
  ];

  let failed = false;

  for (const test of tests) {
    let passed = false;

    try {
      passed = test.run() === true;
    } catch (error) {
      passed = false;
    }

    if (!passed) failed = true;
    process.stdout.write(`${passed ? 'PASS' : 'FAIL'}: ${test.name}\n`);
  }

  process.exitCode = failed ? 1 : 0;
}

if (require.main === module && process.argv.includes('--test')) {
  runTests();
}
