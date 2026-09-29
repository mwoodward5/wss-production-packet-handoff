import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { client } from './lib/wssBridge';

// CSD explicitly names accent. Font arrays have no role and are intentionally not guessed.
if (client && /^#[0-9a-f]{6}$/i.test(client.design.accent) && !/fallback|default/i.test(client.design.paletteSource)) {
  document.documentElement.style.setProperty('--client-accent',client.design.accent);
}

createRoot(document.getElementById("root")!).render(<App />);
