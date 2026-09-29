import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ClientProvider, loadIslands, brandStyle } from './lib/wss';

const root=createRoot(document.getElementById("root")!);
try {
  const value=loadIslands(document);
  root.render(<ClientProvider value={value}><div style={brandStyle(value.client)}><App /></div></ClientProvider>);
} catch {
  document.title='Site unavailable';
  root.render(<main className="container py-24"><h1 className="font-display text-4xl">Site unavailable</h1><p>Please try again later.</p></main>);
}
