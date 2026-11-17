// The info pages' header (logo, links between the pages, light / dark switch), as in the app. The theme itself is
// set before the first paint by the short script in each page's head: ?theme=dark|light from the app's link, else
// the app's own choice (localStorage 'theme', the same key the app uses), else the system's. The switch here keeps
// the choice the same way, so the app opens in it too.
(() => {
  const root = document.documentElement;
  const PAGES = [['/data.html', 'Your data'], ['/security.html', 'Security'], ['/stats.html', 'Stats'], ['/how-its-built.html', 'How it’s built']];
  const here = location.pathname.replace(/\/$/, '') || '/';
  const wrap = document.querySelector('header.top .wrap');
  if (!wrap) return;
  const bar = document.createElement('div'); bar.className = 'pg-bar';
  bar.innerHTML = `
    <a class="pg-logo" href="/" aria-label="MapNG: open the app">
      <span class="pg-tile"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true"><g fill="white" opacity="0.95"><polygon points="15,75 35,35 55,75"/><polygon points="40,75 60,25 85,75"/><line x1="10" y1="80" x2="90" y2="80" stroke="white" stroke-width="2" opacity="0.5"/><line x1="10" y1="85" x2="90" y2="85" stroke="white" stroke-width="1.5" opacity="0.3"/></g></svg></span>
      <span><b>MapNG</b><small>Real-world maps for BeamNG.drive</small></span>
    </a>
    <nav class="pg-nav" aria-label="MapNG pages">${PAGES.map(([href, name]) => `<a href="${href}"${here === href ? ' aria-current="page"' : ''}>${name}</a>`).join('')}</nav>
    <button type="button" class="pg-theme" data-testid="page-theme">
      <svg class="pg-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
      <svg class="pg-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
    </button>`;
  const old = wrap.querySelector('.brand'); if (old) old.remove();
  wrap.insertBefore(bar, wrap.firstChild);
  const button = bar.querySelector('.pg-theme');
  const label = () => { const to = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; button.setAttribute('aria-label', `Switch to ${to} mode`); button.title = `Switch to ${to} mode`; };
  label();
  button.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); sessionStorage.setItem('mapng_page_theme', next); } catch { /* storage blocked: this page only */ }
    label();
    // (a page that draws with the colours, the stats map, draws again)
    document.dispatchEvent(new CustomEvent('mapng-theme', { detail: next }));
  });
})();
