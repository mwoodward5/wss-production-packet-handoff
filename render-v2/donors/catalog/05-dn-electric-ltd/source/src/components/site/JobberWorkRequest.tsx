import { getClient } from '@/lib/wss-client';
export function JobberWorkRequest() {
  const client = getClient();
  return <div className="jobber-work-request w-full rounded-2xl border border-border p-6">
    {client.trust.bookingUrl ? <a href={client.trust.bookingUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Open booking page</a> : <p>Contact the company directly to request work.</p>}
    <a href={client.identity.phoneTel} className="mt-4 block font-semibold">{client.identity.phoneDisplay}</a>
    {client.identity.email && <a className="mt-2 block underline" href={`mailto:${client.identity.email}`}>{client.identity.email}</a>}
  </div>;
}
