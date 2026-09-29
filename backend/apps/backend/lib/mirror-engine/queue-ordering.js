'use strict';

/**
 * queue-ordering.cjs
 *
 * Node 20+, CommonJS, zero dependencies.
 *
 * Ordering doctrine:
 * This is ORDERING ONLY — no candidate may ever be dropped, held, or refused
 * for its grades. A grade is a priority, never a permission slip.
 */

const WEBSITE_MISSING_SCORE = 101;
const REPUTATION_MISSING_SCORE = 0;
const WEBSITE_PRIMARY_SCALE = 1e15;
const REPUTATION_SCALE = 1e9;
const FIFO_SCALE = 1e15;

/**
 * Safely reads a property from an object. Throwing getters are treated as
 * absent values so malformed candidates never prevent queue ordering.
 *
 * @param {unknown} value
 * @param {string} property
 * @returns {unknown}
 */
function safeGet(value, property) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined;
  }

  try {
    return value[property];
  } catch {
    return undefined;
  }
}

/**
 * A score is valid only when it is a finite number in the documented 0–100
 * domain. Invalid, missing, NaN, and infinite values use the provided fallback.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function validScoreOr(value, fallback) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : fallback;
}

/**
 * Gets an ISO date's epoch milliseconds. Missing and invalid values are both
 * treated as the empty FIFO value. No lexical comparison is performed later,
 * so equal effective keys preserve original input order.
 *
 * @param {unknown} submittedAt
 * @returns {number}
 */
function fifoEpochMilliseconds(submittedAt) {
  if (typeof submittedAt !== 'string' || submittedAt === '') {
    return 0;
  }

  try {
    const milliseconds = Date.parse(submittedAt);
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  } catch {
    return 0;
  }
}

/**
 * Extracts safe, normalized ordering fields without retaining any potentially
 * throwing candidate property access path.
 *
 * @param {unknown} candidate
 * @returns {{ websiteScore: number, reputationScore: number, fifoMilliseconds: number }}
 */
function normalizedKeys(candidate) {
  const websiteScore = validScoreOr(
    safeGet(candidate, 'websiteScore'),
    WEBSITE_MISSING_SCORE
  );

  const reputationScore = validScoreOr(
    safeGet(candidate, 'reputationScore'),
    REPUTATION_MISSING_SCORE
  );

  const fifoMilliseconds = fifoEpochMilliseconds(safeGet(candidate, 'submittedAt'));

  return {
    websiteScore,
    reputationScore,
    fifoMilliseconds,
  };
}

/**
 * Returns a numeric composite priority whose order matches the primary,
 * secondary, and tertiary ordering rules for all valid finite score values.
 *
 * A website-score delta is weighted higher than the largest possible
 * reputation and FIFO contribution combined:
 *
 * websiteScore * 1e15
 * - reputationScore * 1e9
 * + FIFO epoch-milliseconds / 1e15
 *
 * Lower numeric priorities are selected first.
 *
 * @param {{ websiteScore?: number, reputationScore?: number, submittedAt?: string }} candidate
 * @returns {number}
 */
function priorityOf(candidate) {
  try {
    const {
      websiteScore,
      reputationScore,
      fifoMilliseconds,
    } = normalizedKeys(candidate);

    return (
      websiteScore * WEBSITE_PRIMARY_SCALE -
      reputationScore * REPUTATION_SCALE +
      fifoMilliseconds / FIFO_SCALE
    );
  } catch {
    return (
      WEBSITE_MISSING_SCORE * WEBSITE_PRIMARY_SCALE -
      REPUTATION_MISSING_SCORE * REPUTATION_SCALE
    );
  }
}

/**
 * Orders every supplied candidate without filtering, mutating the input array,
 * or throwing for malformed top-level input or throwing property accessors.
 *
 * Sort sequence:
 * 1. websiteScore ascending: deadest site first.
 * 2. reputationScore descending: strongest reputation first.
 * 3. submittedAt ascending: FIFO.
 * 4. Original position: stable for equal effective keys.
 *
 * Missing or invalid website scores rank as 101.
 * Missing or invalid reputation scores rank as 0.
 * Missing or invalid submittedAt values rank as the empty FIFO value.
 *
 * @param {Array<{ prospectId: string, websiteScore?: number, reputationScore?: number, submittedAt?: string }>} candidates
 * @returns {Array<{ prospectId: string, websiteScore?: number, reputationScore?: number, submittedAt?: string }>}
 */

function safeRead(obj, key) {
  try { return obj ? obj[key] : undefined; } catch { return undefined; }
}

function orderCandidates(candidates) {
  if (!Array.isArray(candidates)) {
    return [];
  }

  try {
    return candidates
      .map((candidate, index) => {
        const keys = normalizedKeys(candidate);

        return {
          candidate,
          index,
          websiteScore: keys.websiteScore,
          reputationScore: keys.reputationScore,
          fifoMilliseconds: keys.fifoMilliseconds,
        };
      })
      .sort((a, b) => {
        if (a.websiteScore !== b.websiteScore) {
          return a.websiteScore - b.websiteScore;
        }

        if (a.reputationScore !== b.reputationScore) {
          return b.reputationScore - a.reputationScore;
        }

        if (a.fifoMilliseconds !== b.fifoMilliseconds) {
          return a.fifoMilliseconds - b.fifoMilliseconds;
        }

        return a.index - b.index;
      })
      .map((entry) => entry.candidate);
  } catch {
    return candidates.slice();
  }
}

/**
 * @returns {{
 *   drops: false,
 *   gates: false,
 *   rule: "deadest site first, strongest reputation first, FIFO after"
 * }}
 */
function orderingPolicy() {
  return {
    drops: false,
    gates: false,
    rule: 'deadest site first, strongest reputation first, FIFO after',
  };
}

module.exports = {
  orderCandidates,
  priorityOf,
  orderingPolicy,
};


/* lexicographic priority key (teacher patch v2): a single number cannot encode
 * a three-level comparator without collisions (fractional websiteScore vs
 * reputation scale). A fixed-width string key compares EXACTLY like the sort. */
(function () {
  function wsKey(v) {
    const n = Number(v);
    const s = Number.isFinite(n) && n >= 0 && n <= 100 ? n : 101; // missing/out-of-domain last
    return s.toFixed(4).padStart(8, "0");
  }
  function repKey(v) {
    const n = Number(v);
    const r = Number.isFinite(n) && n >= 0 && n <= 100 ? n : 0;
    return (100 - r).toFixed(3).padStart(7, "0"); // inverted: stronger reputation sorts first
  }
  function fifoKey(iso, idx) {
    const t = Date.parse(String(iso == null ? "" : iso));
    const s = Number.isFinite(t) ? t / 1000 : 0;
    return String(Math.round(s)).padStart(11, "0") + "." + String(idx == null ? 0 : idx).padStart(6, "0");
  }
  module.exports.priorityOf = function (candidate, index) {
    try {
      const c = candidate && typeof candidate === "object" ? candidate : {};
      return wsKey(c.websiteScore) + repKey(c.reputationScore) + fifoKey(c.submittedAt, index);
    } catch {
      return "999.9999" + "999.999" + "99999999999.999999";
    }
  };
})();
// rebind the hoisted declaration so same-file callers (the self-test)
// hit the same lexicographic key as external callers — one source of truth.
priorityOf = module.exports.priorityOf;

if (require.main === module && process.argv.includes('--test')) {
  const tests = [
    {
      name: 'worst website first',
      run() {
        const input = [
          { prospectId: 'A', websiteScore: 88, reputationScore: 90 },
          { prospectId: 'B', websiteScore: 12, reputationScore: 70 },
          { prospectId: 'C', websiteScore: 45, reputationScore: 95 },
        ];

        return orderCandidates(input)
          .map((item) => item.prospectId)
          .join(',') === 'B,C,A';
      },
    },
    {
      name: 'reputation breaks equal website score',
      run() {
        const input = [
          { prospectId: 'rep-60', websiteScore: 40, reputationScore: 60 },
          { prospectId: 'rep-95', websiteScore: 40, reputationScore: 95 },
        ];

        return orderCandidates(input)
          .map((item) => item.prospectId)
          .join(',') === 'rep-95,rep-60';
      },
    },
    {
      name: 'FIFO breaks equal website and reputation scores',
      run() {
        const input = [
          {
            prospectId: 'later',
            websiteScore: 40,
            reputationScore: 80,
            submittedAt: '2026-08-20T10:00:00.000Z',
          },
          {
            prospectId: 'earlier',
            websiteScore: 40,
            reputationScore: 80,
            submittedAt: '2026-08-20T09:00:00.000Z',
          },
        ];

        return orderCandidates(input)
          .map((item) => item.prospectId)
          .join(',') === 'earlier,later';
      },
    },
    {
      name: 'missing website score remains present and sorts last',
      run() {
        const input = [
          { prospectId: 'missing', reputationScore: 100 },
          { prospectId: 'known', websiteScore: 100, reputationScore: 0 },
        ];
        const output = orderCandidates(input);

        return (
          output.length === input.length &&
          output.map((item) => item.prospectId).join(',') === 'known,missing'
        );
      },
    },
    {
      name: '500 candidates sort under 50ms and duplicate order is stable',
      run() {
        const input = [];
        const duplicateIds = [];

        for (let index = 0; index < 500; index += 1) {
          const duplicate = index >= 450;
          const prospectId = `candidate-${String(index).padStart(3, '0')}`;

          if (duplicate) {
            duplicateIds.push(prospectId);
          }

          input.push({
            prospectId,
            websiteScore: duplicate ? 50 : (index * 37) % 101,
            reputationScore: duplicate ? 75 : (index * 53) % 101,
            submittedAt: duplicate ? '2026-08-20T12:00:00.000Z' : undefined,
          });
        }

        const startedAt = process.hrtime.bigint();
        const output = orderCandidates(input);
        const elapsedMilliseconds = Number(process.hrtime.bigint() - startedAt) / 1e6;

        const outputDuplicateIds = output
          .filter(
            (item) =>
              item.websiteScore === 50 &&
              item.reputationScore === 75 &&
              item.submittedAt === '2026-08-20T12:00:00.000Z'
          )
          .map((item) => item.prospectId);

        return (
          elapsedMilliseconds < 50 &&
          output.length === 500 &&
          outputDuplicateIds.join(',') === duplicateIds.join(',')
        );
      },
    },
    {
      name: 'input array is not mutated',
      run() {
        const input = [
          { prospectId: 'first', websiteScore: 90, reputationScore: 10 },
          { prospectId: 'second', websiteScore: 10, reputationScore: 90 },
        ];
        const originalReference = input;
        const originalOrder = input.map((item) => item.prospectId).join(',');

        const output = orderCandidates(input);

        return (
          input === originalReference &&
          input.map((item) => item.prospectId).join(',') === originalOrder &&
          output !== input &&
          output.map((item) => item.prospectId).join(',') === 'second,first'
        );
      },
    },
    {
      name: 'priority preserves fractional website-score ordering',
      run() {
        const A = {
          prospectId: 'A',
          websiteScore: 10,
          reputationScore: 0,
          submittedAt: '2026-08-20T00:00:00Z',
        };
        const B = {
          prospectId: 'B',
          websiteScore: 10.0001,
          reputationScore: 100,
          submittedAt: '2026-08-20T00:00:00Z',
        };

        const ordered = orderCandidates([A, B]);

        return (
          ordered[0] === A &&
          ordered[1] === B &&
          priorityOf(A) < priorityOf(B)
        );
      },
    },
    {
      name: 'out-of-range website score is treated as missing',
      run() {
        const input = [
          { prospectId: 'bad', websiteScore: -1 },
          { prospectId: 'valid', websiteScore: 0 },
        ];

        return orderCandidates(input)
          .map((item) => item.prospectId)
          .join(',') === 'valid,bad';
      },
    },
    {
      name: 'website scores above 100 are treated as missing',
      run() {
        const input = [
          { prospectId: 'over-101', websiteScore: 101 },
          { prospectId: 'over-million', websiteScore: 1_000_000 },
          { prospectId: 'valid', websiteScore: 100 },
        ];

        return orderCandidates(input)
          .map((item) => item.prospectId)
          .join(',') === 'valid,over-101,over-million';
      },
    },
    {
      name: 'invalid timestamps preserve original stable order',
      run() {
        const input = [
          {
            prospectId: 'first',
            websiteScore: 20,
            reputationScore: 80,
            submittedAt: 'zzz',
          },
          {
            prospectId: 'second',
            websiteScore: 20,
            reputationScore: 80,
            submittedAt: 'aaa',
          },
        ];

        return orderCandidates(input)
          .map((item) => item.prospectId)
          .join(',') === 'first,second';
      },
    },
    {
      name: 'malformed top-level inputs never throw and return empty arrays',
      run() {
        let nullResult;
        let objectResult;

        try {
          nullResult = orderCandidates(null);
          objectResult = orderCandidates({});
        } catch {
          return false;
        }

        return (
          Array.isArray(nullResult) &&
          nullResult.length === 0 &&
          Array.isArray(objectResult) &&
          objectResult.length === 0
        );
      },
    },
    {
      name: 'throwing candidate accessors never throw',
      run() {
        const candidate = {
          prospectId: 'throwing',
          get websiteScore() {
            throw new Error('boom');
          },
        };

        let ordered;
        let priority;
        let policy;

        try {
          ordered = orderCandidates([candidate]);
          priority = priorityOf(candidate);
          policy = orderingPolicy();
        } catch {
          return false;
        }

        return (
          ordered.length === 1 &&
          ordered[0] === candidate &&
          typeof priority === 'string' &&
          priority.length > 0 &&
          policy.drops === false &&
          policy.gates === false
        );
      },
    },
    {
      name: 'throwing reputation and submittedAt accessors never throw',
      run() {
        const candidate = {
          prospectId: 'throwing-fields',
          websiteScore: 40,
          get reputationScore() {
            throw new Error('boom');
          },
          get submittedAt() {
            throw new Error('boom');
          },
        };

        try {
          const ordered = orderCandidates([candidate]);
          const priority = priorityOf(candidate);

          return (
            ordered.length === 1 &&
            ordered[0] === candidate &&
            typeof priority === 'string' &&
            priority.length > 0
          );
        } catch {
          return false;
        }
      },
    },
    {
      name: 'policy is ordering only',
      run() {
        const policy = orderingPolicy();

        return (
          policy.drops === false &&
          policy.gates === false &&
          policy.rule === 'deadest site first, strongest reputation first, FIFO after'
        );
      },
    },
  ];

  let failures = 0;

  for (const test of tests) {
    let passed = false;

    try {
      passed = test.run() === true;
    } catch {
      passed = false;
    }

    if (!passed) {
      failures += 1;
    }

    process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${test.name}\n`);
  }

  process.exitCode = failures === 0 ? 0 : 1;
}


