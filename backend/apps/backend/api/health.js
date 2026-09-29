const { methodGuard, sendJson } = require("../lib/http");
const { SYSTEMS, providerStatus, publicConfig } = require("../lib/registry");
const { getBillingReadiness } = require("../lib/billing-readiness");
const { probeIntakeGenie } = require("../lib/intake-genie-client");
const { probeVapiHealth } = require("../lib/mission-control-customer");

const bootedAt = new Date().toISOString();

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  await probeIntakeGenie();
  const providers = providerStatus();
  const voiceHealth = await probeVapiHealth();
  providers.vapi = { ...providers.vapi, ...voiceHealth };
  sendJson(res, 200, {
    ok: true,
    service: "woodward-local-growth-integration-hub",
    productBoundary:
      "Thin orchestration spine. Existing Woodward products remain the source systems.",
    timestamp: new Date().toISOString(),
    deployment: {
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA || "",
      gitRef: process.env.VERCEL_GIT_COMMIT_REF || "",
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || "",
      vercelEnv: process.env.VERCEL_ENV || "",
      bootedAt,
    },
    config: publicConfig(),
    providers,
    billing: (() => {
      const readiness = getBillingReadiness();
      return {
        ready: readiness.ready,
        publicCheckoutEnabled: readiness.publicCheckoutEnabled,
        blockers: readiness.blockers,
      };
    })(),
    systems: SYSTEMS,
  });
};
