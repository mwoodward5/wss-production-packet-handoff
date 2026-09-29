import { createRoot } from "react-dom/client";
import { Landing } from "./routes/index";
import { readBridge, applyBranding } from "./wss/bridge";
import "./styles.css";
const root = createRoot(document.getElementById("root")!);
try {
  const site = readBridge(document);
  applyBranding(site.client, document);
  root.render(<Landing site={site} path={window.location.pathname.replace(/\/$/, "") || "/"} />);
} catch {
  document.title = "Site unavailable";
  root.render(
    <main className="mx-auto max-w-7xl px-5 py-24">
      <h1 className="font-display text-4xl">Site unavailable</h1>
      <p>Business information is not available.</p>
    </main>,
  );
}
