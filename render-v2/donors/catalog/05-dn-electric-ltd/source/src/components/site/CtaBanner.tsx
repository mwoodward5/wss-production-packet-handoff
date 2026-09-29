import { Link } from "@tanstack/react-router";
import { Phone } from "lucide-react";
import { BUSINESS } from "@/lib/business";

import { getClient } from "@/lib/wss-client";
export function CtaBanner() {
  const client = getClient();
  return (
    <section className="relative overflow-hidden bg-[var(--ink)] text-[var(--bone)] noise">
      <div className="absolute inset-0 grid-blueprint opacity-15" />
      <div
        className="absolute -right-20 -top-20 h-[420px] w-[420px] rounded-full opacity-30 blur-3xl"
        style={{ background: "var(--gradient-spark)" }}
      />
      <div className="relative mx-auto grid max-w-7xl gap-10 px-5 py-20 md:grid-cols-12 md:px-8 md:py-28">
        <div className="md:col-span-7">
          <div className="eyebrow text-[var(--gold)]">Your next step</div>
          <h2 className="display mt-3 text-4xl md:text-6xl">
            {client.content.ctaHeadline || "Discuss your project."}
          </h2>
          <p className="mt-5 max-w-xl text-[var(--bone)]/75">
            {client.content.ctaBody || `Contact ${BUSINESS.name} about your project.`}
          </p>
        </div>
        <div className="md:col-span-5 flex flex-col gap-3 md:items-end md:justify-end">
          <a
            href={BUSINESS.phoneHref}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--gold)] px-6 py-4 text-sm font-semibold text-[var(--ink)] transition-transform hover:-translate-y-0.5"
            style={{ boxShadow: "var(--shadow-gold)" }}
          >
            <Phone className="h-4 w-4" /> Call {BUSINESS.phone}
          </a>
          <Link
            to="/contact"
            hash="book-your-project"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--bone)]/25 px-6 py-4 text-sm font-semibold text-[var(--bone)] hover:bg-[var(--bone)]/10 transition-colors"
          >
            Contact the company
          </Link>
        </div>
      </div>
    </section>
  );
}
