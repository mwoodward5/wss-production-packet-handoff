import { createRoot } from "react-dom/client";
import { initialize } from './lib/wss';
import "./index.css";

const root = createRoot(document.getElementById('root')!);
const unavailable = () => root.render(<main role="alert" className="container-page py-24"><h1>Site unavailable</h1><p>Required client information is unavailable.</p></main>);
try {
  initialize(document);
  import('./App.tsx').then(({default: App}) => root.render(<App />)).catch(unavailable);
} catch {
  unavailable();
}
