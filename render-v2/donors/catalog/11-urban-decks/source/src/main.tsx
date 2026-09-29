import {createRoot} from 'react-dom/client';
import {RouterProvider} from '@tanstack/react-router';
import './styles.css';
async function boot(){
 try {
  const {applyBrand}=await import('./lib/wss');applyBrand();
  const {getRouter}=await import('./router');
  createRoot(document.getElementById('root')!).render(<RouterProvider router={getRouter()}/>);
 }catch(error){document.getElementById('root')!.textContent='This site is unavailable.';console.error('Client data refused',error);}
}
void boot();
