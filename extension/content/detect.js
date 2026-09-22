(() => {
  const seen = new Set();

  function report(url, contentType = '') {
    if (!url || typeof url !== 'string' || url.startsWith('blob:') || url.startsWith('data:')) return;
    if (seen.has(url)) return;
    seen.add(url);
    chrome.runtime.sendMessage({ type: 'content:media', url, contentType }).catch(() => {});
  }

  function scan() {
    document.querySelectorAll('video,audio,source').forEach(el => {
      report(el.currentSrc || el.src || el.getAttribute?.('src') || '', el.type || '');
    });
  }

  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement || document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  document.addEventListener('play', scan, true);
  setInterval(scan, 5000);
})();
