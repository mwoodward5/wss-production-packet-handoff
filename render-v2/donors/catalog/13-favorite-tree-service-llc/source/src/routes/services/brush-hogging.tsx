import { ServicePageTemplate } from '@/components/ServicePageTemplate';
import { serviceBinding } from '@/lib/service-bindings';
import type { Service } from '@/lib/wss-types';
export function ServicePage({service}: {service: Service}) {
  return <ServicePageTemplate {...serviceBinding(service)} />;
}
