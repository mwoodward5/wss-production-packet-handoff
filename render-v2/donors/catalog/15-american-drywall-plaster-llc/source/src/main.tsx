import './styles.css';
const root=document.getElementById('root')!;
import('./bootstrap').catch(()=>{root.textContent='Site unavailable: required client data is missing or invalid.';});
