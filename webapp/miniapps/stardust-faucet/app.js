// Stardust Faucet — bundled demo mini-app. No real network / no real signing;
// this is a visual mock of the connect -> request -> safety-check -> done flow.
// External file (not inline) so it satisfies the extension CSP script-src 'self'.

(function () {
  function truncate(addr) {
    return addr.length > 13 ? addr.slice(0, 6) + '…' + addr.slice(-6) : addr;
  }

  // The host passes the wallet address as ?addr=… (a URL param, not a live bridge).
  var params = new URLSearchParams(location.search);
  var addr = params.get('addr') || '';

  var conn = document.getElementById('conn');
  if (addr) {
    conn.textContent = truncate(addr);
    conn.classList.add('live');
    conn.title = addr;
    document.getElementById('toAddr').textContent = truncate(addr);
  }

  var claim = document.getElementById('claim');
  var review = document.getElementById('review');
  var done = document.getElementById('done');

  function show(el) {
    [claim, review, done].forEach(function (s) { s.classList.add('hidden'); });
    el.classList.remove('hidden');
  }

  document.getElementById('claimBtn').addEventListener('click', function () {
    show(review);
  });
  document.getElementById('cancelBtn').addEventListener('click', function () {
    show(claim);
  });
  document.getElementById('confirmBtn').addEventListener('click', function () {
    show(done);
  });
  document.getElementById('againBtn').addEventListener('click', function () {
    show(claim);
  });
})();
