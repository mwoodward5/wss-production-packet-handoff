import {createRoot} from 'react-dom/client';
import '../styles.css';
const root=createRoot(document.getElementById('root')!);
import('./App').then(({App})=>root.render(<App/>)).catch(()=>root.render(<main role="alert" className="mx-auto max-w-3xl px-4 py-16"><h1>Site unavailable</h1><p>Business information is unavailable.</p></main>));
