'use strict';

function paragraphAfterHeading(markdown) {
  if (typeof markdown !== 'string') return '';
  const lines = markdown.replace(/\r\n/g, '\n').trim().split('\n');
  return lines.slice(1).join('\n').trim().split(/\n\n+/)[0].trim();
}

function exactAbout(facts, fallback) {
  const raw = typeof facts?.copy === 'string' ? facts.copy.replace(/\r\n/g, '\n') : '';
  const paragraphs = raw.split(/\n\n+/).map(x => x.trim()).filter(Boolean);
  const founded = Number.isSafeInteger(facts?.founded) ? String(facts.founded) : '';
  const candidates = paragraphs.filter(p => p.length >= 80 && p.length <= 1200);
  if (founded) {
    const hit = candidates.find(p => p.includes(founded) && /family|serving|company|landscap/i.test(p));
    if (hit) return hit;
  }
  const named = candidates.find(p => String(facts?.name || '') && p.includes(facts.name));
  return named || fallback;
}

function landscapingHero({ facts, services, homeCopy }) {
  const names = services.map(x => x.name);
  const design = names.find(x => /landscape.*design|design.*landscape/i.test(x));
  const lawn = names.find(x => /lawn|maintenance/i.test(x));
  return {
    line1: design ? 'Landscape design,' : 'Landscaping,',
    emphasis: lawn ? 'lawn care' : 'outdoor spaces',
    line3: 'for ' + facts.city + '.',
    eyebrow: facts.city + ', ' + facts.state,
    support: homeCopy,
  };
}

function mapLandscaping({ facts, services, files }) {
  const homeCopy = paragraphAfterHeading(files['content/home.md']);
  if (!homeCopy) throw new Error('landscaping_home_copy_missing');
  const about = exactAbout(facts, homeCopy);
  const maintenance = services.find(x => /maintenance/i.test(x.name));
  return Object.freeze({
    heroText: landscapingHero({ facts, services, homeCopy }),
    serviceIntro: homeCopy,
    about,
    whyHeadline: 'About ' + facts.name,
    values: services.slice(0, 4).map(service => ({ title: service.name, body: service.description })),
    seasonalNote: maintenance ? maintenance.name : '',
    ctaHeadline: 'Ready to talk about your outdoor space?',
    ctaBody: 'Call ' + facts.name + ' to discuss the landscaping services that fit your property.',
    serviceShortLabels: Object.fromEntries(services.map(service => [service.name, service.name])),
  });
}

module.exports = Object.freeze({ mapLandscaping, paragraphAfterHeading, exactAbout, landscapingHero });
