import {createRoot} from 'react-dom/client';
import '../styles.css';
const root=createRoot(document.getElementById('root')!);
// Load data-bound modules inside the catch boundary; missing islands cannot expose donor defaults.
Promise.all([import('./App'),import('./bridge')]).then(([{App},{WSS}])=>{
 if(WSS.design.accent && CSS.supports('color',WSS.design.accent)) {
  document.documentElement.style.setProperty('--accent',WSS.design.accent);
  document.documentElement.style.setProperty('--gold',WSS.design.accent);
  document.documentElement.style.setProperty('--hero-accent',WSS.design.accent);
 }
 document.title=WSS.identity.businessName;
 root.render(<App/>);
}).catch(()=>root.render(<main role="alert" className="p-8"><h1>Site unavailable</h1><p>Required certified client data is missing or invalid.</p></main>));
