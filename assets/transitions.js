(() => {
  document.documentElement.classList.add('js-enabled');
  const header = document.querySelector('.nav');
  const menu = header?.querySelector('.navlinks');
  if (menu) {
    menu.id = 'primary-navigation';
    if (!menu.querySelector('.mobile-reservation-link')) {
      const bookingLink = header.querySelector(':scope > .btn')?.cloneNode(true);
      if (bookingLink) { bookingLink.className = 'mobile-reservation-link'; menu.appendChild(bookingLink); }
    }
    let toggle = header.querySelector('.mobile-menu-toggle');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.className = 'mobile-menu-toggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-controls', menu.id);
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = '<span aria-hidden="true">☰</span><span>Menu</span>';
      header.insertBefore(toggle, menu);
    }
    // Les icônes et libellés courts sont réservés à la barre mobile.
    const dockIcons = [
      ['appartement', 'Logement', '<path d="M3 10 12 3l9 7v11h-6v-7H9v7H3Z"/>'],
      ['photos', 'Photos', '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>'],
      ['#emplacement', 'Accès', '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>'],
      ['#avis', 'Avis', '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>'],
      ['adresses', 'Adresses', '<path d="M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3Z"/><path d="M12 6v16M6 8h3m-3 4h3m6-4h3m-3 4h3"/>'],
      ['contact', 'Contact', '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/>'],
      ['#demande', 'Réserver', '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-14 5 3 2 5-4"/>']
    ];
    menu.querySelectorAll('a').forEach(link => {
      const icon = dockIcons.find(([fragment]) => link.getAttribute('href')?.includes(fragment));
      if (!icon) return;
      const label = document.createElement('span'); label.className = 'desktop-nav-label'; label.textContent = link.textContent;
      const mobileLabel = document.createElement('span'); mobileLabel.className = 'dock-label'; mobileLabel.textContent = icon[1]; mobileLabel.setAttribute('aria-hidden', 'true');
      const glyph = document.createElement('span'); glyph.className = 'dock-icon'; glyph.setAttribute('aria-hidden', 'true');
      glyph.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + icon[2] + '</svg>';
      link.replaceChildren(glyph, label, mobileLabel);
    });
    const syncDock = () => {
      const page = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
      menu.querySelectorAll('a').forEach(link => {
        const target = new URL(link.href, location.href);
        const path = target.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
        const active = path === page && (target.hash ? target.hash === location.hash : !location.hash);
        link.classList.toggle('dock-current', active);
      });
    };
    syncDock(); window.addEventListener('hashchange', syncDock);
    header.classList.add('mobile-nav-ready');
    const close = () => { header.classList.remove('menu-open'); toggle.setAttribute('aria-expanded', 'false'); };
    toggle.addEventListener('click', () => {
      const open = !header.classList.contains('menu-open');
      header.classList.toggle('menu-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });
    const resetMenuAnimation = () => {
      header.classList.remove('nav-departing');
      menu.querySelectorAll('.nav-clicked').forEach(link => link.classList.remove('nav-clicked'));
    };
    window.addEventListener('pageshow', resetMenuAnimation);
    menu.addEventListener('click', event => {
      const link = event.target.closest('a[href]');
      if (!link) return;
      close();
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
      const target = new URL(link.href, location.href);
      if (target.origin !== location.origin || (target.pathname === location.pathname && target.search === location.search)) return;
      resetMenuAnimation();
      header.classList.add('nav-departing');
      link.classList.add('nav-clicked');
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && header.classList.contains('menu-open')) { close(); toggle.focus(); } });
    document.addEventListener('click', event => { if (!header.contains(event.target)) close(); });
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width:760px), (pointer:coarse)');
  document.addEventListener('pointerdown', () => {
    if (mobile.matches) document.documentElement.classList.add('page-interacting');
  }, {passive:true});
  const native = !mobile.matches && CSS.supports('view-transition-name', 'page') && 'onpagereveal' in window;
  if (!native && !reduced.matches) document.documentElement.classList.add('page-transition-fallback');
  let leaving = false;
  const reset = () => { leaving = false; document.documentElement.classList.remove('page-leaving', 'page-interacting'); };
  window.addEventListener('pageshow', reset);
  document.addEventListener('click', event => {
    if (reduced.matches || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) return;
    if (url.pathname === location.pathname && url.search === location.search) return;
    if (native) return;
    event.preventDefault();
    if (leaving) return;
    leaving = true;
    document.documentElement.classList.add('page-leaving');
    location.assign(url.href);
  });
})();
