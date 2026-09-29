// lib/email/renderer-registry.cjs — one door to the three client-lifecycle
// renderers (onboarding / monthly / followup), STAGED: no send path calls this
// yet. WHEN a send path wires it, the caller must supply the SIGNED unsubscribe
// URL (lib/unsubscribe.js) on the adapted data — the /u/<client_id> fallback
// below exists only so staged renders are complete documents, mirroring the
// rule enforced in lib/email/compose-v2-switch.cjs.
'use strict';

const { renderOnboarding } = require('./onboarding-email-pack.cjs');
const { renderMonthlyReport } = require('./monthly-value-report.cjs');
const { plan, renderFollowup } = require('./followup-sequencer.cjs');

const { toOnboardingData } = require('./adapt-onboarding.cjs');
const { toMonthlyReportData } = require('./adapt-monthly.cjs');
const { toFollowupInputs } = require('./adapt-followup.cjs');

const KINDS = Object.freeze(['onboarding', 'monthly', 'followup']);

function listKinds() {
  return [...KINDS];
}

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;

  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown renderer error';
  }
}

function ensureUnsubscribeUrl(data, record) {
  if (!data || typeof data !== 'object') {
    throw new TypeError('Adapter must return an object');
  }

  if (data.unsubscribeUrl == null) {
    if (!record || record.client_id == null || String(record.client_id).trim() === '') {
      throw new Error('record.client_id is required to build unsubscribeUrl');
    }

    data.unsubscribeUrl =
      'https://wss-ai.com/u/' + encodeURIComponent(String(record.client_id));
  }

  return data;
}

function normalizeRendered(rendered, kind) {
  if (!rendered || typeof rendered !== 'object') {
    throw new TypeError(`${kind} renderer must return an object`);
  }

  return {
    html: rendered.html,
    text: rendered.text,
    subject: rendered.subject,
    kind,
  };
}

function getFollowupParts(inputs) {
  if (!inputs || typeof inputs !== 'object') {
    throw new TypeError('Followup adapter must return an object');
  }

  /*
   * Preferred adapter contract:
   *   { sentRecord, data }
   *
   * Also accepts explicit descriptive aliases so this registry remains a
   * thin integration boundary rather than coupling to one property spelling.
   */
  const sentRecord =
    inputs.sentRecord ??
    inputs.sent ??
    inputs.planInput ??
    inputs.sentLog;

  const data =
    inputs.data ??
    inputs.renderData ??
    inputs.followupData;

  if (!sentRecord || typeof sentRecord !== 'object') {
    throw new Error('Followup adapter did not return sentRecord');
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Followup adapter did not return render data');
  }

  return { sentRecord, data };
}

function resolveFollowupStep(planned) {
  if (planned == null || planned === false) {
    throw new Error('No followup is currently planned');
  }

  if (typeof planned === 'number' || typeof planned === 'string') {
    return planned;
  }

  if (typeof planned === 'object') {
    const step =
      planned.step ??
      planned.followupStep ??
      planned.nextStep;

    if (step != null) return step;
  }

  throw new Error('Followup plan did not return a step');
}

function renderForProspect(kind, record, extra = {}) {
  try {
    if (!KINDS.includes(kind)) {
      throw new Error(`Unknown renderer kind: ${String(kind)}`);
    }

    if (!record || typeof record !== 'object') {
      throw new TypeError('record must be an object');
    }

    if (!extra || typeof extra !== 'object') {
      throw new TypeError('extra must be an object');
    }

    if (kind === 'onboarding') {
      const step = Number(extra.step);

      if (!Number.isInteger(step) || step < 1 || step > 3) {
        throw new Error('onboarding requires extra.step between 1 and 3');
      }

      const data = ensureUnsubscribeUrl(
        toOnboardingData(record, step),
        record
      );

      return normalizeRendered(
        renderOnboarding(step, data),
        kind
      );
    }

    if (kind === 'monthly') {
      const data = ensureUnsubscribeUrl(
        toMonthlyReportData(record, extra.statsRow),
        record
      );

      return normalizeRendered(
        renderMonthlyReport(data),
        kind
      );
    }

    const inputs = toFollowupInputs(record, extra.sentLog);
    const { sentRecord, data } = getFollowupParts(inputs);

    ensureUnsubscribeUrl(data, record);

    const planned = plan(sentRecord, extra.now);
    const step = resolveFollowupStep(planned);

    return normalizeRendered(
      renderFollowup(step, data),
      kind
    );
  } catch (error) {
    return {
      error: errorMessage(error),
      kind,
    };
  }
}

module.exports = {
  renderForProspect,
  listKinds,
};
