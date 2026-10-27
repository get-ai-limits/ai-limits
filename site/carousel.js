// Screenshot carousel: the track scrolls and snaps on its own (swipe, trackpad,
// keyboard), so this only adds the arrow buttons and keeps the dots in sync.
for (const carousel of document.querySelectorAll(".carousel")) {
  const track = carousel.querySelector(".track");
  const slides = [...track.children];
  const dots = [...carousel.querySelectorAll(".dots button")];
  const controls = carousel.querySelector(".controls");

  const current = () => Math.round(track.scrollLeft / track.clientWidth);
  const show = (index) => {
    const target = (index + slides.length) % slides.length;
    track.scrollTo({ left: slides[target].offsetLeft - track.offsetLeft });
  };

  carousel.querySelector(".prev").addEventListener("click", () => show(current() - 1));
  carousel.querySelector(".next").addEventListener("click", () => show(current() + 1));
  dots.forEach((dot, index) => dot.addEventListener("click", () => show(index)));
  track.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); show(current() - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); show(current() + 1); }
  });
  track.addEventListener("scroll", () => {
    const index = current();
    dots.forEach((dot, i) => dot.toggleAttribute("aria-current", i === index));
    dots[index]?.setAttribute("aria-current", "true");
  }, { passive: true });

  controls.hidden = false;
}
