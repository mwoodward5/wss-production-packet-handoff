import {createRoot} from 'react-dom/client';
import {DonorContext,readIslands} from './wss/bridge';
import {CardConcreteHome} from './components/card-concrete/Home';
import {PrivacyPage} from './routes/privacy';
import {TermsPage} from './routes/terms';
import {DetailPage} from './wss/DetailPage';
import './styles.css';
const root=createRoot(document.getElementById('root')!);
try {
 const bridge=readIslands(document);const path=window.location.pathname.replace(/\/$/,'')||'/';
 const service=bridge.client.services.find(s=>s.href===path);
 document.title=`${path==='/privacy'?'Privacy — ':path==='/terms'?'Terms — ':service?service.name+' — ':''}${bridge.NAME}`;
 if(path==='/privacy'||path==='/terms'){const meta=document.createElement('meta');meta.name='robots';meta.content='noindex';document.head.append(meta);}
 root.render(<DonorContext.Provider value={bridge}>{path==='/'?<CardConcreteHome/>:path==='/privacy'?<PrivacyPage/>:path==='/terms'?<TermsPage/>:<DetailPage service={service}/>}</DonorContext.Provider>);
} catch {document.title="Site unavailable";root.render(<main className="bg-ink text-bone min-h-screen grid place-items-center"><h1 className="font-display text-4xl">Site unavailable</h1></main>);}
