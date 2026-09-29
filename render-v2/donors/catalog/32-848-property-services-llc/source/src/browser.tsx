import './styles.css';
const root=document.getElementById('root')!;
import('./mount').then(({mount})=>mount(root)).catch(()=>{
 root.replaceChildren();
 const message=document.createElement('p');
 message.setAttribute('role','alert');
 message.textContent='This site is unavailable because required client information is missing or invalid.';
 root.append(message);
});
