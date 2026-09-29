import {useSite} from '@/wss/bridge';
import {CertifiedServicePage} from '@/components/ServiceTemplate';
import NotFound from './NotFound';
export default function Portraits(){const {client}=useSite();const index=client.services.findIndex(s=>/portrait|headshot|family/i.test(s.name));return index<0?<NotFound/>:<CertifiedServicePage service={client.services[index]} index={index}/>;}
