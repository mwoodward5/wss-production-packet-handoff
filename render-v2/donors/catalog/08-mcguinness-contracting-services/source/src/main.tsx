import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { readIslands, brandStyles, CLIENT } from './lib/wss';
import { getRouter } from './router';
import './styles.css';

const root=createRoot(document.getElementById('root')!);
try {
  readIslands(document);
  for (const [key,value] of Object.entries(brandStyles())) document.documentElement.style.setProperty(key,value);
  document.title=CLIENT.identity.businessName;
  root.render(<RouterProvider router={getRouter()} />);
} catch {
  root.render(<main className="container mx-auto px-5 py-24"><h1>Site unavailable</h1><p>Required business information is missing or invalid.</p></main>);
}
