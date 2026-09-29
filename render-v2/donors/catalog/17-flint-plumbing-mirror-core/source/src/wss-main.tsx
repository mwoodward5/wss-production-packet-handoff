import React from 'react';
import { createRoot } from 'react-dom/client';
import './trust-widgets/trust-widgets.css';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
// Load only after validating the islands; module errors cannot expose donor defaults.
import('./wss-app').then(({ App, configureDocument }) => {
  configureDocument();
  root.render(<App />);
}).catch(() => {
  document.title = 'Site unavailable';
  root.render(<main className="grid min-h-screen place-items-center p-8"><p role="alert">This site is unavailable because required business information is missing or invalid.</p></main>);
});
