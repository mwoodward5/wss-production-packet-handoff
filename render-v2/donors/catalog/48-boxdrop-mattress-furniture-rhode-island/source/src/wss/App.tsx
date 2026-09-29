import {SiteHeader} from '@/components/site/SiteHeader';
import {SiteFooter} from '@/components/site/SiteFooter';
import {StickyMobileCTA} from '@/components/site/StickyMobileCTA';
import {AuthorityPage} from '@/components/site/AuthorityPage';
import {HomePage} from '@/routes/index';
import {pagesByPath} from '@/data/seoPages';
import {client,applyBrand} from './bridge';
export function App({path=window.location.pathname}:{path?:string}){const page=pagesByPath.get(path.replace(/\/$/,'')||'/');if(typeof window!=='undefined'){applyBrand();document.title=(page?.title||'Page not found')+' | '+client.identity.businessName}return <><SiteHeader/><main>{!page?<section className="mx-auto max-w-6xl px-4 py-16"><h1>Page not found</h1><a href="/">Home</a></section>:page.type==='home'?<HomePage/>:<AuthorityPage page={page}/>}</main><SiteFooter/><StickyMobileCTA/></>}
