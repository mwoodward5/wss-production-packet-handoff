import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { getClient } from './lib/wss-client';
import { applyBrand } from './lib/wss-brand';
import './styles.css';
import './wss-accessibility.css';
async function boot() {
  const root = document.getElementById('root');
  if (!root) throw new Error('wss_root_missing');
  try {
    getClient();
    applyBrand();
    const { getRouter } = await import('./router');
    createRoot(root).render(<RouterProvider router={getRouter()} />);
  } catch (error) {
    root.setAttribute('data-wss-refused', 'true');
    root.setAttribute('role', 'alert');
    root.textContent = 'This preview is unavailable because its client data could not be verified.';
    console.error(error instanceof Error ? error.message : 'wss_preview_refused');
  }
}
void boot();
