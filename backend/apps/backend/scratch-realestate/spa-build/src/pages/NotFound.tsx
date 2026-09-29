const NotFound = () => (
  <div className="flex min-h-screen items-center justify-center bg-ivory">
    <div className="text-center">
      <h1 className="mb-4 font-display text-5xl text-charcoal">404</h1>
      <p className="mb-6 font-body text-sm tracking-luxury uppercase text-muted-foreground">
        This page could not be found
      </p>
      <a href="/" className="font-body text-[11px] tracking-luxury uppercase border border-gold/40 text-gold-dark px-8 py-3 hover:bg-gold hover:text-charcoal transition-colors duration-500">
        Return Home
      </a>
    </div>
  </div>
);

export default NotFound;
