import {createRoot} from 'react-dom/client';
import './styles.css';
const root=createRoot(document.getElementById('root')!);
Promise.all([import('./WssApp'),import('./lib/wss')]).then(([{WssApp},{applyBranding}])=>{applyBranding();root.render(<WssApp/>);}).catch(()=>{document.title='Site unavailable';root.render(<main className="mx-auto max-w-xl px-6 py-24"><h1 className="font-display text-4xl">Site unavailable</h1><p>Business information is not available.</p></main>);});
