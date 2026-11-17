// The info pages' header, as in the app, built here from what each page already holds:
//   row one: the logo, the links between the pages, the light / dark switch, and a button that folds the header;
//   below:   this page's own sections as pills, all of them, on as many rows as they need (every <section id>:
//            its data-nav name, else the page's own short name for it, else its heading), the one being read orange.
// The header stays at the top of the window. The page's title and opening lines are moved out of it, to the top of
// the page. Folded or not is kept (and a narrow screen starts folded). The theme itself is set before the first
// paint by the short script in each page's head: ?theme=dark|light from the app's link, else the app's own choice
// (localStorage 'theme', the key the app uses), else the system's; the switch here keeps the choice the same way.
(() => {
  const root = document.documentElement;
  const PAGES = [['/data.html', 'Your data'], ['/security.html', 'Security'], ['/stats.html', 'Stats'], ['/how-its-built.html', 'How it’s built']];
  const here = location.pathname.replace(/\/$/, '') || '/';
  const header = document.querySelector('header.top');
  const wrap = header && header.querySelector('.wrap');
  if (!wrap) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // the title and the opening lines: out of the header, to the top of the page
  const intro = document.createElement('div'); intro.className = 'pg-intro';
  const introWrap = document.createElement('div'); introWrap.className = 'wrap'; intro.appendChild(introWrap);
  for (const el of [...wrap.querySelectorAll('h1, .lede')]) introWrap.appendChild(el);
  header.insertAdjacentElement('afterend', intro);

  // this page's sections
  const own = new Map([...document.querySelectorAll('.toc a[href^="#"], nav.jump a[href^="#"]')].map((a) => [a.getAttribute('href').slice(1), a.textContent.trim()]));
  const sections = [...document.querySelectorAll('main section[id]')].map((s) => ({ el: s, id: s.id, name: s.dataset.nav || own.get(s.id) || (s.querySelector('h2')?.textContent || s.id).trim() }));

  const bar = document.createElement('div'); bar.className = 'pg-bar';
  bar.innerHTML = `
    <a class="pg-logo" href="/" aria-label="MapNG: open the app">
      <span class="pg-tile"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true"><g fill="white" opacity="0.95"><polygon points="15,75 35,35 55,75"/><polygon points="40,75 60,25 85,75"/><line x1="10" y1="80" x2="90" y2="80" stroke="white" stroke-width="2" opacity="0.5"/><line x1="10" y1="85" x2="90" y2="85" stroke="white" stroke-width="1.5" opacity="0.3"/></g></svg></span>
      <span><b>MapNG</b><small>Real-world maps for BeamNG.drive</small></span>
    </a>
    <nav class="pg-nav" aria-label="MapNG pages">${PAGES.map(([href, name]) => `<a href="${href}"${here === href ? ' aria-current="page"' : ''}>${name}</a>`).join('')}</nav>
    <button type="button" class="pg-btn pg-theme" data-testid="page-theme">
      <svg class="pg-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
      <svg class="pg-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
    </button>
    <button type="button" class="pg-btn pg-fold" data-testid="page-fold" aria-controls="pg-sections">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>
    </button>`;
  const old = wrap.querySelector('.brand'); if (old) old.remove();
  wrap.insertBefore(bar, wrap.firstChild);
  let list = null;
  if (sections.length) {
    list = document.createElement('nav'); list.className = 'pg-sections'; list.id = 'pg-sections'; list.setAttribute('aria-label', 'On this page'); list.dataset.label = 'On this page';
    list.innerHTML = sections.map((s) => `<a href="#${esc(s.id)}" title="${esc((s.el.querySelector('h2')?.textContent || s.name).trim())}">${esc(s.name)}</a>`).join('');
    wrap.appendChild(list);
  }
  root.classList.add('pg-ready');

  // the header's height, for where a section stops when it is jumped to
  const measure = () => root.style.setProperty('--pg-head', `${header.offsetHeight}px`);

  // folded or not
  const fold = bar.querySelector('.pg-fold');
  const setFolded = (folded, keep) => {
    header.classList.toggle('pg-collapsed', folded);
    fold.setAttribute('aria-expanded', String(!folded));
    const say = folded ? 'Show the page links' : 'Hide the page links'; fold.setAttribute('aria-label', say); fold.title = say;
    if (keep) { try { localStorage.setItem('mapng_page_header', folded ? 'folded' : 'open'); } catch { /* storage blocked */ } }
    measure();
  };
  let kept = null; try { kept = localStorage.getItem('mapng_page_header'); } catch { /* storage blocked */ }
  setFolded(kept ? kept === 'folded' : window.innerWidth < 640, false);
  fold.addEventListener('click', () => setFolded(!header.classList.contains('pg-collapsed'), true));
  window.addEventListener('resize', measure);

  // light / dark
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

  // the section being read: the last one whose top has passed under the header
  if (list) {
    const links = [...list.querySelectorAll('a')];
    let current = -1;
    const mark = () => {
      const line = header.offsetHeight + 24;
      let at = -1;
      sections.forEach((s, i) => { if (s.el.getBoundingClientRect().top <= line) at = i; });
      if (at === current) return;
      current = at;
      links.forEach((a, i) => { if (i === at) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    };
    let waiting = false;
    window.addEventListener('scroll', () => { if (waiting) return; waiting = true; requestAnimationFrame(() => { waiting = false; mark(); }); }, { passive: true });
    mark();
  }
  // (a page opened at a section: under the header, now that its height is known)
  if (location.hash.length > 1) { const el = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (el) requestAnimationFrame(() => el.scrollIntoView()); }
})();
