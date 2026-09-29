import {createRoot} from 'react-dom/client';
import {RouterProvider} from '@tanstack/react-router';
import {getRouter} from './router';
import {applyBrand} from './lib/bridge';
applyBrand();
createRoot(document.getElementById('root')!).render(<RouterProvider router={getRouter()} />);
