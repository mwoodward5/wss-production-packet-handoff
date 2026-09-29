// Synthetic donor chunk: gates the hero word layout on a .js class the way
// the audited donor families do, and arms the reveal-on-load law.
document.documentElement.classList.add("js");
const arm = () => {
  document.querySelectorAll(".reveal").forEach((el, i) => {
    setTimeout(() => el.classList.add("is-visible"), 50 + i * 100);
  });
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arm);
else arm();
