import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2 } from "lucide-react";
import { ASSETS } from "./manifest.example";

/**
 * Welcome-audio player mounted under the hero.
 * Click-initiated only. Plays a voice line at full volume with an MP3
 * music bed layered underneath at ~20%, with fade in/out on start/stop.
 */
const MUSIC_TARGET_VOL = 0.2;
const FADE_MS = 900;

export function HeroWelcomeAudio() {
  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const fadeTimer = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const clearFade = () => { if (fadeTimer.current) { window.clearInterval(fadeTimer.current); fadeTimer.current = null; } };

  const fadeMusic = (from: number, to: number, done?: () => void) => {
    const m = musicRef.current;
    if (!m) return;
    clearFade();
    const steps = 24; const stepMs = FADE_MS / steps;
    let i = 0;
    m.volume = from;
    fadeTimer.current = window.setInterval(() => {
      i += 1;
      const v = from + ((to - from) * i) / steps;
      m.volume = Math.max(0, Math.min(1, v));
      if (i >= steps) { clearFade(); done?.(); }
    }, stepMs);
  };

  useEffect(() => {
    const a = voiceRef.current;
    if (!a) return;
    const onTime = () => { if (a.duration > 0) setProgress((a.currentTime / a.duration) * 100); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => {
      setPlaying(false); setProgress(0);
      const m = musicRef.current;
      if (m && !m.paused) fadeMusic(m.volume, 0, () => { m.pause(); m.currentTime = 0; });
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnd);
      clearFade();
    };
  }, []);

  const toggle = () => {
    const v = voiceRef.current;
    const m = musicRef.current;
    if (!v) return;
    if (v.paused) {
      v.muted = false; v.volume = 1; v.play().catch(() => {});
      if (m) {
        m.loop = true; m.muted = false; m.volume = 0;
        m.play().then(() => fadeMusic(0, MUSIC_TARGET_VOL)).catch(() => {});
      }
    } else {
      v.pause();
      if (m && !m.paused) fadeMusic(m.volume, 0, () => { m.pause(); });
    }
  };

  const label = playing ? "Pause your welcome" : "Click to start your welcome";

  return (
    <div aria-label="Welcome audio" className="flex flex-col items-center gap-3">
      <button type="button" onClick={toggle} aria-label={label}
              className="group inline-flex items-center gap-3 rounded-full bg-[color:var(--banana)] px-6 py-3 text-sm font-bold text-[color:var(--asphalt)] shadow-[var(--shadow-sun)] transition-transform hover:-translate-y-0.5 sm:text-base">
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        {label}
      </button>
      <div className="h-1.5 w-56 overflow-hidden rounded-full bg-white/15" aria-hidden>
        <div className="h-full bg-[color:var(--banana)] transition-[width] duration-150" style={{ width: `${progress}%` }} />
      </div>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
        <Volume2 className="size-3" />A quick welcome
      </span>
      <audio ref={voiceRef} src={ASSETS.welcome_audio.url} preload="auto" playsInline />
      <audio ref={musicRef} src={ASSETS.music_bed.url} preload="auto" playsInline />
    </div>
  );
}
