import {client} from './bridge';
export const REVIEWS=client.trust.reviews.map(r=>({...r,name:r.author,quote:r.text}));
