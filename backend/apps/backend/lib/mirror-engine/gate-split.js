'use strict';

/**
 * gate-policy.cjs
 *
 * Node 20+, CommonJS, zero dependencies.
 */

const TRUTH_CHECK_NAMES = Object.freeze([
  'client_isolation',
  'alias_target',
  'contact_accuracy',
  'deep_link',
]);

const POLISH_CHECK_NAMES = [
  'prose',
  'hero_measure',
  'service_floor',
  'tap_targets',
  'asset_diff',
];

const TRUTH_CHECK_SET = new Set(TRUTH_CHECK_NAMES);
const POLISH_CHECK_SET = new Set(POLISH_CHECK_NAMES);

function safeOwnPropertyNames(value) {
  try {
    return Object.getOwnPropertyNames(value);
  } catch {
    return [];
  }
}

function safeGetOwnDescriptor(value, name) {
  try {
    return Object.getOwnPropertyDescriptor(value, name);
  } catch {
    return null;
  }
}

function safeReadDataProperty(value, name) {
  const descriptor = safeGetOwnDescriptor(value, name);

  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    return { readable: false, value: undefined };
  }

  return { readable: true, value: descriptor.value };
}

function safeReadCheck(check) {
  if (!check || typeof check !== 'object' || Array.isArray(check)) {
    return {
      status: undefined,
      cause: undefined,
    };
  }

  const statusResult = safeReadDataProperty(check, 'status');
  const causeResult = safeReadDataProperty(check, 'cause');

  return {
    status: statusResult.readable ? statusResult.value : undefined,
    cause:
      causeResult.readable && typeof causeResult.value === 'string'
        ? causeResult.value
        : undefined,
  };
}

function truthFailure(name, cause) {
  return {
    name,
    cause: typeof cause === 'string' ? cause : 'missing_or_invalid_truth_evidence',
  };
}

/**
 * Classify production reveal-gate checks.
 *
 * All truth checks require explicit own-property evidence with status "passed".
 * Any missing, malformed, unreadable, inherited-only, or failed truth check
 * refuses reveal. Polish checks never affect revealability.
 *
 * @param {unknown} checks
 * @returns {{
 *   revealable: boolean,
 *   truthFailures: Array<{name: string, cause: string}>,
 *   polishFlags: Array<{name: string, cause: string|undefined}>
 * }}
 */
function classifyChecks(checks) {
  const result = {
    revealable: true,
    truthFailures: [],
    polishFlags: [],
  };

  const validTopLevel =
    checks !== null &&
    typeof checks === 'object' &&
    !Array.isArray(checks);

  if (!validTopLevel) {
    for (const name of TRUTH_CHECK_NAMES) {
      result.truthFailures.push(
        truthFailure(name, 'invalid_or_missing_checks')
      );
    }

    result.revealable = false;
    return result;
  }

  const ownNames = safeOwnPropertyNames(checks);
  const ownNameSet = new Set(ownNames);

  for (const name of TRUTH_CHECK_NAMES) {
    if (!ownNameSet.has(name)) {
      result.truthFailures.push(truthFailure(name));
      continue;
    }

    const checkResult = safeReadDataProperty(checks, name);
    const check = safeReadCheck(checkResult.value);

    if (!checkResult.readable || check.status !== 'passed') {
      result.truthFailures.push(truthFailure(name, check.cause));
    }
  }

  for (const name of ownNames) {
    if (TRUTH_CHECK_SET.has(name)) {
      continue;
    }

    const checkResult = safeReadDataProperty(checks, name);
    const check = safeReadCheck(checkResult.value);

    if (POLISH_CHECK_SET.has(name)) {
      if (!checkResult.readable || check.status !== 'passed') {
        result.polishFlags.push({
          name,
          cause: check.cause,
        });
      }
      continue;
    }

    result.polishFlags.push({
      name,
      cause: 'unknown_check',
    });
  }

  result.revealable = result.truthFailures.length === 0;
  return result;
}

function policySummary() {
  return {
    refuseOn: TRUTH_CHECK_NAMES,
    flagOnly: POLISH_CHECK_NAMES,
    doctrine: 'light audit, get out on the road',
  };
}

module.exports = {
  TRUTH_CHECK_NAMES,
  POLISH_CHECK_NAMES,
  classifyChecks,
  policySummary,
};

if (require.main === module && process.argv.includes('--test')) {
  const allTruthPassed = {
    client_isolation: { status: 'passed' },
    alias_target: { status: 'passed' },
    contact_accuracy: { status: 'passed' },
    deep_link: { status: 'passed' },
  };

  const tests = [
    {
      name: 'PASS explicit passing truth evidence reveals',
      run() {
        const result = classifyChecks(allTruthPassed);

        return (
          result.revealable === true &&
          result.truthFailures.length === 0 &&
          result.polishFlags.length === 0
        );
      },
    },
    {
      name: 'PASS polish failures flag without refusal when all truth passes',
      run() {
        const result = classifyChecks({
          ...allTruthPassed,
          prose: {
            status: 'failed',
            cause: 'broken_prose: line ends with connector',
          },
          hero_measure: {
            status: 'failed',
            cause: 'donor_hero_unmeasured',
          },
        });

        return (
          result.revealable === true &&
          result.truthFailures.length === 0 &&
          result.polishFlags.length === 2 &&
          result.polishFlags[0].name === 'prose' &&
          result.polishFlags[1].name === 'hero_measure'
        );
      },
    },
    {
      name: 'FAIL client_isolation failure refuses despite passed polish',
      run() {
        const result = classifyChecks({
          ...allTruthPassed,
          client_isolation: {
            status: 'failed',
            cause: 'cross_client_data_detected',
          },
          prose: { status: 'passed' },
          hero_measure: { status: 'passed' },
          service_floor: { status: 'passed' },
          tap_targets: { status: 'passed' },
          asset_diff: { status: 'passed' },
        });

        return (
          result.revealable === false &&
          result.truthFailures.length === 1 &&
          result.truthFailures[0].name === 'client_isolation' &&
          result.truthFailures[0].cause === 'cross_client_data_detected' &&
          result.polishFlags.length === 0
        );
      },
    },
    {
      name: 'PASS missing service_floor is a flag without refusal',
      run() {
        const result = classifyChecks({
          ...allTruthPassed,
          service_floor: {
            status: 'missing',
            cause: 'service_floor: no service list recorded',
          },
        });

        return (
          result.revealable === true &&
          result.truthFailures.length === 0 &&
          result.polishFlags.length === 1 &&
          result.polishFlags[0].name === 'service_floor'
        );
      },
    },
    {
      name: 'FAIL missing alias_target refuses',
      run() {
        const { alias_target, ...checks } = allTruthPassed;
        const result = classifyChecks(checks);

        return (
          result.revealable === false &&
          result.truthFailures.length === 1 &&
          result.truthFailures[0].name === 'alias_target'
        );
      },
    },
    {
      name: 'FAIL partial truth evidence refuses absent required truth checks',
      run() {
        const result = classifyChecks({
          client_isolation: { status: 'passed' },
        });

        return (
          result.revealable === false &&
          result.truthFailures.length === 3 &&
          result.truthFailures[0].name === 'alias_target' &&
          result.truthFailures[1].name === 'contact_accuracy' &&
          result.truthFailures[2].name === 'deep_link'
        );
      },
    },
    {
      name: 'FAIL empty checks refuses all missing truth checks',
      run() {
        const result = classifyChecks({});

        return (
          result.revealable === false &&
          result.truthFailures.length === 4 &&
          result.polishFlags.length === 0
        );
      },
    },
    {
      name: 'FAIL malformed top-level inputs fail closed without throwing',
      run() {
        const values = [null, undefined, 'bad', 42, [], true];

        return values.every((value) => {
          const result = classifyChecks(value);

          return (
            result.revealable === false &&
            result.truthFailures.length === 4 &&
            result.truthFailures.every(
              (failure) => failure.cause === 'invalid_or_missing_checks'
            )
          );
        });
      },
    },
    {
      name: 'PASS unknown failed check creates unknown_check flag',
      run() {
        const result = classifyChecks({
          ...allTruthPassed,
          future_thing: {
            status: 'failed',
            cause: 'implementation detail',
          },
        });

        return (
          result.revealable === true &&
          result.truthFailures.length === 0 &&
          result.polishFlags.length === 1 &&
          result.polishFlags[0].name === 'future_thing' &&
          result.polishFlags[0].cause === 'unknown_check'
        );
      },
    },
    {
      name: 'FAIL enumerable throwing getter never throws and fails closed',
      run() {
        const checks = {};
        Object.defineProperty(checks, 'client_isolation', {
          enumerable: true,
          get() {
            throw new Error('boom');
          },
        });

        const result = classifyChecks(checks);

        return (
          result.revealable === false &&
          result.truthFailures.length === 4 &&
          result.truthFailures[0].name === 'client_isolation'
        );
      },
    },
    {
      name: 'FAIL hostile ownKeys proxy never throws and fails closed',
      run() {
        const checks = new Proxy(
          {},
          {
            ownKeys() {
              throw new Error('boom');
            },
          }
        );

        const result = classifyChecks(checks);

        return (
          result.revealable === false &&
          result.truthFailures.length === 4 &&
          result.polishFlags.length === 0
        );
      },
    },
    {
      name: 'FAIL inherited failed truth evidence does not authorize reveal',
      run() {
        const checks = Object.create({
          client_isolation: {
            status: 'failed',
            cause: 'cross_client_data_detected',
          },
        });

        const result = classifyChecks(checks);

        return (
          result.revealable === false &&
          result.truthFailures.length === 4 &&
          result.truthFailures[0].name === 'client_isolation'
        );
      },
    },
    {
      name: 'PASS policy summary matches doctrine',
      run() {
        const summary = policySummary();

        return (
          summary.refuseOn === TRUTH_CHECK_NAMES &&
          summary.flagOnly === POLISH_CHECK_NAMES &&
          summary.doctrine === 'light audit, get out on the road'
        );
      },
    },
  ];

  let failed = false;

  for (const test of tests) {
    let passed = false;

    try {
      passed = test.run() === true;
    } catch {
      passed = false;
    }

    if (!passed) {
      failed = true;
    }

    process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${test.name}\n`);
  }

  process.exitCode = failed ? 1 : 0;
}
