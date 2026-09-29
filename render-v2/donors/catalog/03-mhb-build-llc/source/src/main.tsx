import { createRoot } from "react-dom/client";
import "./index.css";
async function boot() {
  const root = createRoot(document.getElementById('root')!);
  try {
    const { applyBranding } = await import('./lib/bridge');
    applyBranding();
    const { default: App } = await import('./App');
    root.render(<App />);
  } catch {
    document.title = 'Site unavailable';
    root.render(<main className="container-tight section"><h1 className="font-display text-4xl">Site unavailable</h1><p>Required site information is unavailable.</p></main>);
  }
}
void boot();
