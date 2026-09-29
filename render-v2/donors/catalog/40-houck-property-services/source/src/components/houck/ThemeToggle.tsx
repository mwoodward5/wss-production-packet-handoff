import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem("theme"); } catch { /* Storage is optional. */ }
    const initial = stored === "dark" || stored === "light" ? stored : (document.documentElement.classList.contains("dark") ? "dark" : "light");
    document.documentElement.classList.toggle("dark", initial === "dark");
    setTheme(initial);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    const root = document.documentElement;
    if (next === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try { localStorage.setItem("theme", next); } catch { /* The current page still changes theme. */ }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      data-cursor="hover"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="group relative inline-flex h-9 w-[68px] items-center rounded-full border border-border bg-graphite px-1 transition-colors hover:border-brass"
    >
      <span
        className="absolute left-1 top-1 h-7 w-7 rounded-full bg-brass shadow-sm transition-transform duration-500 ease-[cubic-bezier(0.77,0,0.175,1)]"
        style={{ transform: theme === "dark" ? "translateX(32px)" : "translateX(0)" }}
      />
      <span className="relative z-10 flex w-full justify-between px-1.5 font-mono-tight text-[10px] tabular-nums">
        <span aria-hidden className={theme === "light" ? "text-ink" : "text-muted-foreground"}>
          ☀
        </span>
        <span aria-hidden className={theme === "dark" ? "text-ink" : "text-muted-foreground"}>
          ☾
        </span>
      </span>
    </button>
  );
}
