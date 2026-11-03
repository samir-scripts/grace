const params = new URLSearchParams(window.location.search);
const rawUrl = params.get('url');
const targetEl = document.getElementById('target');

if (rawUrl && targetEl) {
  try {
    const parsed = new URL(rawUrl);
    targetEl.textContent = parsed.hostname;
  } catch {
    targetEl.textContent = rawUrl;
  }
}
