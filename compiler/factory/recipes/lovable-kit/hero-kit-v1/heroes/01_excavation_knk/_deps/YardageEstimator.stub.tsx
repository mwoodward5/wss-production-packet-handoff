// YardageEstimator is a vertical-specific widget (KNK computes cubic yards
// from L × W × D inputs for excavation quotes). Build your own version tuned
// to the new client's vertical: fencing = linear-foot estimator, paving =
// sq-ft estimator, roofing = squares, plumbing = fixture count, etc.
//
// This stub is a placeholder so the Hero.tsx import resolves during copy-paste.
// Replace with a real widget per new client.

export function YardageEstimator() {
  return (
    <div className="rounded-xl border border-[var(--knk-line)] bg-[var(--knk-ink)]/70 p-6 text-[var(--knk-bone)] backdrop-blur">
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--knk-bone)]/60">
        Instant Estimator
      </p>
      <p className="mt-3 font-black">
        Build your own live-quote widget per vertical.
      </p>
      <p className="mt-2 text-sm text-[var(--knk-bone)]/70">
        See hero 07 (Straight Line Fencing) for a fully-worked live estimator
        example.
      </p>
    </div>
  );
}
