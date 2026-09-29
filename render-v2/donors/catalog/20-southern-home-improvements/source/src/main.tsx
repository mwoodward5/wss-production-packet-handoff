import {createRoot} from 'react-dom/client';
import {App} from './App';
import {readSite} from './lib/wss';
import './styles.css';
const root=createRoot(document.getElementById('root')!);
try {const site=readSite(document);root.render(<App site={site} path={window.location.pathname}/>);}
catch {root.render(<main className="mx-auto max-w-3xl px-5 py-20"><h1 className="font-display text-4xl">Site unavailable</h1><p>Required site information is unavailable.</p></main>);}
