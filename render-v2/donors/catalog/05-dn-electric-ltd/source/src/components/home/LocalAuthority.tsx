import { Link } from "@tanstack/react-router";
import { BUSINESS } from "@/lib/business";

export function LocalAuthority() {
  if (!BUSINESS.primaryServiceAreas.length) return null;
  return (
    <section className="bg-[var(--ink)] text-[var(--bone)] noise">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 md:grid-cols-12 md:px-8 md:py-28">
        <div className="md:col-span-5">
          <div className="eyebrow text-[var(--gold)]">Our service area</div>
          <h2 className="display mt-3 text-4xl md:text-5xl">
            {BUSINESS.city}, {BUSINESS.state}
          </h2>
          <p className="mt-5 text-[var(--bone)]/75 max-w-md">
            {BUSINESS.serviceArea}
          </p>
          <Link
            to="/service-area"
            className="mt-7 inline-flex rounded-full bg-[var(--gold)] px-5 py-3 text-sm font-semibold text-[var(--ink)]"
          >
            See full service area →
          </Link>
        </div>

        <div className="md:col-span-7">
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-[var(--bone)]/10 bg-[var(--bone)]/10 sm:grid-cols-4">
            {BUSINESS.primaryServiceAreas.map((c) => (
              <Link
                to="/service-area"
                key={c}
                className="bg-[var(--ink)] p-4 text-center text-sm font-semibold transition-colors hover:bg-[var(--ink-2)]"
              >
                <span className="block font-mono text-[0.6rem] uppercase tracking-widest text-[var(--gold)]">
                  Area
                </span>
                {c}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
