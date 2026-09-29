'use strict';

const path = require('node:path');
const crypto = require('node:crypto');

const SHA256 = /^[a-f0-9]{64}$/i;
const EXT = /^(?:jpg|jpeg|png|webp|avif)$/i;

function fail(code, detail) {
  const error = new Error(code);
  error.code = code;
  if (detail !== undefined) error.detail = detail;
  throw error;
}

function roleFromSource(url) {
  let pathname;
  try { pathname = new URL(url).pathname.toLowerCase(); } catch { return 'unknown'; }
  if (/(?:^|\/)(?:maps?|tiles?|staticmap)(?:\/|$)/.test(pathname)) return 'excluded_map';
  if (/(?:^|\/)(?:team|staff|people|employees)(?:\/|$)/.test(pathname)) return 'people';
  if (/(?:^|\/)(?:about)(?:\/|$)/.test(pathname)) return 'about';
  if (/(?:^|\/)(?:hero)(?:\/|$)/.test(pathname)) return 'hero';
  return 'gallery';
}

function safePhoto(photo, index) {
  if (!photo || typeof photo !== 'object') fail('media_photo_invalid', index);
  const sha = String(photo.sha256 || '').toLowerCase();
  if (!SHA256.test(sha)) fail('media_photo_sha_invalid', index);
  const ext = String(photo.ext || 'jpg').toLowerCase();
  if (!EXT.test(ext)) fail('media_photo_ext_invalid', { index, ext });
  let url;
  try { url = new URL(String(photo.url || photo.originUrl || '')); } catch { fail('media_photo_url_invalid', index); }
  if (url.protocol !== 'https:' || url.username || url.password) fail('media_photo_url_invalid', index);
  const width = Number(photo.width);
  const height = Number(photo.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    fail('media_photo_dimensions_invalid', index);
  }
  return {
    index,
    ext,
    sourceUrl: url.href,
    sourceSha256: sha,
    rank: Number.isSafeInteger(photo.rank) ? photo.rank : null,
    width,
    height,
    role: roleFromSource(url.href),
    source: String(photo.source || ''),
    assetType: String(photo.asset_type || ''),
  };
}

function sortRanked(a, b) {
  const ar = a.rank == null ? Number.MAX_SAFE_INTEGER : a.rank;
  const br = b.rank == null ? Number.MAX_SAFE_INTEGER : b.rank;
  return ar - br || a.index - b.index;
}

function chooseHero(photos) {
  const explicit = photos.filter(x => x.role === 'hero').sort(sortRanked);
  if (explicit.length) return explicit[0];
  const scenes = photos.filter(x =>
    x.role === 'gallery' &&
    x.assetType !== 'logo' &&
    x.width >= x.height &&
    x.width >= 1200
  ).sort(sortRanked);
  return scenes[0] || null;
}

function mapPhotoBank(photoBank) {
  const raw = Array.isArray(photoBank?.photos) ? photoBank.photos : [];
  const photos = raw.map(safePhoto);
  if (!photos.length) fail('media_photo_bank_empty');
  const hero = chooseHero(photos);
  if (!hero) fail('media_hero_unavailable');

  const mapped = photos.map(photo => {
    const role = photo.index === hero.index ? 'hero' : photo.role;
    if (role === 'excluded_map') return { ...photo, role, path: '', status: 'omitted' };
    const fileName = 'client-photo-' + String(photo.index + 1).padStart(2, '0') + '.' + photo.ext;
    return {
      ...photo,
      role,
      path: '/assets/' + fileName,
      status: 'assigned',
    };
  });

  return Object.freeze({
    hero: mapped.find(x => x.role === 'hero'),
    gallery: mapped.filter(x => x.role === 'gallery').sort(sortRanked),
    people: mapped.filter(x => x.role === 'people').sort(sortRanked),
    about: mapped.filter(x => x.role === 'about').sort(sortRanked),
    omitted: mapped.filter(x => x.status === 'omitted'),
    all: mapped,
  });
}

function verifyBytes(mapping, bytesBySha) {
  if (!mapping || !Array.isArray(mapping.all)) fail('media_mapping_required');
  if (!bytesBySha || typeof bytesBySha !== 'object') fail('media_bytes_required');
  const files = {};
  const evidence = [];
  for (const item of mapping.all) {
    if (item.status !== 'assigned') continue;
    const bytes = bytesBySha[item.sourceSha256];
    if (!Buffer.isBuffer(bytes)) fail('media_bytes_missing', item.sourceSha256);
    const actual = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actual !== item.sourceSha256) fail('media_bytes_hash_mismatch', { expected: item.sourceSha256, actual });
    const rel = item.path.replace(/^\//, '');
    files[rel] = bytes;
    evidence.push({
      role: item.role,
      path: item.path,
      sourceUrl: item.sourceUrl,
      sourceSha256: item.sourceSha256,
      outputSha256: actual,
      rank: item.rank,
      width: item.width,
      height: item.height,
      originalBytes: true,
    });
  }
  return Object.freeze({ files, evidence });
}

function verifyHeroVideo(heroVideo) {
  if (!heroVideo) return null;
  if (!Buffer.isBuffer(heroVideo.bytes)) fail('hero_video_bytes_invalid');
  const sha = crypto.createHash('sha256').update(heroVideo.bytes).digest('hex');
  if (heroVideo.sha256 && String(heroVideo.sha256).toLowerCase() !== sha) fail('hero_video_hash_mismatch');
  if (heroVideo.bytes.length < 16 || heroVideo.bytes.subarray(4, 8).toString('ascii') !== 'ftyp') fail('hero_video_mp4_invalid');
  return Object.freeze({
    path: '/assets/hero-client-landscaping.mp4',
    sha256: sha,
    bytes: heroVideo.bytes,
  });
}

module.exports = Object.freeze({
  roleFromSource,
  mapPhotoBank,
  verifyBytes,
  verifyHeroVideo,
  chooseHero,
  fail,
});
