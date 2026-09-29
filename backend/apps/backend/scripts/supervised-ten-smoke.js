"use strict";

const { runFullSystem } = require("../lib/full-run");

async function main() {
  const live = process.argv.includes("--live");
  const category = process.env.SMOKE_CATEGORY || "landscaping";
  const location = process.env.SMOKE_LOCATION || "Orange County, CA";
  const count = Number(process.env.SMOKE_COUNT || "10");
  const result = await runFullSystem({
    category,
    location,
    count,
    dryRun: !live,
    runId: `${live ? "live" : "dry"}_supervised_10_${Date.now()}`,
  });
  const summary = {
    ok: result.ok,
    runId: result.runId,
    dryRun: result.dryRun,
    category: result.category,
    location: result.location,
    stage: result.stage,
    error: result.error,
    message: result.message,
    plan: result.plan && {
      found: result.plan.found,
      deduped: result.plan.deduped,
      selected: result.plan.selected,
      wouldBuild: result.plan.wouldBuild,
      wouldSend: result.plan.wouldSend,
      callOrSms: result.plan.callOrSms,
    },
    mined: result.mined,
    scored: result.scored,
    queued: result.queued,
    sent: Array.isArray(result.sent) ? result.sent.length : result.sent,
    skipped: Array.isArray(result.skipped) ? result.skipped : undefined,
    built: Array.isArray(result.built)
      ? result.built.map((item) => ({
          prospect_id: item.prospect_id,
          business_name: item.business_name,
          ok: item.ok,
          status: item.status,
          preview_url: item.preview_url || null,
          report_url: item.report_url || null,
          checkout_url: item.checkout_url || null,
          renderer: item.renderer || null,
          qc_passed: Boolean(item.qc_passed),
          blocked: item.blocked || null,
        }))
      : undefined,
    selected: Array.isArray(result.selected)
      ? result.selected.slice(0, 10).map((item) => ({
          prospect_id: item.prospect_id,
          business_name: item.business_name,
          hasEmail: item.hasEmail,
          score: item.score,
          localPlan: item.localPlan?.status || "",
        }))
      : undefined,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
