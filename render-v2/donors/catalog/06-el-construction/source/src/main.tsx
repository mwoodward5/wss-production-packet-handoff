import {readIslands,brandVariables} from './lib/wss-bridge';
import './styles.css';
import './wss-theme.css';
const root=document.getElementById('root')!;
try {
 const {client}=readIslands(document);
 const branding=brandVariables(client);
 if(Object.keys(branding).length) document.documentElement.dataset.wssAccent='certified';
 for(const [k,v] of Object.entries(branding)) document.documentElement.style.setProperty(k,v);
 import('./browser').then(({mount})=>mount(root)).catch((error)=>{console.error('donor_mount_failed', error);root.textContent='This site is unavailable.';});
} catch (error) { console.error('donor_bootstrap_failed', error);root.textContent='This site is unavailable.'; }
