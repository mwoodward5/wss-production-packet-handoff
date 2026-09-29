import React from 'react';
import {createRoot} from 'react-dom/client';
import Index from './routes/index';
import {readIslands,site} from './lib/wss-bridge';
import './styles.css';
const root=createRoot(document.getElementById('root')!);
try {readIslands(document);document.title=site.identity.businessName;root.render(<Index path={location.pathname}/>);} catch {root.render(<main role="alert">This site is unavailable because required client information is missing or invalid.</main>);}
