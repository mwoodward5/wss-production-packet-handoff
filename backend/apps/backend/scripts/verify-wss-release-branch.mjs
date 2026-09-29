import { spawnSync } from "node:child_process";

const commands = [
  ["node", ["--test", "test/connect-legacy-compat.test.js"]],
  ["node", ["--test", "test/line-50-site-release.test.js"]],
  ["node", ["--test", "test/mobile-hero-quality.test.js"]],
  ["node", ["--test", "test/console-orbit-ui.test.js"]],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: new URL("..", import.meta.url).pathname });
  if (result.status !== 0) process.exit(result.status || 1);
}
