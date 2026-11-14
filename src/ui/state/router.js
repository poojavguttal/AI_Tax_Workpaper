// A tiny hash router: #/queue?kind=error&item=lot_basis:F8949.B.N1

import { useEffect, useState } from 'react';

export function parseHash(hash = window.location.hash) {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  return { path: path || 'overview', params: Object.fromEntries(new URLSearchParams(query)) };
}

export function href(path, params = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return `#/${path}${q ? `?${q}` : ''}`;
}

export function navigate(path, params) {
  window.location.hash = href(path, params);
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
