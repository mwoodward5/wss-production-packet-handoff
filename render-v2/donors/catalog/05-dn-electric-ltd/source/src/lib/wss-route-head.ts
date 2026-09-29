import { getClient } from './wss-client';
export function routeHead(label: string, description?: string) {
  const client = getClient();
  const title = `${label} | ${client.identity.businessName}`;
  const copy = description || client.content.serviceIntro;
  return { meta: [
    { title }, { name: 'description', content: copy },
    { property: 'og:title', content: title }, { property: 'og:description', content: copy },
    { name: 'twitter:title', content: title }, { name: 'twitter:description', content: copy },
  ] };
}
