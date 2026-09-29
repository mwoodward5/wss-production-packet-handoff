import { useParams, useLocation } from 'react-router-dom';
import { LocalPage } from '@/components/local/LocalPage';
import { LocalSEO } from '@/components/local/LocalSEO';
import { PROGRAMS, SITE, programPath, HUB_PATH } from '@/data/local';
import NotFound from './NotFound';
const ProgramLanding = () => {
  const {program} = useParams();
  const location = useLocation();
  const data = PROGRAMS.find(p => p.slug === program || p.href === location.pathname);
  if (!data) return <NotFound />;
  const title = `${data.name} | ${SITE.name}`;
  return <>
    <LocalSEO title={title} description={data.intro} path={programPath(data.slug)}
      breadcrumbs={[{name:'Home',path:'/'},{name:'Programs',path:HUB_PATH},{name:data.name,path:programPath(data.slug)}]}
      graph={[{'@type':'Service',name:data.name,description:data.intro,provider:{'@id':`${SITE.url}/#org`}}]} />
    <LocalPage eyebrow={`Program · ${data.shortName}`}
      title={<span className="text-primary">{data.name}</span>}
      titleText={data.name} intro={data.intro} paragraphs={data.paragraphs}
      callout={[{label:'Program',value:data.shortName}]} bulletsTitle="Contact" bullets={[SITE.phoneDisplay]}
      voiceQuestion="" voiceAnswer="" faqs={[]} crossLinkMode="program" currentSlug={data.slug} />
  </>;
};
export default ProgramLanding;
