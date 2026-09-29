import assert from "node:assert/strict";

process.env.SITEFORGE_NO_LISTEN = "1";
const { server } = await import("../server.mjs");

await new Promise((resolve) => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}`;
try {
  const home = await (await fetch(`${base}/`)).text();
  assert.match(home, /WSS Launch<\/a>/);
  assert.match(home, /WSS Launch by Woodward Software Labs/);
  assert.match(home, /WSS Launch gathers the details/);
  assert.doesNotMatch(home, /SiteForge/);

  const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json();
  assert.deepEqual({ name: manifest.name, short_name: manifest.short_name }, { name: "WSS Launch", short_name: "WSS Launch" });

  const llms = await (await fetch(`${base}/llms.txt`)).text();
  const humans = await (await fetch(`${base}/humans.txt`)).text();
  assert.match(llms, /^# WSS Launch/m);
  assert.match(humans, /^WSS Launch is forged by Woodward Software Labs\./m);
  assert.doesNotMatch(llms, /SiteForge/);
  assert.doesNotMatch(humans, /SiteForge/);

  const og = await (await fetch(`${base}/og.png`)).text();
  assert.match(og, /WSS Launch/);
  assert.doesNotMatch(og, /SiteForge/);
} finally {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

console.log("Public branding tests: passed");
