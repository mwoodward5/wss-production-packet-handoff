// SSE emit helper. In pipeline mode writes to stdout as `event: ...\ndata: ...`.
// In-process, calls a registered listener (set by the console server route).
let listener = null;

export function onEmit(fn) { listener = fn; }

export function emit(stage, phase, payload = {}) {
  const event = { stage, phase, payload, ts: Date.now() };
  if (listener) {
    try { listener(event); } catch {}
  } else {
    process.stdout.write(`event: ${stage}.${phase}\ndata: ${JSON.stringify(event)}\n\n`);
  }
}
