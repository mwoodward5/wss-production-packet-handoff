'use strict';

module.exports = Object.freeze({
  name: 'service-schema-set',
  version: 1,
  class: 'schema',
  composesWith: Object.freeze(['showcase', 'cta-accent']),
  activation: 'flag:kit_service_schema_set',
  budget: Object.freeze({ family: "schema-invisible", ambientLoop: null, dwell: null, stagger: null, maxPerViewport: 1 }),

  css() {
    return '';
  },

  js() {
    return null;
  },

  notes:
    'Deliberately inert deduplication adapter under the current contract: ' +
    'the engine already emits Service, and the approved context does not ' +
    'identify an additional verified, allowed service subtype that the ' +
    'engine omits. This module therefore emits no second Service graph, ' +
    'no invented subtype, no default free Offer and no fabricated price ' +
    'range. Existing services and their engine-owned structured data stay ' +
    'untouched. A nonempty services array alone does not authorize another ' +
    'Service emitter or consume a schema activation slot.'
});
