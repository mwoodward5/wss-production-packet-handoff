import { useParams } from 'react-router-dom';
import { LocalPage } from '@/components/local/LocalPage';
import { LocalSEO } from '@/components/local/LocalSEO';
import { CITIES, PROGRAMS, SITE, cityPath, HUB_PATH } from '@/data/local';
import NotFound from './NotFound';
const CityLanding = () => {
  const {city} = useParams();
  const data = CITIES.find(c => c.slug === city);
  if (!data) return <NotFound />;
  const title = `${data.name} | ${SITE.name}`;
  return <>
    <LocalSEO title={title} description={data.intro} path={cityPath(data.slug)}
      breadcrumbs={[{name:'Home',path:'/'},{name:'Service Areas',path:HUB_PATH},{name:data.name,path:cityPath(data.slug)}]}
      graph={[{'@type':'Service',name:'Flight training',areaServed:data.name,provider:{'@id':`${SITE.url}/#org`}}]} />
    <LocalPage eyebrow={`Service Area · ${data.name}`}
      title={<>Flight training · <span className="text-primary">{data.name}</span></>}
      titleText={data.name} intro={data.intro} paragraphs={data.paragraphs}
      callout={[{label:'Area',value:data.name}]} bulletsTitle="Available programs" bullets={PROGRAMS.map(p => p.name)}
      voiceQuestion="" voiceAnswer="" faqs={[]} crossLinkMode="city" currentSlug={data.slug} />
  </>;
};
export default CityLanding;
