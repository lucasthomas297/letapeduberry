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
