'use strict';

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function createRegistry(rows) {
  if (!Array.isArray(rows)) throw new Error('category_registry_array_required');
  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') throw new Error('category_registry_row_invalid');
    const category = normalize(row.category);
    if (!category) throw new Error('category_registry_name_missing');
    if (map.has(category)) throw new Error('category_registry_duplicate:' + category);
    map.set(category, Object.freeze({
      category,
      donor: row.donor || null,
      installed: row.installed === true,
      aliases: Array.isArray(row.aliases) ? Object.freeze([...row.aliases]) : Object.freeze([]),
    }));
  }
  return Object.freeze({
    names: Object.freeze([...map.keys()]),
    getExact(value) {
      const key = normalize(value);
      return map.get(key) || null;
    },
    requireExact(value) {
      const row = this.getExact(value);
      if (!row) {
        const error = new Error('category_exact_match_required');
        error.detail = { requested: normalize(value) };
        throw error;
      }
      return row;
    },
  });
}

module.exports = Object.freeze({ normalize, createRegistry });
