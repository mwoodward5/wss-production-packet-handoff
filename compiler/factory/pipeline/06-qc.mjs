// Pipeline stage 6 — qc: invokes qc-audit/qc.mjs on the built site.
import { emit } from "../lib/emit.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function qc(packet, { outDir, batchDir }) {
  emit("qc", "start", { site: outDir });
  const scriptPath = fileURLToPath(new URL("../../qc-audit/qc.mjs", import.meta.url));
  const args = [scriptPath, "--site", outDir];
  if (batchDir) args.push("--batch", batchDir);
  const r = spawnSync(process.execPath, args, { stdio: "pipe" });
  const reportPath = path.join(outDir, "qc-report.json");
  const results = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : [];
  const failed = results.filter((x) => !x.pass);
  const grade = r.status === 0 ? "A" : failed.length <= 2 ? "B" : failed.length <= 4 ? "C" : "D";
  emit("qc", "done", { grade, failed: failed.map((f) => f.name), report: reportPath });
  return { ...packet, qc: { grade, results, exit: r.status } };
}
