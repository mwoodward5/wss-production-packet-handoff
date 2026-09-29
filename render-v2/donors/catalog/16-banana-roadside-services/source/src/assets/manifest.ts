import {client,mediaFor} from '@/data/bridge';
// Slots retain their donor geometry. Undefined URLs are omitted by ClientImage.
export const ASSETS={
 logo:{url:client.identity.logoOnLight},hero_video:{url:client.hero.video},hero_poster:{url:client.hero.poster},
 reliable:{url:mediaFor('people')},about_story:{url:mediaFor('about')},about_commitment:{url:mediaFor('people',1)},about_divider:{url:mediaFor('about',1)},
 team_callout:{url:mediaFor('people',2)},contact_hero:{url:undefined},changing_wheel:{url:undefined},euro_hero:{url:undefined},euro_front:{url:undefined}
};
