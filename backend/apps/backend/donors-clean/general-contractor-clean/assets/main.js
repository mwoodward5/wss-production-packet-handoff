(function () {
  "use strict";

  var content = window.__WSS_CONTENT__ && typeof window.__WSS_CONTENT__ === "object"
    ? window.__WSS_CONTENT__
    : {};

  function text(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  }

  function serviceFrom(row) {
    if (typeof row === "string") return { name: text(row), description: "" };
    if (!row || typeof row !== "object") return { name: "", description: "" };
    return {
      name: text(row.name || row.title || row.service),
      description: text(row.description || row.short || row.summary),
    };
  }

  function renderServices() {
    var section = document.querySelector('[data-wss-content-channel="services"]');
    var list = document.querySelector("[data-wss-service-list]");
    var select = document.querySelector("[data-wss-service-select]");
    if (!section || !list) return;

    var rows = Array.isArray(content.services) ? content.services.map(serviceFrom) : [];
    rows = rows.filter(function (row) { return row.name; });
    if (!rows.length) return;

    rows.forEach(function (row, index) {
      var article = document.createElement("article");
      article.className = "service-card";
      article.setAttribute("data-wss-service-card", "verified");
      article.setAttribute("data-wss-content-source", "content-island");

      var number = document.createElement("span");
      number.className = "service-number";
      number.textContent = String(index + 1).padStart(2, "0");

      var heading = document.createElement("h3");
      heading.textContent = row.name;

      article.appendChild(number);
      article.appendChild(heading);
      if (row.description) {
        var description = document.createElement("p");
        description.textContent = row.description;
        article.appendChild(description);
      }
      list.appendChild(article);

      if (select) {
        var option = document.createElement("option");
        option.value = row.name;
        option.textContent = row.name;
        select.appendChild(option);
      }
    });

    section.hidden = false;
    section.setAttribute("data-wss-content-rendered", String(rows.length));
  }

  function armHeroVideo() {
    var video = document.querySelector("video[data-hero-video]");
    var island = document.getElementById("hero-video-ladder");
    var state = document.querySelector("[data-media-state]");
    if (!video || !island || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var sources = [];
    try {
      var parsed = JSON.parse(island.textContent || "{}");
      sources = Array.isArray(parsed.sources) ? parsed.sources.filter(Boolean) : [];
    } catch (error) {
      sources = [];
    }

    function arm(index) {
      var source = sources[index];
      if (!source) {
        video.setAttribute("data-hero-dead", "1");
        video.hidden = true;
        video.removeAttribute("src");
        if (state) state.textContent = "Planning view · illustrative";
        return;
      }

      var onReady = function () {
        cleanup();
        video.hidden = false;
        video.removeAttribute("data-hero-dead");
        video.setAttribute("data-hero-armed", "1");
        if (state) state.textContent = index === 0 ? "Project motion" : "Planning motion · illustrative";
        var play = video.play();
        if (play && typeof play.catch === "function") play.catch(function () {});
      };
      var onError = function () {
        cleanup();
        video.setAttribute("data-hero-dead", "1");
        video.hidden = true;
        video.removeAttribute("data-hero-armed");
        video.removeAttribute("src");
        video.load();
        arm(index + 1);
      };
      function cleanup() {
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("error", onError);
      }

      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.src = source.charAt(0) === "/" ? source : "/" + source;
      video.load();
    }

    arm(0);
  }

  renderServices();
  armHeroVideo();
})();
