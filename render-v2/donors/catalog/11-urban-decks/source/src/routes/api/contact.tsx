import { createFileRoute } from '@tanstack/react-router';

// Not registered in the browser SPA. No delivery provider is certified for this lane.
export const Route = createFileRoute('/api/contact')({
  server: {
    handlers: {
      POST: async () => new Response('Online submission unavailable. Use the published phone or email.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    },
  },
});
