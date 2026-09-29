import {getClient} from '@/wss/bridge';
const c=getClient();
const empty={text:'',credit:''};
export const copy={brand:{name:c.identity.businessName,sub:''},hero:{eyebrow:c.hero.eyebrow,title:[c.hero.line1,c.hero.emphasis,c.hero.line3].join(' '),sub:c.hero.support,vertical:'',epigraph:empty},atlas:{eyebrow:'The atlas · VII',title:'Training arts',sub:'',epigraph:empty},faqs:c.content.faqs.map(f=>[f.q,f.a]),faqEpigraph:empty,closing:{title:c.content.ctaHeadline,sub:c.content.ctaBody}};
