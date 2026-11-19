// Guarda só os arquivos do app, para ele abrir rápido. Nenhum dado de paciente passa por aqui:
// pedidos a outros endereços (servidor da agenda, login do Google) nunca são interceptados nem guardados.
var CACHE = 'agenda-v1';
var ARQUIVOS = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARQUIVOS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Primeiro a rede (para pegar sempre a versão nova); sem internet, usa o que está guardado.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(function (res) {
      var copia = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copia); });
      return res;
    }).catch(function () { return caches.match(req); })
  );
});
