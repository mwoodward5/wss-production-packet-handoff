import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { prepareIntakeFiles } from "../lib/intake-files.mjs";
import { publicDriveTarget } from "../lib/drive-intake.mjs";

const archive = Buffer.from(zipSync({
  "brief.md": strToU8("# Cedar Stone\nPremium paver patios and drainage repair."),
  "about.html": strToU8("<script>bad()</script><h1>Family owned</h1><p>Serving Fort Collins.</p>"),
  "gallery/project.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  "installer.exe": new Uint8Array([1, 2, 3]),
}));
const rescued = prepareIntakeFiles([{ field: "files", filename: "cedar.zip", type: "application/zip", data: archive }]);
assert.match(rescued.extractedText, /Premium paver patios/);
assert.match(rescued.extractedText, /Family owned/);
assert.doesNotMatch(rescued.extractedText, /bad\(\)/);
assert.equal(rescued.files.length, 1);
assert.equal(rescued.manifests[0].raw_html_shipped, false);
assert.deepEqual(rescued.manifests[0].ignored, ["installer.exe"]);

const traversal = Buffer.from(zipSync({ "../outside.txt": strToU8("nope") }));
assert.throws(() => prepareIntakeFiles([{ filename: "unsafe.zip", type: "application/zip", data: traversal }]), /unsafe file path/);

assert.equal(publicDriveTarget("https://docs.google.com/document/d/abc123/edit")?.url, "https://docs.google.com/document/d/abc123/export?format=txt");
assert.equal(publicDriveTarget("https://drive.google.com/file/d/file123/view")?.id, "file123");
assert.equal(publicDriveTarget("https://example.com/file") ?? null, null);

console.log("Intake file rescue tests: passed");
