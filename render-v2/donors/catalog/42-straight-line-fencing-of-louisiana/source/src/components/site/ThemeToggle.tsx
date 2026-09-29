import { useEffect, useState } from "react";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  };

  return (
    <button
      type="button"
      onClick={toggle}
      data-cursor="link"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={
        "relative inline-flex h-9 w-16 items-center rounded-full border transition-colors " +
        className
      }
      style={{
        borderColor: "var(--hairline)",
        background: dark ? "oklch(0.18 0.01 60)" : "oklch(0.96 0.008 80)",
      }}
    >
      <span
        aria-hidden
        className="absolute top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full transition-all duration-500"
        style={{
          left: dark ? "calc(100% - 1.875rem)" : "0.125rem",
          background: "var(--brass)",
          boxShadow: "0 2px 8px oklch(0 0 0 / 0.25)",
        }}
      >
        {dark ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--ink)" }}>
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: "white" }}>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        )}
      </span>
    </button>
  );
}
