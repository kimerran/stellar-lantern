// Lantern marketing site — cookie consent, scroll reveals, mobile nav.
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
