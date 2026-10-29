// Runs inside the isolated note iframe; it has no access to Tauri APIs.
document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('a') : null;
  if (!link) return;
  const href = link.getAttribute('href') || '';
  if (href.startsWith('#')) return;
  event.preventDefault();
  if (/^dox:[0-9A-Z]{5}$/.test(href)) {
    parent.postMessage({ type: 'dox-link', id: href.slice(4) }, '*');
  }
});

// Keyboard events do not bubble out of the preview iframe.
document.addEventListener('keydown', (event) => {
  if (!event.isComposing && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'p') {
    event.preventDefault();
    parent.postMessage({ type: 'dox-shortcut', key: 'p' }, '*');
  }
});
