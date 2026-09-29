'use strict';

const crypto = require('node:crypto');
const { wordmarkSvg } = require('./wordmark.cjs');

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function buildClientMedia(client, { bytesBySha = {}, heroVideo = null, verifiedLogo = null } = {}) {
  const files = {};
  const evidence = [];

  for (const media of client.media) {
    const bytes = bytesBySha[media.sourceSha256];
    if (!Buffer.isBuffer(bytes)) {
      const error = new Error('spa_v2_media_bytes_missing');
      error.detail = { sha256: media.sourceSha256, path: media.path, sourceUrl: media.sourceUrl };
      throw error;
    }
    const actual = hash(bytes);
    if (actual !== media.sourceSha256 || actual !== media.outputSha256) {
      const error = new Error('spa_v2_media_hash_mismatch');
      error.detail = { expected: media.sourceSha256, actual, path: media.path };
      throw error;
    }
    const rel = media.path.replace(/^\//, '');
    files[rel] = bytes;
    evidence.push({
      role: media.role,
      path: media.path,
      sourceUrl: media.sourceUrl,
      sourceSha256: media.sourceSha256,
      outputSha256: actual,
      rank: media.rank,
      width: media.width,
      height: media.height,
      originalBytes: true,
    });
  }

  if (client.hero.video) {
    if (!heroVideo || !Buffer.isBuffer(heroVideo.bytes)) throw new Error('spa_v2_hero_video_required');
    const actual = hash(heroVideo.bytes);
    if (heroVideo.sha256 && String(heroVideo.sha256).toLowerCase() !== actual) throw new Error('spa_v2_hero_video_hash_mismatch');
    if (heroVideo.bytes.length < 16 || heroVideo.bytes.subarray(4, 8).toString('ascii') !== 'ftyp') {
      throw new Error('spa_v2_hero_video_invalid_mp4');
    }
    files[client.hero.video.replace(/^\//, '')] = heroVideo.bytes;
    evidence.push({
      role: 'hero_video',
      path: client.hero.video,
      sourceSha256: actual,
      outputSha256: actual,
      originalBytes: true,
    });
  }

  if (verifiedLogo && Buffer.isBuffer(verifiedLogo.bytes)) {
    const actual = hash(verifiedLogo.bytes);
    if (verifiedLogo.sha256 && String(verifiedLogo.sha256).toLowerCase() !== actual) throw new Error('spa_v2_logo_hash_mismatch');
    const ext = String(verifiedLogo.ext || 'png').toLowerCase();
    if (!/^(?:png|svg|webp|jpg|jpeg)$/.test(ext)) throw new Error('spa_v2_logo_ext_invalid');
    // V2 currently requires two contrast-safe header/footer paths. A verified
    // client logo is retained verbatim at /assets/client-logo.<ext>; the
    // generated wordmark remains the contrast-safe fallback used by this donor.
    files['assets/client-logo.' + ext] = verifiedLogo.bytes;
    evidence.push({
      role: 'logo',
      path: '/assets/client-logo.' + ext,
      sourceSha256: actual,
      outputSha256: actual,
      originalBytes: true,
    });
  }

  const dark = wordmarkSvg(client.identity.businessName, 'light');
  const light = wordmarkSvg(client.identity.businessName, 'dark');
  files['assets/client-wordmark-dark.svg'] = dark;
  files['assets/client-wordmark-light.svg'] = light;
  evidence.push({
    role: 'generated_wordmark',
    path: '/assets/client-wordmark-dark.svg',
    outputSha256: hash(dark),
    originalBytes: false,
  });
  evidence.push({
    role: 'generated_wordmark',
    path: '/assets/client-wordmark-light.svg',
    outputSha256: hash(light),
    originalBytes: false,
  });

  return Object.freeze({ files, evidence });
}

module.exports = Object.freeze({ buildClientMedia, hash });
