// ---- Edit these before launch -------------------------------------------
const CONFIG = {
  launch: new Date("2026-10-20T00:00:00+01:00"), // Lagos (WAT)
  seatsTotal: 100,
  seatsTaken: null, // filled from the licensing Worker; the page works without it
  infoUrl: "https://prosper.qzz.io/launch/info",
};
// -------------------------------------------------------------------------

const $ = (s) => document.querySelectorAll(s);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Launch state
if (Date.now() >= CONFIG.launch.getTime()) $("[data-launch]").forEach((el) => (el.textContent = "Live now"));

// Seats come from the licensing Worker (live count); until it answers the page shows the offer without numbers
let fill = 0;
const setSeats = (cap, leftN) => {
  const taken = cap - leftN;
  $("[data-seats-left]").forEach((el) => (el.textContent = leftN));
  $("[data-seats-taken]").forEach((el) => (el.textContent = taken));
  $("[data-seats-wrap]").forEach((el) => (el.hidden = false));
  fill = taken / cap;
  $(".meter i").forEach((i) => i.style.setProperty("--fill", fill));
};
fetch(CONFIG.infoUrl).then((r) => r.json()).then((j) => { if (j && j.cap > 0) setSeats(j.cap, j.left); }).catch(() => {});

// Mobile menu: a native modal <dialog> handles focus trap, Escape and inert page
const menu = document.getElementById("menu");
const menuBtn = document.querySelector(".menu-btn");
const meterIn = (root) => root.querySelectorAll(".meter i").forEach((i) => i.style.setProperty("--fill", fill));

function openMenu() {
  const r = menuBtn.getBoundingClientRect();
  menu.style.setProperty("--ox", `${r.left + r.width / 2}px`);
  menu.style.setProperty("--oy", `${r.top + r.height / 2}px`);
  menu.querySelectorAll(".meter i").forEach((i) => i.style.setProperty("--fill", 0));
  menu.showModal();
  document.documentElement.style.overflow = "hidden";
  menuBtn.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => setTimeout(() => meterIn(menu), 300));
}
function closeMenu(then) {
  const done = () => {
    menu.classList.remove("closing");
    menu.close();
    then && then();
  };
  if (reduced) return done();
  menu.classList.add("closing");
  menu.addEventListener("animationend", done, { once: true });
}
menu.addEventListener("close", () => {
  document.documentElement.style.overflow = "";
  menuBtn.setAttribute("aria-expanded", "false");
});
menuBtn.addEventListener("click", openMenu);
menu.querySelector(".menu-close").addEventListener("click", () => closeMenu());
menu.addEventListener("cancel", (e) => { e.preventDefault(); closeMenu(() => menuBtn.focus()); }); // Escape, animated
// In-page links: close first, then scroll and move focus to the section for keyboard/screen-reader users
menu.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
  const target = a.hash.length > 1 && document.querySelector(a.hash);
  if (!target) return;
  e.preventDefault();
  closeMenu(() => {
    history.pushState(null, "", a.hash);
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  });
}));
matchMedia("(min-width: 720px)").addEventListener("change", (e) => e.matches && menu.open && menu.close());

// Highlight the nav link for the section being read
const navLinks = [...$("#nav-links a")].filter((a) => a.hash.length > 1 && document.querySelector(a.hash));
const spy = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (!e.isIntersecting) return;
  navLinks.forEach((a) => a.hash === "#" + e.target.id ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current"));
}), { rootMargin: "-40% 0px -55% 0px" });
navLinks.forEach((a) => spy.observe(document.querySelector(a.hash)));

// Nav: firmer once scrolled, plus a reading-progress line
const nav = document.querySelector(".nav");
let ticking = false;
addEventListener("scroll", () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    nav.classList.toggle("scrolled", scrollY > 8);
    nav.style.setProperty("--progress", max > 0 ? (scrollY / max).toFixed(3) : 0);
    ticking = false;
  });
}, { passive: true });

// Scroll reveals, staggered within each group
const revealIO = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (!e.isIntersecting) return;
  e.target.classList.add("in");
  meterIn(e.target);
  e.target.querySelectorAll("[data-count]").forEach(countUp);
  revealIO.unobserve(e.target);
}), { rootMargin: "0px 0px -10% 0px" });
if (!reduced) {
  $(".stats, .steps").forEach((g) => {
    g.classList.add("reveal", "reveal-group");
    [...g.children].forEach((li, i) => li.style.setProperty("--d", i));
    revealIO.observe(g);
  });
  $("main section:not(.hero) h2:not(.visually-hidden), .own-h, .own li, .game, .plan, .seat-card, details, .close > *:not(h2)").forEach((el) => {
    el.classList.add("reveal");
    el.style.setProperty("--d", [...el.parentElement.children].indexOf(el) % 4);
    revealIO.observe(el);
  });
} else {
  meterIn(document);
}

// Count the stat numbers up from zero (final value is already in the HTML)
$(".stats strong").forEach((el) => {
  const m = el.textContent.match(/\d+/);
  if (m) el.dataset.count = m[0];
});
function countUp(el) {
  const end = +el.dataset.count, tpl = el.textContent, t0 = performance.now();
  el.setAttribute("aria-label", tpl);
  const step = (t) => {
    const p = Math.min(1, (t - t0) / 1200), v = Math.round(end * (1 - Math.pow(1 - p, 3)));
    el.textContent = tpl.replace(/\d+/, v);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Videos: autoplay muted only when on screen and motion is allowed; poster otherwise
const videos = [...$("video[data-autoplay]")];
const vidIO = new IntersectionObserver((entries) => entries.forEach((e) => {
  const v = e.target;
  if (e.isIntersecting && !v.dataset.userPaused) v.play().catch(() => {});
  else v.pause();
}), { threshold: 0.25 });
if (!reduced) videos.forEach((v) => vidIO.observe(v));

// Pause control for the hero loop (WCAG 2.2.2: moving content longer than 5s)
const runVideo = document.querySelector(".run video");
const toggle = document.querySelector("[data-toggle]");
toggle.hidden = false;
const syncToggle = () => {
  toggle.classList.toggle("paused", runVideo.paused);
  toggle.setAttribute("aria-label", runVideo.paused ? "Play recording" : "Pause recording");
};
runVideo.addEventListener("play", syncToggle);
runVideo.addEventListener("pause", syncToggle);
toggle.addEventListener("click", () => {
  if (runVideo.paused) { delete runVideo.dataset.userPaused; runVideo.play(); }
  else { runVideo.dataset.userPaused = "1"; runVideo.pause(); }
});
syncToggle();

// Launch film in a modal; loads on first open, pauses on close
const film = document.getElementById("film");
const filmVideo = film.querySelector("video");
$("[data-film]").forEach((b) => b.addEventListener("click", () => {
  film.showModal();
  document.documentElement.style.overflow = "hidden";
  filmVideo.play().catch(() => {});
}));
film.querySelector("[data-film-close]").addEventListener("click", () => film.close());
film.addEventListener("click", (e) => { if (e.target === film) film.close(); }); // backdrop click
film.addEventListener("close", () => {
  filmVideo.pause();
  document.documentElement.style.overflow = "";
});
