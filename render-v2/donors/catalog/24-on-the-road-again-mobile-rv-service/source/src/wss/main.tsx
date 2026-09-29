import {createRoot} from 'react-dom/client';
import '../styles.css';
const root=createRoot(document.getElementById('root')!);
import('./app').then(({App})=>root.render(<App/>)).catch(()=>root.render(<main role="alert" className="p-8">This site is unavailable. Required business information is missing or invalid.</main>));
