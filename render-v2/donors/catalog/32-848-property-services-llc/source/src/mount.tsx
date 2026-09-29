import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { getRouter } from './router';
import { applyBranding } from './lib/wss';
export function mount(root:HTMLElement){applyBranding();createRoot(root).render(<RouterProvider router={getRouter()}/>);}
