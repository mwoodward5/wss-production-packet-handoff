import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  discoveryPhotoAssetRows,
  persistDiscoveryMedia,
} from "../lib/discovery.mjs";
import {
  approvedPhotoCatalog,
  cleanupHydratedDiscoveryMedia,
  hydrateDiscoveryMediaAssets,
  isPublishableQc,
  PROJECT_PRECERTIFICATION_POLICY,
  publicPreviewQcSummary,
} from "../lib/engine-adapter.mjs";
import { prepareMediaCatalog } from "../../factory/lib/media-intelligence.mjs";
import { verifyMirroredPhotoFile } from "../../factory/pipeline/02-scrape.mjs";

async function writeVerifiedPng(filePath, width, height, background) {
  const body = await sharp({
    create: { width, height, channels: 3, background },
  }).png().toBuffer();
  writeFileSync(filePath, body);
  const checksum = createHash("sha256").update(body).digest("hex");
  const verified = await verifyMirroredPhotoFile(filePath, {
    checksum_sha256: checksum,
    content_type: "image/png",
    dimensions: { width, height },
  });
  return {
    body,
    meta: {
      checksum_sha256: checksum,
      content_type: "image/png",
      dimensions: { width, height },
      perceptual_hash: verified.perceptualHash,
    },
  };
}

function imageResponse(body) {
  return new Response(body, {
    status: 200,
    headers: {
      "content-length": String(body.length),
      "content-type": "image/png",
    },
  });
}

test("B6 discovery metadata survives asset persistence, generation hydration, and catalog preparation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-discovery-flow-"));
  const localPath = path.join(root, "source-proof.png");
  const verifiedPhoto = await writeVerifiedPng(localPath, 1200, 800, "#5c3024");
  const packet = {
    media: {
      catalog: [{
        kind: "photo",
        url: "https://roofer.example/projects/replacement.png",
        source: "business-site",
        label: "Roof replacement project",
        local_path: localPath,
        width: 1200,
        height: 800,
        hero_eligible: true,
        proof_eligible: true,
        meta: {
          ...verifiedPhoto.meta,
          mirror_status: "owned-local",
        },
      }],
    },
  };

  try {
    await persistDiscoveryMedia(packet, { projectId: "project-flow", serverless: false });
    const [row] = discoveryPhotoAssetRows(packet);
    assert.equal(row.meta.local_path, localPath);
    assert.equal(row.meta.perceptual_hash, verifiedPhoto.meta.perceptual_hash);
    assert.deepEqual(row.meta.dimensions, { width: 1200, height: 800 });

    const hydration = await hydrateDiscoveryMediaAssets(
      [{ ...row, approved: true, origin: "discovery" }],
      { projectId: "project-flow", outDir: path.join(root, "out") },
    );
    const catalog = approvedPhotoCatalog(hydration.assets);
    assert.equal(catalog[0].local_path, localPath);
    assert.equal(catalog[0].meta.perceptual_hash, verifiedPhoto.meta.perceptual_hash);
    const prepared = prepareMediaCatalog({
      business: { category: "roofing" },
      media: { catalog },
    });
    assert.equal(prepared.length, 1);
    assert.equal(prepared[0].url, "https://roofer.example/projects/replacement.png");
    assert.equal(prepared[0].local_path, localPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B6 serverless discovery fails closed without Blob and persists complete durable mirror metadata with Blob", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-discovery-blob-"));
  const localPath = path.join(root, "source-abcdef.png");
  const verifiedPhoto = await writeVerifiedPng(localPath, 1000, 700, "#76543a");
  const body = verifiedPhoto.body;
  const buildPacket = () => ({
    media: {
      mirror_dir: root,
      catalog: [{
        kind: "photo",
        url: "https://business.example/job.png",
        local_path: localPath,
        width: 1000,
        height: 700,
        meta: {
          ...verifiedPhoto.meta,
          mirror_status: "owned-local",
        },
      }],
    },
  });

  try {
    await persistDiscoveryMedia({ media: { catalog: [] } }, {
      projectId: "empty-project",
      serverless: true,
      blobStore: { BLOB_ENABLED: () => false },
    });
    await assert.rejects(
      persistDiscoveryMedia(buildPacket(), {
        projectId: "blob-project",
        serverless: true,
        blobStore: { BLOB_ENABLED: () => false },
      }),
      /requires durable Blob storage/,
    );

    const uploads = [];
    const packet = buildPacket();
    await persistDiscoveryMedia(packet, {
      projectId: "blob-project",
      serverless: true,
      blobStore: {
        BLOB_ENABLED: () => true,
        blobPut: async (pathname, uploadedBody, contentType) => {
          uploads.push({ pathname, body: Buffer.from(uploadedBody), contentType });
          return `https://blob.example/sf/${pathname}`;
        },
      },
    });
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].pathname, "discovery/blob-project/media/source-abcdef.png");
    assert.deepEqual(uploads[0].body, body);
    assert.equal(uploads[0].contentType, "image/png");
    const [stored] = packet.media.catalog;
    assert.equal(stored.local_path, null);
    assert.equal(stored.meta.local_path, null);
    assert.equal(stored.meta.mirror_status, "owned-blob");
    assert.equal(stored.meta.mirror_blob_prefix, "discovery/blob-project/media");
    assert.equal(stored.meta.mirror_blob_filename, "source-abcdef.png");
    assert.equal(stored.meta.source_url, "https://business.example/job.png");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B6 generation hydrates owned Blob media into a bounded build directory and removes it", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-hydrate-blob-"));
  const outDir = path.join(root, "out");
  const filename = "source-fedcba.png";
  const sourcePath = path.join(root, filename);
  const verifiedPhoto = await writeVerifiedPng(sourcePath, 1000, 700, "#355d46");
  const asset = {
    kind: "photo",
    url: "https://business.example/job.png",
    approved: true,
    origin: "discovery",
    width: 1000,
    height: 700,
    meta: {
      ...verifiedPhoto.meta,
      mirror_status: "owned-blob",
      mirror_blob_prefix: "discovery/hydrate-project/media",
      mirror_blob_path: `discovery/hydrate-project/media/${filename}`,
      mirror_blob_filename: filename,
      mirror_blob_url: `https://blob.example/sf/discovery/hydrate-project/media/${filename}`,
    },
  };
  let downloadedUrl = null;

  try {
    const hydration = await hydrateDiscoveryMediaAssets([asset], {
      projectId: "hydrate-project",
      outDir,
      fetchImpl: async (url) => {
        downloadedUrl = url;
        return imageResponse(verifiedPhoto.body);
      },
    });
    assert.equal(
      downloadedUrl,
      `https://blob.example/sf/discovery/hydrate-project/media/${filename}`,
    );
    const hydratedPath = hydration.assets[0].meta.local_path;
    assert.equal(existsSync(hydratedPath), true);
    assert.equal(path.dirname(hydratedPath), path.join(outDir, ".source-media-hydrated"));
    assert.equal(cleanupHydratedDiscoveryMedia(hydration), true);
    assert.equal(existsSync(hydratedPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B6 generation refuses owned media when durable hydration metadata or files are missing", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-hydrate-fail-"));
  const corruptSource = path.join(root, "corrupt-source.png");
  const corruptPhoto = await writeVerifiedPng(corruptSource, 1000, 700, "#262626");
  const baseAsset = {
    kind: "photo",
    url: "https://business.example/job.png",
    approved: true,
    meta: { mirror_status: "owned-blob" },
  };
  try {
    await assert.rejects(
      hydrateDiscoveryMediaAssets([baseAsset], { projectId: "project", outDir: root }),
      /metadata is incomplete/,
    );
    await assert.rejects(
      hydrateDiscoveryMediaAssets([{
        ...baseAsset,
        width: 1000,
        height: 700,
        meta: {
          ...corruptPhoto.meta,
          mirror_status: "owned-blob",
          mirror_blob_prefix: "discovery/project/media",
          mirror_blob_path: "discovery/project/media/missing.png",
          mirror_blob_filename: "missing.png",
          mirror_blob_url: "https://blob.example/sf/discovery/project/media/missing.png",
        },
      }], {
        projectId: "project",
        outDir: root,
        fetchImpl: async () => { throw new Error("missing blob"); },
      }),
      /failed bounded download/,
    );
    await assert.rejects(
      hydrateDiscoveryMediaAssets([{
        ...baseAsset,
        width: 1000,
        height: 700,
        meta: {
          ...corruptPhoto.meta,
          checksum_sha256: "0".repeat(64),
          mirror_status: "owned-blob",
          mirror_blob_prefix: "discovery/project/media",
          mirror_blob_path: "discovery/project/media/corrupt.png",
          mirror_blob_filename: "corrupt.png",
          mirror_blob_url: "https://blob.example/sf/discovery/project/media/corrupt.png",
        },
      }], {
        projectId: "project",
        outDir: root,
        fetchImpl: async () => imageResponse(corruptPhoto.body),
      }),
      /do not match persisted verification metadata/,
    );
    assert.equal(existsSync(path.join(root, ".source-media-hydrated")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B7 publishability keeps Grade A strict and allows only honest readiness-only Grade B pre-certification", () => {
  const evidence = [
    { name: "screenshots", pass: true },
    { name: "hero-layer-count", pass: true },
    { name: "copy-ban-list", pass: true },
  ];
  const gradeA = { grade: "A", degraded: false, results: evidence };
  assert.equal(isPublishableQc(gradeA), true);

  const readinessOnly = {
    grade: "B",
    degraded: false,
    results: [...evidence, {
      name: "grade-a-readiness",
      pass: false,
      detail: "batch distinctness requires at least three builds",
    }],
  };
  assert.equal(isPublishableQc(readinessOnly), false);
  assert.equal(
    isPublishableQc(readinessOnly, { policy: PROJECT_PRECERTIFICATION_POLICY }),
    true,
  );
  assert.deepEqual(publicPreviewQcSummary(readinessOnly), {
    grade: "B",
    score: null,
    degraded: false,
    visual: true,
    contract: "public-surface-v2",
    precertified: true,
    precertification_policy: PROJECT_PRECERTIFICATION_POLICY,
  });

  const realFailure = {
    ...readinessOnly,
    results: [...readinessOnly.results, { name: "visual-rendered-media", pass: false }],
  };
  assert.equal(
    isPublishableQc(realFailure, { policy: PROJECT_PRECERTIFICATION_POLICY }),
    false,
  );
  assert.equal(publicPreviewQcSummary(realFailure).precertified, false);
  assert.equal(
    isPublishableQc({ ...readinessOnly, degraded: true }, { policy: PROJECT_PRECERTIFICATION_POLICY }),
    false,
  );
});

test("B7 every try-preview QC call receives TRY_DIR and uses explicit pre-certification policy", () => {
  const source = readFileSync(new URL("../lib/engine-adapter.mjs", import.meta.url), "utf8");
  assert.match(source, /const qc = await runQc\(outDir, TRY_DIR\)/);
  assert.doesNotMatch(source, /const qc = await runQc\(outDir\);/);
  assert.match(source, /runQc\(outDir, TRY_DIR, releaseExpectation\)/);
  assert.match(source, /runQc\(outDir, TRY_DIR, payload\.release_expectation\)/);
  assert.match(source, /runQc\(outDir, TRY_DIR\)/);
  assert.doesNotMatch(source, /runQc\(outDir, null, (?:payload\.)?releaseExpectation\)/);
  const policyCalls = source.match(
    /isPublishableQc\(qc, \{ policy: PROJECT_PRECERTIFICATION_POLICY \}\)/g,
  ) || [];
  assert.ok(policyCalls.length >= 5, `expected generation and summary paths to declare policy; saw ${policyCalls.length}`);
  const publicSummaryCalls = source.match(/qc:\s*publicPreviewQcSummary\(qc\)/g) || [];
  assert.ok(publicSummaryCalls.length >= 3, `expected every public preview result to use the shared QC summary; saw ${publicSummaryCalls.length}`);
});
