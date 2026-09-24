// Lantern marketing site — cookie consent, scroll reveals, slideshows, video facade, mobile nav.
(function () {
  // ── Cookie consent ──
  var KEY = 'lantern-cookie-consent';
  var banner = document.getElementById('cookie');
  if (banner && !localStorage.getItem(KEY)) {
    setTimeout(function () { banner.classList.add('show'); }, 900);
  }
  function decide(value) {
    localStorage.setItem(KEY, value);
    if (banner) banner.classList.remove('show');
  }
  var accept = document.getElementById('cookie-accept');
  var decline = document.getElementById('cookie-decline');
  if (accept) accept.addEventListener('click', function () { decide('accepted'); });
  if (decline) decline.addEventListener('click', function () { decide('declined'); });

  // ── Scroll reveal ──
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && reveals.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.14 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  // ── Slideshows (Features, Screens) ──
  // Progressive enhancement over a plain grid: without JS every slide is laid out
  // in the grid. Here the wrapper gets .is-slideshow, which turns the grid into a
  // CSS scroll-snap track (touch swipe comes free), and we add prev/next buttons,
  // one dot per page, and arrow keys. Every slide stays in the DOM and in the
  // accessibility tree; links in slides that are out of view get tabindex=-1 so
  // Tab never lands off-screen. No autoplay.
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  function initSlideshow(root) {
    var track = root.querySelector('.slides');
    if (!track) return;
    var slides = Array.prototype.slice.call(track.children);
    var n = slides.length;
    if (n < 2) return;
    var name = root.getAttribute('data-slideshow') || 'slides';
    var FOCUSABLE = 'a[href], button, input, select, textarea, iframe, [tabindex]';

    root.classList.add('is-slideshow');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-roledescription', 'carousel');
    if (!root.hasAttribute('aria-label')) root.setAttribute('aria-label', name);
    track.setAttribute('tabindex', '0'); // the scroller itself is a keyboard stop
    slides.forEach(function (s, i) {
      s.setAttribute('role', 'group');
      s.setAttribute('aria-roledescription', 'slide');
      s.setAttribute('aria-label', (i + 1) + ' of ' + n);
    });

    function el(tag, cls, html) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html) e.innerHTML = html;
      return e;
    }
    var ARROW = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>';
    var controls = el('div', 'ss-controls');
    var prev = el('button', 'ss-btn ss-prev', ARROW);
    var next = el('button', 'ss-btn ss-next', ARROW);
    prev.type = next.type = 'button';
    prev.setAttribute('aria-label', 'Previous ' + name);
    next.setAttribute('aria-label', 'Next ' + name);
    var dots = el('div', 'ss-dots');
    dots.setAttribute('role', 'group');
    dots.setAttribute('aria-label', 'Choose ' + name + ' page');
    var status = el('p', 'visually-hidden');
    status.setAttribute('aria-live', 'polite');
    controls.appendChild(prev);
    controls.appendChild(dots);
    controls.appendChild(next);
    root.appendChild(controls);
    root.appendChild(status);

    var per = 1, pages = 1, page = 0, first = 0, announce = false;
    var pending = null; // target slide of a scroll still in flight, so fast key presses add up

    function pitch() { // distance between two slide starts
      return n > 1 ? slides[1].offsetLeft - slides[0].offsetLeft : track.clientWidth;
    }
    function startOf(p) { return Math.max(0, Math.min(p * per, n - per)); }
    function measure() {
      per = Math.max(1, Math.round((track.clientWidth + 1) / pitch()));
      var newPages = Math.ceil(n / per);
      if (newPages !== pages || !dots.children.length) {
        pages = newPages;
        dots.innerHTML = '';
        for (var p = 0; p < pages; p++) {
          var d = el('button', 'ss-dot');
          d.type = 'button';
          var a = startOf(p) + 1, b = Math.min(n, startOf(p) + per);
          d.setAttribute('aria-label', a === b ? name + ' ' + a + ' of ' + n : name + ' ' + a + ' to ' + b + ' of ' + n);
          d.setAttribute('data-page', String(p));
          dots.appendChild(d);
        }
      }
      sync();
    }
    function pageOf(i) {
      var best = 0;
      for (var p = 1; p < pages; p++) {
        if (Math.abs(startOf(p) - i) < Math.abs(startOf(best) - i)) best = p;
      }
      return best;
    }
    function sync() {
      pending = null;
      first = Math.max(0, Math.min(n - per, Math.round(track.scrollLeft / pitch())));
      page = pageOf(first);
      Array.prototype.forEach.call(dots.children, function (d, i) {
        if (i === page) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current');
      });
      prev.setAttribute('aria-disabled', String(first <= 0));
      next.setAttribute('aria-disabled', String(first >= n - per));
      // Only fully visible slides keep their links in the Tab order.
      slides.forEach(function (s, i) {
        var shown = i >= first && i < first + per;
        s.toggleAttribute('data-offscreen', !shown);
        s.querySelectorAll(FOCUSABLE).forEach(function (f) {
          if (shown) {
            if (f.hasAttribute('data-ss-tabindex')) {
              var old = f.getAttribute('data-ss-tabindex');
              if (old === '') f.removeAttribute('tabindex'); else f.setAttribute('tabindex', old);
              f.removeAttribute('data-ss-tabindex');
            }
          } else if (!f.hasAttribute('data-ss-tabindex')) {
            f.setAttribute('data-ss-tabindex', f.getAttribute('tabindex') || '');
            f.setAttribute('tabindex', '-1');
          }
        });
      });
      var last = Math.min(n, first + per);
      if (announce) status.textContent = per === 1 ? name + ' ' + (first + 1) + ' of ' + n : name + ' ' + (first + 1) + ' to ' + last + ' of ' + n;
      // Focus must never sit on a slide that has scrolled out of view.
      var active = document.activeElement;
      if (active && track.contains(active) && active !== track) {
        var owner = slides.filter(function (s) { return s.contains(active); })[0];
        if (owner && owner.hasAttribute('data-offscreen')) track.focus({ preventScroll: true });
      }
    }
    function goToIndex(i) {
      i = Math.max(0, Math.min(n - per, i));
      announce = true;
      var left = slides[i].offsetLeft - slides[0].offsetLeft;
      if (Math.abs(left - track.scrollLeft) < 1) { sync(); return; }
      pending = i;
      track.scrollTo({ left: left, behavior: reduceMotion && reduceMotion.matches ? 'auto' : 'smooth' });
    }
    function goTo(p) { goToIndex(startOf(Math.max(0, Math.min(pages - 1, p)))); }
    // Page to page, from wherever the track is (or is heading): a swipe can leave
    // it between page starts, in which case the nearer start in that direction wins.
    function step(dir) {
      var at = pending !== null ? pending : first;
      var p = pageOf(at);
      if (dir > 0) goTo(startOf(p) > at ? p : p + 1);
      else goTo(startOf(p) < at ? p : p - 1);
    }

    prev.addEventListener('click', function () { step(-1); });
    next.addEventListener('click', function () { step(1); });
    dots.addEventListener('click', function (e) {
      var d = e.target.closest('.ss-dot');
      if (d) goTo(Number(d.getAttribute('data-page')));
    });
    root.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var k = e.key;
      if (k === 'ArrowLeft') step(-1);
      else if (k === 'ArrowRight') step(1);
      else if (k === 'Home') goTo(0);
      else if (k === 'End') goTo(pages - 1);
      else return;
      e.preventDefault();
    });
    // A slide's link reached some other way (a screen reader's cursor, say):
    // bring its page into view rather than leave focus off-screen.
    track.addEventListener('focusin', function (e) {
      var owner = slides.filter(function (s) { return s !== e.target && s.contains(e.target); })[0];
      if (owner && owner.hasAttribute('data-offscreen')) goToIndex(slides.indexOf(owner));
    });
    var t;
    track.addEventListener('scroll', function () {
      clearTimeout(t);
      t = setTimeout(sync, 80);
    }, { passive: true });
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(measure, 120);
    });
    measure();
  }
  document.querySelectorAll('[data-slideshow]').forEach(initSlideshow);

  // ── Walkthrough video: click-to-play facade ──
  // The markup is a plain link to the video on YouTube (the no-JS fallback).
  // Here it becomes a real <button>; the youtube-nocookie.com iframe is only
  // created on click, so no YouTube resource loads before the visitor asks.
  document.querySelectorAll('.video[data-video-id]').forEach(function (box) {
    var link = box.querySelector('a.video-facade');
    if (!link) return;
    var id = box.getAttribute('data-video-id');
    var title = box.getAttribute('data-video-title') || 'Video';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'video-facade';
    while (link.firstChild) btn.appendChild(link.firstChild);
    var cta = btn.querySelector('.video-cta');
    // The button's name is its visible text (the poster is alt="", the icon aria-hidden).
    if (cta) cta.textContent = 'Play the walkthrough';
    link.replaceWith(btn);
    btn.addEventListener('click', function () {
      var frame = document.createElement('iframe');
      frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&rel=0';
      frame.title = title;
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
      frame.setAttribute('allowfullscreen', '');
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      btn.replaceWith(frame);
      frame.focus();
    });
  });

  // ── Mobile nav ──
  var toggle = document.getElementById('nav-toggle');
  var links = document.getElementById('nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function () { links.classList.toggle('open'); });
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { links.classList.remove('open'); });
    });
  }
})();
