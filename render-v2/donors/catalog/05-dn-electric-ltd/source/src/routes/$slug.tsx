import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { SERVICES } from '@/lib/business';

// CSD-v2 service hrefs are flat. Preserve them as redirects to donor detail routes.
export const Route = createFileRoute('/$slug')({
  beforeLoad: ({ params }) => {
    const service = SERVICES.find(s => s.slug === params.slug);
    if (!service) throw notFound();
    throw redirect({ to: '/services/$slug', params: { slug: service.slug }, replace: true });
  },
});
