// ==========================================
// BATEOLIVE STANDALONE - SERVICE WORKER
// Per pubblicare un aggiornamento cambia SOLO CACHE_VERSION qui sotto (es. 'v2' -> 'v3'):
// il telefono vede il nuovo sw.js, butta la cache vecchia e ricarica l'app da solo.
// ==========================================
const CACHE_VERSION = 'v3';

const APP_CACHE = `bateolive-app-${CACHE_VERSION}`;   // file dell'app
const LIB_CACHE = `bateolive-lib-${CACHE_VERSION}`;   // librerie esterne (Leaflet, Font Awesome, Firebase, font)

// File dell'app, tenuti pronti anche offline. Percorsi relativi: funzionano ovunque sia pubblicato il sito.
const APP_SHELL = [
    './',
    './index.html',
    './bateolive_standalone.js',
    './turni-core.js',
    './manifest.json',
    './assets/icon.png'
];

// Librerie esterne che si possono tenere in cache. Tutto il resto passa sempre dalla rete:
// API BateoLive, tile della mappa, statistiche Umami, login e dati Firebase.
function eLibreria(url) {
    const h = url.hostname;
    if (h === 'cdnjs.cloudflare.com' || h === 'unpkg.com') return true;
    if (h === 'fonts.googleapis.com' || h === 'fonts.gstatic.com') return true;
    if (h === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) return true;
    return false;
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(APP_CACHE);
        // un file mancante non deve bloccare l'installazione
        await Promise.all(APP_SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const attive = [APP_CACHE, LIB_CACHE];
        const nomi = await caches.keys();
        await Promise.all(nomi.filter((n) => n.startsWith('bateolive-') && !attive.includes(n)).map((n) => caches.delete(n)));
        await self.clients.claim();
    })());
});

// File dell'app: prima la rete (con controllo di aggiornamento, così le modifiche si vedono subito), cache solo se si è offline
async function primaLaRete(req) {
    const cache = await caches.open(APP_CACHE);
    try {
        const fresca = await fetch(req, { cache: 'no-cache' });
        if (fresca && fresca.ok) cache.put(req, fresca.clone());
        return fresca;
    } catch (err) {
        const salvata = await cache.match(req, { ignoreSearch: true });
        if (salvata) return salvata;
        if (req.mode === 'navigate') {
            const pagina = await cache.match('./index.html');
            if (pagina) return pagina;
        }
        throw err;
    }
}

// Librerie esterne: subito dalla cache, e intanto si aggiorna in sottofondo
async function dallaCacheEAggiorna(event, req) {
    const cache = await caches.open(LIB_CACHE);
    const salvata = await cache.match(req);
    const aggiornamento = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
    }).catch(() => null);
    if (salvata) { event.waitUntil(aggiornamento); return salvata; }
    return (await aggiornamento) || Response.error();
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin === self.location.origin) {
        event.respondWith(primaLaRete(req));
    } else if (eLibreria(url)) {
        event.respondWith(dallaCacheEAggiorna(event, req));
    }
});
