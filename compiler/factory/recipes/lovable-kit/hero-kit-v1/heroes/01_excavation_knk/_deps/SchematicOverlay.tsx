export function SchematicOverlay() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18] mix-blend-screen motion-reduce:animate-none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <pattern id="knk-grid" width="80" height="80" patternUnits="userSpaceOnUse">
          <path d="M 80 0 L 0 0 0 80" fill="none" stroke="var(--knk-amber)" strokeWidth="0.4" />
        </pattern>
        <pattern id="knk-grid-fine" width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M 16 0 L 0 0 0 16" fill="none" stroke="var(--knk-bone)" strokeWidth="0.2" opacity="0.4" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#knk-grid-fine)" />
      <rect width="100%" height="100%" fill="url(#knk-grid)" />
      <g stroke="var(--knk-amber)" strokeWidth="1" fill="none">
        <line x1="6%" y1="18%" x2="14%" y2="18%" />
        <line x1="10%" y1="14%" x2="10%" y2="22%" />
        <circle cx="10%" cy="18%" r="3" />
        <line x1="86%" y1="76%" x2="94%" y2="76%" />
        <line x1="90%" y1="72%" x2="90%" y2="80%" />
        <circle cx="90%" cy="76%" r="3" />
      </g>
      <g stroke="var(--knk-bone)" strokeWidth="0.6" fill="none" opacity="0.5"
         className="animate-[knk-drift_24s_ease-in-out_infinite_alternate]">
        <path d="M0 320 Q 200 280 400 320 T 800 320 T 1200 320 T 1600 320" />
        <path d="M0 360 Q 200 340 400 360 T 800 360 T 1200 360 T 1600 360" />
        <path d="M0 400 Q 200 360 400 400 T 800 400 T 1200 400 T 1600 400" />
      </g>
    </svg>
  );
}

/* Add to global CSS:
@keyframes knk-drift {
  from { transform: translateX(0) translateY(0); }
  to { transform: translateX(-30px) translateY(-6px); }
}
*/
