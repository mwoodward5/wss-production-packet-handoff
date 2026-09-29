import {useSite} from '@/wss/bridge';
import {CertifiedServicePage} from '@/components/ServiceTemplate';
import NotFound from './NotFound';
export default function Weddings(){const {client}=useSite();const index=client.services.findIndex(s=>/wedding|engagement/i.test(s.name));return index<0?<NotFound/>:<CertifiedServicePage service={client.services[index]} index={index}/>;}
