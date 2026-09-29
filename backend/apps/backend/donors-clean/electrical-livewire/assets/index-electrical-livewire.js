/* ==========================================================================
   electrical-livewire — hero video layer (the family's only script asset)
   ==========================================================================
   THE MOUNT CONTRACT (ladder donor, 2026-09-02 fleet law): this file mounts
   the hero <video> marked data-hero-video — HIDDEN, with the hero poster
   photograph as its poster and no static src — into .hero-media, directly
   above the poster <img>. The ladder runtime in index.html (which runs
   before this deferred script) observes the DOM for exactly this element
   and arms the first rung whose bytes shipped; a rung that errors steps
   down hidden, and an exhausted ladder leaves the poster painted — the hero
   is complete before this script ever runs, and reduced motion never mounts
   the clip at all.

   After mounting, this layer is the poster-first controller: the clip only
   ever starts muted; on touch devices it waits for the tap; it pauses when
   the hero scrolls away or the tab hides.
   ========================================================================== */
(function () {
  "use strict";

  var HERO_POSTER = "assets/hero-electrical-Bs6mWwJJ.jpg";
  var MOUNT_ATTRS = { "data-hero-video":"", muted:!0, loop:!0, playsInline:!0, preload:"none", poster:HERO_POSTER, hidden:!0 };

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var media = document.querySelector(".hero-media");
  if (!media) return;

  var existing = media.querySelector("video[data-hero-video]");
  if (existing) { control(existing); return; }

  var posterImg = media.querySelector(".hero-poster");
  var clip = document.createElement("video");
  for (var key in MOUNT_ATTRS) {
    if (Object.prototype.hasOwnProperty.call(MOUNT_ATTRS, key)) {
      clip.setAttribute(key, MOUNT_ATTRS[key]);
    }
  }
  clip.muted = true; /* the PROPERTY, not just the attribute — autoplay policy */
  if (posterImg && posterImg.nextSibling) media.insertBefore(clip, posterImg.nextSibling);
  else media.appendChild(clip);

  control(clip);

  /* Poster-first controller. */
  function control(clip) {
    var playBtn = document.querySelector(".hero-play");

    function nudge() {
      if (!clip.src || clip.getAttribute("data-hero-dead")) return;
      var p = clip.play();
      if (p && p.catch) p.catch(function () { /* poster stays; the tap chip takes over */ });
    }

    /* The ladder sets src asynchronously once it sees the mount; poll briefly. */
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (clip.src) { clearInterval(timer); setTimeout(nudge, 350); }
      else if (tries > 80) { clearInterval(timer); }
    }, 250);

    /* A rung that 404s makes the ladder swap src — retry the muted start. */
    clip.addEventListener("error", function () { setTimeout(nudge, 150); });

    if (playBtn) {
      playBtn.addEventListener("click", function () {
        nudge();
        playBtn.hidden = true;
      });
      clip.addEventListener("playing", function () { playBtn.hidden = true; }, { once: true });
      clip.addEventListener("loadedmetadata", function () { playBtn.hidden = false; });
    }

    /* Pause when the hero scrolls away or the tab hides. */
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].isIntersecting) clip.pause();
        }
      }, { threshold: 0.15 }).observe(clip.closest(".hero") || clip);
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) clip.pause();
    });
  }
})();
