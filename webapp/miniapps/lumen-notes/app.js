// Lumen Notes — bundled demo stub. Purely visual; nothing is persisted on-chain.
(function () {
  var addr = new URLSearchParams(location.search).get('addr') || '';
  if (addr) {
    var conn = document.getElementById('conn');
    conn.textContent = addr.slice(0, 6) + '…' + addr.slice(-6);
    conn.title = addr;
  }
  var saved = document.getElementById('saved');
  document.getElementById('saveBtn').addEventListener('click', function () {
    saved.textContent = '✓ Saved (demo) — not written to any chain';
    setTimeout(function () { saved.textContent = ''; }, 2500);
  });
})();
