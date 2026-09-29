import { createRoot } from 'react-dom/client';
import { DonorApp } from './routes/index';
import { readIslands } from './wss/bridge';
import './styles.css';
const root = createRoot(document.getElementById('root')!);
try {
 const site = readIslands(document);
 document.title = site.client.identity.businessName;
 root.render(<DonorApp site={site} path={window.location.pathname} />);
} catch {
 document.title = 'Site unavailable';
 root.render(<main role="alert" className="min-h-screen grid place-items-center p-8">Site unavailable. Required business information is missing or invalid.</main>);
}
