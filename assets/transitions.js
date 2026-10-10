(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const native = CSS.supports('view-transition-name', 'page') && 'onpagereveal' in window;
  if (!native && !reduced.matches) document.documentElement.classList.add('page-transition-fallback');
  let leaving = false;
  const reset = () => { leaving = false; document.documentElement.classList.remove('page-leaving'); };
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
