'use strict';

// CSD v2 has no certified trade identifier. This is a conservative routing gate,
// not evidence of licensing or permission to add services to the client catalog.
function serviceKind(service) {
  if (!service || typeof service.name !== 'string') return undefined;
  const n = service.name.toLowerCase();
  if (/plumb|roof|lawn|cleaning|house clean|hvac|air condition|furnace|carpet|irrigation/.test(n)) return undefined;
  if (/\b(ev|electric vehicle)\b.*charg|charg.*\b(ev|electric vehicle)\b/.test(n)) return 'ev';
  if (/generator|standby power/.test(n)) return 'generator';
  if (/panel|electrical service upgrade/.test(n)) return 'panel';
  if (/rewir|knob.and.tube|aluminum wir/.test(n)) return 'rewires';
  if (/lighting/.test(n)) return 'lighting';
  if (/troubleshoot|electrical repair|electrical diagnostic/.test(n)) return 'troubleshooting';
  if (/new construction.*(wir|electric)|custom home wir|residential (electric|wir)/.test(n)) return 'residential';
  if (/electric|circuit|sub.panel|surge|outlet|switch|wiring/.test(n)) return 'solutions';
  return undefined;
}

module.exports = Object.freeze({ serviceKind });
