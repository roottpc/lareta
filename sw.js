/* La Reta: guarda la app en el celular para que abra rápido; los datos siempre vienen del servidor. */
const VERSION = 'lareta-v15';
const API_URL = 'https://script.google.com/macros/s/AKfycbz_vNGis8Z6NjIQAlXmCfak4rjexlT6C0Gu9oUy11U3eRSNObG5s55dEdAz0UhJkChtKg/exec';
const BASE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-96.png',
  'fonts/barlow-condensed-latin-600-normal.woff2', 'fonts/barlow-condensed-latin-700-normal.woff2', 'fonts/barlow-condensed-latin-800-normal.woff2',
  'fonts/barlow-latin-400-normal.woff2', 'fonts/barlow-latin-500-normal.woff2', 'fonts/barlow-latin-600-normal.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(BASE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (e.request.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('index.html')) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {};
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ('focus' in c) { c.postMessage(data); return c.focus(); } }
    return self.clients.openWindow('./#avisos');
  }));
});

/* Notificación push: llega vacía y aquí se pide el texto del aviso al servidor. */
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let a = null;
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ accion: 'pushPendiente', datos: { endpoint: sub && sub.endpoint } }) });
      const j = await r.json(); a = j && j.ok ? j.data : null;
    } catch (err) {}
    try { if (self.navigator.setAppBadge && a && a.pendientes) self.navigator.setAppBadge(a.pendientes); } catch (err) {}
    await self.registration.showNotification('La Reta', {
      body: a ? a.texto : 'Tienes un aviso nuevo en La Reta',
      icon: 'icons/icon-192.png', badge: 'icons/badge-96.png',
      vibrate: [200, 100, 200, 100, 200], tag: a ? a.id : 'aviso', renotify: true, silent: false,
      requireInteraction: !/android|iphone|ipad|mobile/i.test(self.navigator.userAgent),
      data: { retaId: a ? a.retaId : '' }
    });
  })());
});
