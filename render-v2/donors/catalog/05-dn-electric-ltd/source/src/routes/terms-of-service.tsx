import { createFileRoute, notFound } from '@tanstack/react-router';
import { TERMS_OF_SERVICE } from '@/lib/legal';
import { LegalDocument } from '@/components/site/LegalDocument';
import { routeHead } from '@/lib/wss-route-head';
export const Route = createFileRoute('/terms-of-service')({
  beforeLoad: () => { if (!TERMS_OF_SERVICE) throw notFound(); },
  head: () => routeHead('Terms of Service'),
  component: () => TERMS_OF_SERVICE ? <LegalDocument doc={TERMS_OF_SERVICE} /> : null,
});
