import {createRoot} from 'react-dom/client';
import {parseSite, brandStyle} from './wss/model';
import {SiteContext} from './wss/bridge';
import {App} from './wss/App';
import './styles.css';
const root = createRoot(document.getElementById('root')!);
try {
  const island = document.getElementById('wss-client-data');
  if (!island) throw Error('client_data_required');
  const rich = document.getElementById('wss-site-plan');
  const site = parseSite(JSON.parse(island.textContent || ''), rich ? JSON.parse(rich.textContent || '') : null);
  Object.entries(brandStyle(site.client)).forEach(([k,v]) => document.documentElement.style.setProperty(k,v));
  document.title = site.client.identity.businessName;
  root.render(<SiteContext.Provider value={site}><App /></SiteContext.Provider>);
} catch {
  document.title = 'Site unavailable';
  root.render(<main role="alert" className="container-tight py-24"><h1>Site unavailable</h1><p>Business information is not available.</p></main>);
}
