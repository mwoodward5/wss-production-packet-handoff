import {createRoot} from 'react-dom/client';
import './index.css';
const root=document.getElementById('root')!;
import('./lib/wss').then(async ({applyBrand})=>{
 applyBrand(); const {default:App}=await import('./App'); createRoot(root).render(<App />);
}).catch(()=>{document.title='Site unavailable';root.setAttribute('role','alert');root.textContent='This site is currently unavailable.';});
