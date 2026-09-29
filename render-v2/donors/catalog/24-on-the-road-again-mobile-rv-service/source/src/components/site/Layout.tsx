import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { MobileCallBar } from "./MobileCallBar";

export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <div className="min-h-screen flex flex-col pb-14 lg:pb-0 bg-background text-foreground">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <MobileCallBar />
      </div>
    </ThemeProvider>
  );
}
