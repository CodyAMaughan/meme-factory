// Shared seek-safe helpers for the Meme Factory demo compositions. Each one only adds
// tweens or sets to the timeline it is given, so every frame depends on time alone.
window.mf = (tl) => {
  const INK = '#19141f';
  const $ = (s) => document.querySelector(s);
  return {
    $,
    // Typing: one span per character, shown at its own time. Returns the end time.
    type(el, text, at, step = 0.045) {
      el = typeof el === 'string' ? $(el) : el;
      el.textContent = '';
      [...text].forEach((c, i) => {
        const span = document.createElement('span');
        span.className = 'ch';
        span.textContent = c;
        el.appendChild(span);
        tl.set(span, { display: 'inline' }, at + i * step);
      });
      return at + text.length * step;
    },
    show: (sel, at) => tl.set(sel, { opacity: 1 }, at),
    hide: (sel, at) => tl.set(sel, { opacity: 0 }, at),
    // Swap between members of a stack: everything off, one on.
    only(group, sel, at) {
      group.forEach((g) => tl.set(g, { opacity: g === sel ? 1 : 0 }, at));
    },
    // A keycap pops, presses on `at`, and leaves. The press causes what follows.
    key(sel, at) {
      const cap = $(sel + ' b');
      tl.fromTo(sel, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.18, ease: 'back.out(1.7)' }, at - 0.25);
      tl.to(cap, { y: 8, boxShadow: `0 2px 0 ${INK}`, duration: 0.07, ease: 'power2.in' }, at - 0.07);
      tl.to(cap, { y: 0, boxShadow: `0 10px 0 ${INK}`, duration: 0.14, ease: 'power2.out' }, at);
      tl.to(sel, { opacity: 0, scale: 0.9, duration: 0.2, ease: 'power2.in' }, at + 0.4);
    },
    caption(sel, inAt, outAt) {
      tl.fromTo(sel, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power3.out' }, inAt);
      if (outAt != null) tl.to(sel, { opacity: 0, y: -16, duration: 0.22, ease: 'power2.in' }, outAt);
    },
    pop(sel, at, from = 0.9) {
      tl.fromTo(sel, { opacity: 0, scale: from }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.6)' }, at);
    },
    // The oversized cursor travels to a point (frame pixels, tip at x,y) and clicks on `at`.
    cursorTo(sel, x, y, at, travel = 0.55) {
      tl.to(sel, { x, y, duration: travel, ease: 'power3.inOut' }, at - travel);
      tl.to(sel, { scale: 0.86, duration: 0.07, ease: 'power2.in' }, at - 0.07);
      tl.to(sel, { scale: 1, duration: 0.18, ease: 'back.out(2)' }, at);
    },
  };
};
