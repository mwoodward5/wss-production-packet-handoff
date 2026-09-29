import './styles.css';
async function start() {
 try {
 const {applyBranding}=await import('./data/bridge'); applyBranding();
 const [{createRoot},{RouterProvider},{getRouter}]=await Promise.all([import('react-dom/client'),import('@tanstack/react-router'),import('./router')]);
 createRoot(document.getElementById('root')!).render(<RouterProvider router={getRouter()}/>);
 } catch { document.title='Site unavailable'; document.getElementById('root')!.textContent='Site unavailable: certified client data is required.'; }
}
void start();
