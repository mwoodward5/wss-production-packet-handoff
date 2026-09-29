import React from 'react';
import { createRoot } from 'react-dom/client';
import { initializeSite, branding } from './lib/wss';
import { App } from './App';
import './styles.css';
const root=createRoot(document.getElementById('root')!);
try {
  const data=JSON.parse(document.getElementById('wss-client-data')?.textContent || 'null');
  const plan=JSON.parse(document.getElementById('wss-site-plan')?.textContent || '{}');
  const c=initializeSite(data,plan);
  document.title=c.identity.businessName;
  for(const [key,value] of Object.entries(branding())) document.documentElement.style.setProperty(key,value);
  root.render(<App path={window.location.pathname} />);
} catch {
  document.title='Site unavailable';
  root.render(<main role="alert" className="p-10">This site is unavailable because required client data is missing or invalid.</main>);
}
