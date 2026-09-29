interface PageHeaderProps {
  eyebrow: string;
  title: string;
  intro?: string;
  image?: string;
}

export function PageHeader({ eyebrow, title, intro, image }: PageHeaderProps) {
  return (
    <section className="relative overflow-hidden bg-[var(--ink)] text-[var(--bone)] noise">
      <div className="absolute inset-0 grid-blueprint opacity-15" />
      {image && (
        <div className="absolute inset-0 opacity-30">
          <img src={image} alt="" aria-hidden="true" className="h-full w-full object-cover" loading="eager" decoding="async" fetchPriority="high" width={1920} height={800} />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--ink)] via-[var(--ink)]/80 to-transparent" />
        </div>
      )}
      <div className="relative mx-auto max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div className="eyebrow text-[var(--gold)]">{eyebrow}</div>
        <h1 className="display mt-3 max-w-3xl text-4xl md:text-6xl">{title}</h1>
        {intro && <p className="mt-5 max-w-2xl text-lg text-[var(--bone)]/75">{intro}</p>}
      </div>
    </section>
  );
}
