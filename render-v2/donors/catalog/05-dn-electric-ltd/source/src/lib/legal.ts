export type LegalBlock = { kind: 'p' | 'h2'; text: string } | { kind: 'ul'; items: string[] };
export type LegalDoc = { title: string; org: string; effective: string; updated: string; blocks: LegalBlock[] };
// The copied WSS rich content contract supplies no legal document fields.
export const TERMS_OF_SERVICE: LegalDoc | null = null;
export const PRIVACY_POLICY: LegalDoc | null = null;
