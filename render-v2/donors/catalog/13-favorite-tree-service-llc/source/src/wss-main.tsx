import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
const root = createRoot(document.getElementById('root')!);
import('./wss-app').then(({ WssApp }) => root.render(<WssApp />)).catch(() => root.render(<main role="alert" className="mx-auto max-w-3xl p-12"><h1>Site unavailable</h1><p>Required client information is missing or invalid.</p></main>));
