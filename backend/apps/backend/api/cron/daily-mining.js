const { requireCron } = require("../../lib/cron-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { mineLeads, parseCsv } = require("../../lib/lead-miner");
const { providerStatus } = require("../../lib/registry");
const { fillBankFromMining } = require("../../lib/prospect-bank");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireCron(req, res)) return;

  try {
    const body = req.method === "POST" ? await readJson(req).catch(() => ({})) : {};
    const result = await mineLeads({
      verticals: body.verticals || parseCsv(process.env.GHOST_AGENCY_DAILY_MINING_VERTICALS),
      metros: body.metros || parseCsv(process.env.GHOST_AGENCY_DAILY_MINING_METROS),
      limit: body.limit || process.env.GHOST_AGENCY_DAILY_MINING_LIMIT || 25,
      actor: "agent_01_prospect_miner",
      trigger: "scheduled_cron",
    });

    // PROSPECT BANK — FILLER (owner doctrine 2026-09-02): every 4h sweep also
    // compiles (receipt-first) and banks freshly mined rows across trades
    // until each vertical reaches GHOST_AGENCY_BANK_TARGET_PER_VERTICAL
    // (default 25). Capped and best-effort: a filler failure never fails the
    // cron lane's existing mining contract.
    const bankFill = await fillBankFromMining({ minedResult: result }).catch((error) => ({
      ok: false,
      degraded: String(error?.code || error?.message || "bank_filler_failed").slice(0, 120),
    }));

    sendJson(res, 200, {
      ...result,
      bank: bankFill,
      job: "daily-mining",
      timestamp: new Date().toISOString(),
      providers: providerStatus(),
      nextStep: result.ok
        ? "Run /api/cron/nightly-pipeline to packet and preview eligible new leads."
        : result.message
          || "Scheduled mining refused. Check FIRECRAWL_API_KEY and GHOST_AGENCY_SCHEDULED_MINING before the cron lane can run.",
    });
  } catch (error) {
    handleError(res, error);
  }
};
