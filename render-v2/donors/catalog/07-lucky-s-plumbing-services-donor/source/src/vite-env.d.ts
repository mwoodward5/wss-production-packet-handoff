/// <reference types="vite/client" />

type WssContentItem = string | Record<string, unknown>;

interface Window {
  __WSS_CONTENT__?: {
    facts?: Record<string, unknown>;
    brand?: Record<string, unknown>;
    services?: WssContentItem[];
    faqs?: WssContentItem[];
    hours?: WssContentItem[];
    photos?: WssContentItem[];
    gallery?: WssContentItem[];
    media?: WssContentItem[];
    about?: unknown;
  };
}
