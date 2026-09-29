import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";

import { getSite, applyBranding } from './wss/bridge';
const root=createRoot(document.getElementById('root')!);
try {
 getSite(); applyBranding();
 root.render(<HelmetProvider><App /></HelmetProvider>);
} catch {
 document.title='Site unavailable';
 root.render(<main className="container py-24"><h1 className="font-display text-4xl">Site unavailable</h1><p>Business information is not available.</p></main>);
}
