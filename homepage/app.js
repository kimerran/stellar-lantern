// Lantern marketing site — cookie consent, scroll reveals, video facade, mobile nav.
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
