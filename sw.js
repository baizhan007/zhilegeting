const CACHE_PREFIX = 'zlt-daily-';
const CACHE_NAME = 'zlt-daily-v24';
const INDEX_FALLBACK = './index.html';
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './tokens.css',
    './challenge-engine.js',
    './audio-engine.js',
    './script.js',
    './manifest.webmanifest',
    './bg_small.jpg',
    './assets/icons/icon-192.png',
    './assets/icons/icon-512.png',
    './assets/memes/seed1.svg',
    './assets/memes/seed2.svg',
    './assets/memes/seed3.svg',
    './assets/memes/seed4.svg',
    './assets/memes/seed5.svg',
    './assets/memes/seed6.svg',
    './assets/memes/seed7.svg',
    './assets/memes/seed8.svg',
    './assets/memes/seed9.svg',
    './assets/memes/seed10.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(
            APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))
        ))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys
                    .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const requestUrl = new URL(event.request.url);
    if (requestUrl.origin !== self.location.origin) return;

    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).then((response) => {
                if (!response.ok) throw new Error('Navigation response was not successful');
                const copy = response.clone();
                return caches.open(CACHE_NAME)
                    .then((cache) => cache.put(INDEX_FALLBACK, copy))
                    .then(() => response);
            }).catch(() => caches.match(INDEX_FALLBACK).then((cached) => cached || new Response(
                'Offline',
                { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
            )))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || fetch(event.request).then((response) => {
            if (!response || !response.ok || response.type === 'opaque') return response;
            const copy = response.clone();
            return caches.open(CACHE_NAME)
                .then((cache) => cache.put(event.request, copy))
                .then(() => response);
        }).catch(() => new Response(null, { status: 503, statusText: 'Offline' })))
    );
});
