import {createRoot} from 'react-dom/client';
import {initialize,applyBrand} from './wss/bridge';
import './styles.css';
const root=createRoot(document.getElementById('root')!);
try {
 const island=document.getElementById('wss-client-data');
 if(!island?.textContent)throw Error('certified_client_data_required');
 const plan=document.getElementById('wss-site-plan');
 initialize(JSON.parse(island.textContent),plan?.textContent?JSON.parse(plan.textContent):undefined);
 applyBrand();
 import('./wss/App').then(({App})=>root.render(<App/>)).catch(()=>root.render(<Unavailable/>));
} catch {root.render(<Unavailable/>);}
function Unavailable(){return <main className="mx-auto min-h-dvh max-w-xl px-6 py-40"><h1 className="font-serif text-4xl">Site unavailable</h1><p className="mt-6">Business details could not be loaded.</p></main>;}
