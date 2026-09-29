import { client, sitePlan, markdownSection } from './wss-bridge';
import type { Service } from './wss-types';
export function serviceBinding(service: Service) {
 const rich = sitePlan.services?.find(s => s.name === service.name);
 const markdown = rich?.longDescMd || service.description;
 const included = markdownSection(markdown, 'Included').split('\n').filter(s => /^[-*] /.test(s)).map(s => s.slice(2));
 const whyPro = markdownSection(markdown, 'Why hire a pro').split(/^###\s+/m).slice(1).map(s => ({title:s.split('\n')[0], body:s.slice(s.indexOf('\n')+1).trim()}));
 return { slug:service.href.slice(1), path:service.href, serviceType:service.name, h1:service.name,
  heroSub:rich?.shortDesc || '', heroImg:'', heroAlt:'', intro:markdown.split(/(?=^##\s)/m).filter(part => !/^##\s+(Included|Why hire a pro|Pricing)\s*$/im.test(part)).join('\n').replace(/^# [^\n]*\n+/, '').trim(), included, whyPro,
  pricing:markdownSection(markdown, 'Pricing'), faqs:client.content.faqs,
 };
}
export const donorServiceRoutes: Record<string, string[]> = {
 '/tree-removal-stump-grinding':['tree removal','stump grinding','tree removal & stump grinding','tree removal and stump grinding'],
 '/emergency-tree-service':['emergency tree service'],
 '/services/tree-pruning':['tree pruning'],
 '/services/bucket-truck-service':['bucket truck service'],
 '/services/lot-clearing':['lot clearing'],
 '/services/storm-damage-cleanup':['storm damage cleanup'],
 '/services/brush-hogging':['brush hogging'],
 '/services/mulching':['mulching'],
 '/services/landscape-maintenance':['landscape maintenance'],
 '/services/snow-removal':['snow removal'],
};
export function serviceAt(path: string) {
 return client.services.find(s => s.href === path) || client.services.find(s => donorServiceRoutes[path]?.includes(s.name.toLowerCase()));
}
