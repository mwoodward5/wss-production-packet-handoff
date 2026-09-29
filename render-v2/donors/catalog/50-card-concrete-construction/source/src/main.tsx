import { createRoot } from 'react-dom/client';
import './styles.css';
const root = createRoot(document.getElementById('root')!);
// Dynamic import keeps malformed/absent islands behind the fail-closed boundary.
Promise.all([import('./routes/__root'), import('./lib/site')]).then(([{App}, {BINDING}]) => {
  if (BINDING.brand) document.documentElement.style.setProperty('--brand', BINDING.brand);
  root.render(<App />);
}).catch(() => root.render(<main className="min-h-screen bg-[var(--ink)] text-white p-16"><h1 className="text-3xl">Site unavailable</h1><p>Certified client data is required.</p></main>));
