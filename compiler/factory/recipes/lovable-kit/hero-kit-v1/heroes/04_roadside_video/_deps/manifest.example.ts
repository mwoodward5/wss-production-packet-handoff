// Example asset manifest. Replace URLs with your own upload pointers.
// Original Banana Roadside URLs shown for reference — they still work but
// are branded to the original client.
export const ASSETS = {
  hero_video:    { url: "/__l5e/assets-v1/2fdf7ec4-2c57-4952-891c-631d4d4ca3fb/hero-banana.mp4",           name: "hero.mp4" },
  hero_poster:   { url: "/__l5e/assets-v1/b648e2a0-172e-43c6-8ac7-ee123fc52b71/hero-banana-poster.jpg",    name: "hero-poster.jpg" },
  logo:          { url: "/__l5e/assets-v1/61083c6e-1c11-4488-b0c0-78a9365050ac/banana-logo-final.png",     name: "logo.png" },
  welcome_audio: { url: "/__l5e/assets-v1/a1fd4ff9-05ce-4268-9256-5c6969af4e29/banana-welcome-british.mp3", name: "welcome.mp3" },
  music_bed:     { url: "/__l5e/assets-v1/d743f157-2d17-45d3-8a36-543e35679d63/welcome-music-bed.mp3",     name: "music-bed.mp3" },
} as const;
export type AssetKey = keyof typeof ASSETS;
