'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function treeHash(files) {
  const h = crypto.createHash('sha256');
  for (const rel of Object.keys(files).sort()) {
    const bytes = files[rel];
    if (!Buffer.isBuffer(bytes)) throw new Error('file_tree_buffer_required:' + rel);
    h.update(rel);
    h.update('\0');
    h.update(bytes);
    h.update('\0');
  }
  return h.digest('hex');
}

function readTree(directory) {
  const root = path.resolve(directory);
  const files = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        files[rel] = fs.readFileSync(full);
      }
    }
  }
  walk(root);
  return files;
}

function writeTree(directory, files) {
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, bytes] of Object.entries(files)) {
    if (path.isAbsolute(rel) || rel.split('/').includes('..')) throw new Error('file_tree_path_invalid:' + rel);
    const full = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, bytes);
  }
}

module.exports = Object.freeze({ treeHash, readTree, writeTree });
