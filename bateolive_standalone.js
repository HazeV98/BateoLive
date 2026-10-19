// ==========================================
// BATEOLIVE STANDALONE - JS MODULE (versione per uso esterno al TPL)
// Mappa live dei mezzi ACTV, GPS personale con velocità, bussola e orologio, rewind dello storico.
// Nessun accesso e nessun navigatore di turno: il nome della barca si imposta dal tasto "nave" e resta salvato
// su questo dispositivo.
// Grafica: tema chiaro/scuro (segue il sistema, o il tasto sole/luna), tasto + per i pulsanti, pannelli unità/fermate.
// ==========================================

const API_URL = 'https://api.bateolive.stream';
let globalBoats = [];
// Posizioni simulate dall'orario (corse non rilevate dal GPS): disattivate di base, la scelta resta salvata
let bvMostraSimulate = (() => { try { return localStorage.getItem('bv_mostra_simulate') === '1'; } catch (e) { return false; } })();
let globalStops = [];
let map = null;
let oms = null;
let boatMarkers = {};
let otherUsersMarkers = {};
let userMarker = null;
let currentFilterLines = [];
let fetchInterval = null;
let mapDepsLoaded = false;
let activeSelection = null;
// Telecamere in diretta (elenco dal server, solo visione)
let webcams = [];
const webcamMarkers = {};
// Nomi unità (normalizzati) inseriti manualmente da altri utenti: le unità ACTV corrispondenti vengono nascoste
let hiddenActvUnitNames = new Set();

// Livelli Mappa e Stile
let baseOSM, baseSat, nauticLayer;
let currentMapMode = 0; // 0: Base, 1: Satellitare

// Variabili GPS, Identità e Unità Personalizzata
let watchId = null;
let speedHistory = [];
const SMOOTHING_WINDOW_MS = 2000;
let lastValidHeading = null;
let currentUserId = null;
let customUnitName = '';

// Identità locale: nome della barca e id anonimo sono salvati sul dispositivo (mai nome o dati personali dell'utente)
const LS_UNIT_NAME = 'bv_custom_unit';
const LS_USER_ID = 'bv_user_id';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage non disponibile: si va avanti senza */ } };

function caricaIdentitaLocale() {
    customUnitName = (lsGet(LS_UNIT_NAME) || '').trim();
    let id = lsGet(LS_USER_ID);
    if (!id) {
        id = 'user_' + Math.random().toString(36).slice(2, 11);
        lsSet(LS_USER_ID, id);
    }
    currentUserId = id;
}

// Variabili Controllo Vista Mappa
let followUser = false; 
let courseUp = false;

// Modalità Rewind (replay dello storico): vedi sezione REWIND in fondo al file
const rewind = {
    attivo: false, apertura: false, giorni: new Map(), date: null, min: 0, max: 0, t: 0,
    playing: false, speed: 10, speedIdx: 3, dragging: false, editing: false,
    boats: new Map(), markers: {}, layer: null, nVisibili: 0,
    loaded: new Set(), loading: new Set(), pending: 0, sessione: 0, errore: false,
    raf: null, lastTs: 0, lastDraw: 0, lastPota: 0, dirty: true, dt: null,
    cal: { y: 0, m: 0 }
};

const ACTV_COLORS = {
    '1': { bg: '#ffffff', text: '#000000', border: '#000000' },
    '2': { bg: '#e3001b', text: '#ffffff', border: '#e3001b' },
    '2/': { bg: '#e3001b', text: '#ffffff', border: '#e3001b' },
    '3': { bg: '#ff8c00', text: '#000000', border: '#ff8c00' },
    '4.1': { bg: '#bd429b', text: '#ffffff', border: '#bd429b' },
    '4.2': { bg: '#bd429b', text: '#ffffff', border: '#bd429b' },
    '5.1': { bg: '#60b9a6', text: '#000000', border: '#60b9a6' },
    '5.2': { bg: '#60b9a6', text: '#000000', border: '#60b9a6' },
    '6': { bg: '#0070bc', text: '#ffffff', border: '#0070bc' },
    '7': { bg: '#008b54', text: '#ffffff', border: '#008b54' },
    '8': { bg: '#6d4c41', text: '#ffffff', border: '#6d4c41' },
    '9': { bg: '#797b3a', text: '#ffffff', border: '#797b3a' },
    '10': { bg: '#00c1d5', text: '#000000', border: '#00c1d5' },
    '11': { bg: '#f49ab4', text: '#000000', border: '#f49ab4' },
    '12': { bg: '#fced22', text: '#000000', border: '#fced22' },
    '13': { bg: '#583f99', text: '#ffffff', border: '#583f99' },
    '14': { bg: '#f36e21', text: '#000000', border: '#f36e21' },
    '15': { bg: '#fced22', text: '#e3001b', border: '#e3001b' },
    '17': { bg: '#8a8c8e', text: '#ffffff', border: '#8a8c8e' },
    '18': { bg: '#fced22', text: '#000000', border: '#e3001b' },
    '20': { bg: '#cbb3d5', text: '#000000', border: '#cbb3d5' },
    '22': { bg: '#c4d82d', text: '#006600', border: '#006600' },
    'N':  { bg: '#1c355e', text: '#ffffff', border: '#1c355e' },
    'NMU':  { bg: '#1c355e', text: '#ffffff', border: '#1c355e' },
    'NLN':  { bg: '#1c355e', text: '#ffffff', border: '#1c355e' },
    'SA': { bg: '#ff7000', text: '#000000', border: '#ff7000' }
 };

function getLineColors(lineId) {
    if (lineId === '-') return { bg: '#000000', text: '#ffffff', border: '#ffffff' };
    return ACTV_COLORS[lineId] || { bg: '#888888', text: '#ffffff', border: '#888888' };
}

const loadScript = (src) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
});

// ---- Statistiche Umami: il tracker parte solo quando si apre questo modulo ----
// ogni apertura viene registrata come pagina virtuale con un URL proprio del modulo.
const UMAMI_SRC = 'https://api.bateolive.stream/stats/script.js';
const UMAMI_ID = '2b1a80cf-f9e6-4173-9ff3-0c1adefe19e3';
const UMAMI_HOST = 'https://api.bateolive.stream/stats';

function tracciaApertura(urlVirtuale, titolo) {
    const invia = () => window.umami && window.umami.track((p) => ({ ...p, url: urlVirtuale, title: titolo }));
    try {
        if (window.umami) { invia(); return; }
        const esistente = document.querySelector(`script[src="${UMAMI_SRC}"]`);
        if (esistente) { esistente.addEventListener('load', invia); return; }
        const s = document.createElement('script');
        s.defer = true;
        s.src = UMAMI_SRC;
        s.dataset.websiteId = UMAMI_ID;
        s.dataset.hostUrl = UMAMI_HOST;
        s.dataset.autoTrack = 'false';
        s.onload = invia;
        document.head.appendChild(s);
    } catch (e) { /* il tracciamento non deve mai rompere l'app */ }
}

async function loadMapDependencies() {
    if (mapDepsLoaded) return;
    if (!document.getElementById('leaflet-css')) {
        const css = document.createElement('link');
        css.id = 'leaflet-css';
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(css);
    }
    await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/OverlappingMarkerSpiderfier-Leaflet/0.2.6/oms.min.js');
    mapDepsLoaded = true;
}

// ==========================================
// INIEZIONE UI Mappa Completa
// ==========================================
export function initUIBateoLive() {
    if (document.getElementById('modal-bateolive-main')) return;

    const uiHTML = `
    <style>
        /* ---------- Tema: usa le stesse variabili dell'app (come dashboard), chiaro/scuro automatico ---------- */
        #modal-bateolive-main {
            --bv-surface: #ffffff;
            --bv-glass: var(--bv-surface);
            --bv-text: #1e293b;
            --bv-muted: #64748b;
            --bv-border: #e2e8f0;
            --bv-primary: #00529b;
            --bv-danger: #dc3545;
            --bv-ok: #28a745;
            --bv-ok-t: #15803d;
            --bv-bad-t: #b42318;
            --bv-warn-t: #b45309;
            --bv-fill: rgba(128, 128, 128, 0.08);
            --bv-fill-2: rgba(128, 128, 128, 0.16);
            --bv-tint: rgba(0, 82, 155, 0.1);
            --bv-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
            --bv-radius: 14px;
            --bv-sea: #aad3df;
        }
        @supports (color: color-mix(in srgb, red, blue)) {
            #modal-bateolive-main {
                --bv-glass: color-mix(in srgb, var(--bv-surface) 92%, transparent);
                --bv-tint: color-mix(in srgb, var(--bv-primary) 12%, transparent);
            }
        }
        #modal-bateolive-main.bv-dark {
            color-scheme: dark;
            --bv-ok-t: #4ade80;
            --bv-bad-t: #ff7b72;
            --bv-warn-t: #fbbf24;
            --bv-shadow: 0 4px 18px rgba(0, 0, 0, 0.55);
            --bv-sea: #1b2733;
        }

        /* Tema scuro: segue il sistema oppure il tasto sole/luna (solo per la sessione) */
        #modal-bateolive-main.bv-dark { color-scheme: dark; --bv-surface: #1c2430; --bv-text: #e8edf3; --bv-muted: #9aa7b8; --bv-border: #334155; --bv-primary: #3b82f6; --bv-danger: #ef4444; --bv-ok: #22c55e; }
        .bv-fab-tema i.swap { animation: bv-tema-swap 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.2); }
        @keyframes bv-tema-swap {
            0% { transform: rotate(-90deg) scale(0.3); opacity: 0; }
            100% { transform: none; opacity: 1; }
        }

        #modal-bateolive-main { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; background: var(--bv-surface); color: var(--bv-text); display: none; flex-direction: column; font-family: inherit; overflow: hidden; }
        #modal-bateolive-main button, #modal-bateolive-main input { font-family: inherit; }
        #modal-bateolive-main button:focus-visible { outline: 2px solid var(--bv-primary); outline-offset: 2px; }

        #bv-map-wrapper { flex-grow: 1; position: relative; overflow: hidden; background: var(--bv-sea); z-index: 1; }
        #bv-map { width: 200%; height: 200%; position: absolute; top: -50%; left: -50%; z-index: 1; transition: transform 0.2s linear; background: var(--bv-sea); font-family: inherit; }

        /* Mappa base in tema scuro: tile OSM invertite (il satellitare resta com'è) */
        .bv-tiles-osm { transition: filter 0.4s ease; }
        #modal-bateolive-main.bv-dark .bv-tiles-osm { filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9) saturate(0.75); }

        /* Popup Leaflet (altri utenti) */
        #modal-bateolive-main .leaflet-popup-content-wrapper, #modal-bateolive-main .leaflet-popup-tip { background: var(--bv-surface); color: var(--bv-text); box-shadow: var(--bv-shadow); }
        #modal-bateolive-main .leaflet-popup-content { margin: 10px 14px; font-size: 13px; line-height: 1.4; }
        #modal-bateolive-main .leaflet-container a.leaflet-popup-close-button { color: var(--bv-muted); }

        /* Marker */
        .bv-boat-icon { border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; box-shadow: 0 2px 8px rgba(0,0,0,0.45); cursor: pointer; transform: rotate(var(--marker-rotation, 0deg)); transition: transform 0.2s linear, scale 0.2s ease; }
        .bv-boat-icon:hover { scale: 1.15; }
        /* Telecamere in diretta (YouTube) */
        .bv-cam-icon { width: 30px; height: 30px; box-sizing: border-box; border-radius: 50%; background: #b91c1c; color: #fff; border: 2px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; font-size: 13px; transform: rotate(var(--marker-rotation, 0deg)); }
        .bv-cam-badge { width: 26px; height: 26px; border-radius: 50%; background: #b91c1c; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; }
        .bv-cam-player { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 12px; overflow: hidden; }
        .bv-cam-player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
        .bv-cam-link { display: block; margin-top: 12px; text-align: center; font-size: 13px; font-weight: 600; color: var(--bv-primary); text-decoration: none; }
        .bv-fab-s { font-weight: 800; font-size: 19px; line-height: 1; font-family: inherit; }
        /* Unità simulata dall'orario (non rilevata dal GPS): contorno blu e badge S */
        .bv-boat-sim { position: relative; border: 2.5px solid #2f81f7; box-shadow: 0 0 0 2px rgba(47, 129, 247, 0.35), 0 2px 8px rgba(0,0,0,0.45); }
        .bv-sim-badge { position: absolute; top: -8px; right: -8px; width: 15px; height: 15px; box-sizing: border-box; border-radius: 50%; background: #2f81f7; color: #fff; border: 1.5px solid #fff; font-size: 9px; font-weight: 800; line-height: 1; display: flex; align-items: center; justify-content: center; }
        .bv-sim-note { margin: 0 0 10px; padding: 8px 10px; border-radius: 10px; font-size: 12px; line-height: 1.4; color: var(--bv-muted); background: color-mix(in srgb, #2f81f7 12%, transparent); border: 1px solid color-mix(in srgb, #2f81f7 35%, transparent); }

        .bv-stop-icon-wrap { width: 14px; height: 14px; }
        .bv-stop-icon-inner { background: var(--bv-surface); border: 2.5px solid var(--bv-primary); border-radius: 50%; width: 14px; height: 14px; box-sizing: border-box; box-shadow: 0 1px 5px rgba(0,0,0,0.4); cursor: pointer; transition: scale 0.2s ease; }
        .bv-stop-icon-inner:hover { scale: 1.4; }

        /* Badge linea (stessi colori ACTV ovunque) */
        .bv-line-dot { min-width: 24px; height: 24px; padding: 0 4px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; border: 2px solid; flex-shrink: 0; box-sizing: border-box; line-height: 1; }

        /* ---------- Tasti fluttuanti ---------- */
        .bv-profile-btn, .bv-fab { width: 45px; height: 45px; border-radius: 50%; background: var(--bv-glass); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--bv-border); box-shadow: var(--bv-shadow); display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--bv-primary); transition: transform 0.2s, background 0.2s, color 0.2s; }
        .bv-profile-btn { position: absolute; top: calc(20px + env(safe-area-inset-top, 0px)); left: 20px; z-index: 3000; padding: 0; font-size: 18px; }
        #bv-rw-back { display: none; }
        #modal-bateolive-main.rewind-on #bv-rw-back { display: flex; }
        .bv-fab { font-size: 18px; }
        .bv-fab.active { background: var(--bv-primary); border-color: var(--bv-primary); color: #fff; }
        .bv-fab:hover { transform: scale(1.05); }
        .bv-fab-container { position: absolute; bottom: calc(90px + env(safe-area-inset-bottom, 0px)); left: 20px; z-index: 1000; display: flex; flex-direction: column; flex-wrap: wrap; justify-content: flex-end; max-height: calc(100% - 165px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); gap: 15px; pointer-events: none; }
        /* Colonna tasti richiudibile: a cascata dal basso quando si apre, dall'alto quando si chiude */
        .bv-fab-container .bv-fab { pointer-events: auto; opacity: 1; transform: none; transition: transform 0.32s cubic-bezier(0.2, 0.9, 0.3, 1.15), opacity 0.22s ease, background 0.2s, color 0.2s; }
        .bv-fab-container.chiuso .bv-fab { opacity: 0; transform: translateY(26px) scale(0.5); pointer-events: none; transition: transform 0.22s ease-in, opacity 0.18s ease, background 0.2s, color 0.2s; }
        .bv-fab-container:not(.chiuso) .bv-fab:hover { transform: scale(1.05); }
        .bv-fab-menu { position: absolute; bottom: calc(30px + env(safe-area-inset-bottom, 0px)); left: 20px; z-index: 1000; font-size: 18px; }
        .bv-fab-menu i { transition: transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.2); }
        .bv-fab-menu.active i { transform: rotate(180deg); }
        /* ---------- Tasti zoom (in basso a destra, sopra l'HUD velocità se visibile) ---------- */
        .bv-zoom { position: absolute; right: 20px; bottom: calc(30px + env(safe-area-inset-bottom, 0px)); z-index: 1000; display: flex; flex-direction: column; gap: 10px; }
        .bv-zoom .bv-fab { font-size: 18px; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
        .bv-zoom .bv-fab.disabled { opacity: 0.35; pointer-events: none; }
        #modal-bateolive-main.hud-box .bv-zoom { bottom: calc(30px + env(safe-area-inset-bottom, 0px) + var(--bv-hud-box-h, 0px) + 12px); }

        .bv-error-banner { position: absolute; top: calc(20px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%) translateY(-20px); z-index: 1500; background: var(--bv-danger); color: #fff; padding: 10px 18px; border-radius: 12px; font-size: 13px; font-weight: 600; box-shadow: var(--bv-shadow); display: flex; align-items: center; gap: 8px; opacity: 0; pointer-events: none; transition: opacity 0.25s ease, transform 0.25s ease; max-width: 85%; text-align: center; }
        .bv-error-banner.active { opacity: 1; transform: translateX(-50%) translateY(0); }

        /* ---------- HUD bussola ---------- */
        .bv-hud-compass { display: none !important; position: absolute; top: calc(15px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); width: 250px; height: 60px; background: var(--bv-glass); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-radius: 12px; border: 1px solid var(--bv-border); box-shadow: var(--bv-shadow); overflow: hidden; z-index: 1000; align-items: center; justify-content: center; display: none; }
        .bv-compass-tape { position: absolute; top: 10px; left: 0; height: 100%; display: flex; transition: transform 0.15s linear; }
        .bv-compass-mark { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; width: 60px; flex-shrink: 0; }
        .bv-tick { width: 2px; height: 8px; background: var(--bv-muted); opacity: 0.7; margin-bottom: 4px; border-radius: 2px; }
        .bv-tick.major { height: 16px; background: var(--bv-primary); opacity: 1; width: 3px; }
        .bv-compass-label { color: var(--bv-muted); font-size: 12px; font-weight: 600; }
        .bv-compass-label.major { color: var(--bv-text); font-size: 14px; font-weight: 900; }
        .bv-compass-center-line { position: absolute; left: 50%; top: 0; width: 3px; height: 30px; background: var(--bv-danger); transform: translateX(-50%); z-index: 10; border-radius: 2px; }

        /* ---------- HUD velocità + navigatore (compatto, stessa struttura di prima) ---------- */
        .bv-hud-speed { position: absolute; bottom: calc(30px + env(safe-area-inset-bottom, 0px)); right: 20px; background: var(--bv-glass); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); padding: 12px 18px; border-radius: 16px; border: 1px solid var(--bv-border); box-shadow: var(--bv-shadow); z-index: 1000; display: none; }
        .bv-speed-wrapper { display: flex; align-items: baseline; justify-content: center; gap: 5px; }
        .bv-speed-val { font-size: 42px; font-weight: 900; color: var(--bv-primary); line-height: 0.9; font-variant-numeric: tabular-nums; }
        .bv-speed-unit { font-size: 16px; font-weight: bold; color: var(--bv-muted); }

        .bv-clock { display: block; margin-top: 6px; text-align: center; font-size: 17px; font-weight: 800; color: var(--bv-muted); font-variant-numeric: tabular-nums; letter-spacing: 0.5px; line-height: 1; }

        .bv-hud-status { position: absolute; top: calc(15px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); z-index: 1500; background: rgba(0,0,0,0.6); color: white; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: bold; display: none; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }

        /* ---------- Pannello dettagli (unità e fermate) ---------- */
        #bv-drawer { position: absolute; top: calc(15px + env(safe-area-inset-top, 0px)); right: 15px; width: 360px; max-height: calc(100% - 30px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); background: var(--bv-surface); border: 1px solid var(--bv-border); border-radius: 18px; box-shadow: 0 10px 34px rgba(0,0,0,0.3); z-index: 1000; display: flex; flex-direction: column; overflow: hidden; opacity: 0; visibility: hidden; transform: translateX(24px); transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.25s ease, visibility 0s linear 0.3s; }
        #bv-drawer.open { opacity: 1; visibility: visible; transform: none; transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.25s ease, visibility 0s; }
        #bv-drawer-header { display: flex; align-items: center; gap: 12px; padding: 14px 14px 12px 16px; border-bottom: 1px solid var(--bv-border); flex-shrink: 0; }
        #bv-drawer-badge { flex: none; display: flex; align-items: center; justify-content: center; }
        #bv-drawer-badge:empty { display: none; }
        #bv-drawer-badge .bv-line-dot { min-width: 38px; height: 38px; border-radius: 19px; font-size: 14px; }
        .bv-dh-ico { width: 38px; height: 38px; border-radius: 12px; background: var(--bv-tint); color: var(--bv-primary); display: flex; align-items: center; justify-content: center; font-size: 17px; }
        .bv-dh-text { flex: 1; min-width: 0; }
        #bv-drawer-title { margin: 0; font-size: 17px; font-weight: 800; line-height: 1.2; color: var(--bv-text); overflow-wrap: anywhere; }
        #bv-drawer-sub { margin-top: 2px; font-size: 12px; font-weight: 500; color: var(--bv-muted); }
        #bv-close-btn { flex: none; width: 34px; height: 34px; border: none; border-radius: 50%; background: var(--bv-fill-2); color: var(--bv-text); font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.2s; }
        #bv-close-btn:hover { background: var(--bv-border); }
        #bv-drawer-content { padding: 0; overflow-y: auto; flex-grow: 1; overscroll-behavior: contain; }
        .bv-drawer-section { padding: 14px 16px 18px; }
        /* Riquadro fisso sotto l'intestazione: la lista sotto scorre da sola */
        #bv-drawer-pinned { flex-shrink: 0; padding: 14px 16px 12px; border-bottom: 1px solid var(--bv-border); }
        #bv-drawer-pinned:empty { display: none; }
        #bv-drawer-pinned .bv-sum { margin-bottom: 0; }
        #bv-drawer-pinned:not(:empty) + #bv-drawer-content .bv-drawer-section { padding-top: 10px; }

        .bv-sum { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; margin-bottom: 14px; border-radius: 12px; background: var(--bv-fill); border: 1px solid var(--bv-border); }
        .bv-sum-txt { flex: 1; min-width: 0; }
        .bv-sum-lbl { font-size: 12px; font-weight: 600; color: var(--bv-muted); }
        .bv-sum-val { margin-top: 2px; font-size: 15px; font-weight: 800; color: var(--bv-text); overflow-wrap: anywhere; }
        .bv-sum-right { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
        .bv-sum-time { font-size: 22px; font-weight: 900; line-height: 1; color: var(--bv-primary); font-variant-numeric: tabular-nums; }
        .bv-timeline-title { font-size: 13px; font-weight: 700; color: var(--bv-muted); margin: 0 0 6px; }

        .bv-empty { margin: 0; padding: 22px 8px; text-align: center; font-size: 14px; color: var(--bv-muted); }
        .bv-empty.err { color: var(--bv-bad-t); }

        /* Percorso corsa: linea verticale con nodi, come nella finestra corse della dashboard */
        .bv-tl { position: relative; }
        .bv-st { position: relative; display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; }
        .bv-st::before { content: ''; position: absolute; left: 6px; top: 0; bottom: 0; width: 2px; background: var(--bv-border); }
        .bv-st:first-child::before { top: 18px; }
        .bv-st:last-child::before { bottom: calc(100% - 18px); }
        .bv-st-node { position: relative; z-index: 1; flex: none; width: 14px; height: 14px; margin-top: 2px; box-sizing: border-box; border-radius: 50%; background: var(--bv-surface); border: 2.5px solid var(--bv-primary); }
        .bv-st-name { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; color: var(--bv-text); overflow-wrap: anywhere; }
        .bv-st-time { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; text-align: right; font-variant-numeric: tabular-nums; }
        .bv-st-line { font-size: 12px; color: var(--bv-muted); white-space: nowrap; }
        .bv-st-lbl { margin-right: 5px; font-size: 11px; }
        .bv-st-main { font-size: 13px; font-weight: 800; color: var(--bv-text); }
        .bv-st-big { font-size: 15px; }
        .bv-st-here { color: var(--bv-primary); }
        .bv-st-strike { margin-right: 5px; font-size: 12px; font-weight: 400; color: var(--bv-muted); text-decoration: line-through; }
        .bv-st.passata { opacity: 0.55; }
        .bv-st.passata .bv-st-node { background: var(--bv-muted); border-color: var(--bv-muted); }
        .bv-st.passata .bv-st-name { font-weight: 500; color: var(--bv-muted); }
        .bv-st.corrente { margin: 0 -8px; padding: 10px 8px; border-radius: 10px; background: var(--bv-tint); }
        .bv-st.corrente::before { left: 14px; }
        .bv-st.corrente .bv-st-node { background: #ff4757; border-color: var(--bv-surface); box-shadow: 0 0 0 0 rgba(255, 71, 87, 0.45); animation: bv-pulse 1.5s infinite; }
        .bv-st.corrente .bv-st-name { font-weight: 800; }
        @keyframes bv-pulse {
            0% { box-shadow: 0 0 0 0 rgba(255, 71, 87, 0.45); }
            70% { box-shadow: 0 0 0 8px rgba(255, 71, 87, 0); }
            100% { box-shadow: 0 0 0 0 rgba(255, 71, 87, 0); }
        }

        /* Badge ritardo/anticipo: sfondo trasparente + testo colorato, leggibile in entrambi i temi */
        .bv-pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; line-height: 1.4; background: var(--bv-fill-2); white-space: nowrap; }
        .bv-pill-ok { color: var(--bv-ok-t); }
        .bv-pill-bad { color: var(--bv-bad-t); }
        .bv-pill-warn { color: var(--bv-warn-t); }
        @supports (color: color-mix(in srgb, red, blue)) {
            .bv-pill { background: color-mix(in srgb, currentColor 15%, transparent); }
        }

        /* Partenze da una fermata */
        .bv-dep { display: flex; align-items: center; gap: 10px; padding: 10px 12px; margin-bottom: 8px; border: 1px solid var(--bv-border); border-radius: 12px; cursor: pointer; transition: background 0.2s; }
        .bv-dep:active { background: var(--bv-fill); }
        .bv-dep.passata { opacity: 0.55; }
        .bv-dep.corrente { border-left: 4px solid var(--bv-primary); background: var(--bv-tint); }
        .bv-dep-txt { flex: 1; min-width: 0; }
        .bv-dep-dest { font-size: 14px; font-weight: 700; color: var(--bv-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bv-dep-sub { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 12px; font-weight: 600; color: var(--bv-muted); }
        .bv-dep-sub:empty { display: none; }
        .bv-dep-sub .here { color: var(--bv-primary); }
        .bv-dep-msg { margin-left: auto; font-size: 11px; font-weight: 600; }
        .bv-dep-time { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; font-variant-numeric: tabular-nums; }
        .bv-dep-time .bv-st-main { font-size: 16px; }
        .bv-dep-live { flex: none; display: inline-flex; align-items: center; gap: 5px; margin-left: auto; font-size: 11px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: var(--bv-ok-t); }
        .bv-dep-live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--bv-ok); box-shadow: 0 0 0 0 rgba(40, 167, 69, 0.55); animation: bv-live-pulse 1.5s infinite; }
        @keyframes bv-live-pulse {
            0% { box-shadow: 0 0 0 0 rgba(40, 167, 69, 0.55); }
            70% { box-shadow: 0 0 0 6px rgba(40, 167, 69, 0); }
            100% { box-shadow: 0 0 0 0 rgba(40, 167, 69, 0); }
        }

        /* ---------- Finestre (ricerca, filtri, unità) ---------- */
        .bv-modal-overlay { display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 2000; align-items: center; justify-content: center; backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); opacity: 0; transition: opacity 0.2s ease; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); box-sizing: border-box; }
        .bv-modal-overlay.active { display: flex; opacity: 1; }

        .bv-modal { background: var(--bv-surface); color: var(--bv-text); padding: 20px; border-radius: 18px; border: 1px solid var(--bv-border); width: 90%; max-width: 320px; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 10px 34px rgba(0,0,0,0.35); position: relative; }
        .bv-modal h3 { margin: 0 0 15px; color: var(--bv-text); font-size: 17px; font-weight: 800; flex-shrink: 0; }
        .bv-label { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 600; color: var(--bv-muted); }

        .bv-search-container { position: relative; flex-shrink: 0; }
        .bv-modal input[type="text"] { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid var(--bv-border); background: var(--bv-fill); color: var(--bv-text); margin-bottom: 15px; box-sizing: border-box; outline: none; font-size: 14px; }
        .bv-modal input[type="text"]::placeholder { color: var(--bv-muted); opacity: 0.8; }
        .bv-modal input[type="text"]:focus { border-color: var(--bv-primary); box-shadow: 0 0 0 3px var(--bv-tint); }
        .bv-modal-btn { background: var(--bv-primary); color: #fff; border: none; padding: 12px; width: 100%; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 14px; transition: filter 0.2s; flex-shrink: 0; margin-top: 15px; }
        .bv-modal-btn:hover { filter: brightness(0.92); }
        .bv-modal-btn.error { background: var(--bv-danger); }

        .bv-suggestions-dropdown { position: absolute; top: 48px; left: 0; right: 0; background: var(--bv-surface); border-radius: 12px; box-shadow: var(--bv-shadow); max-height: 220px; overflow-y: auto; z-index: 10; display: none; border: 1px solid var(--bv-border); }
        .bv-suggestions-dropdown.active { display: block; }
        .bv-suggestion-item { padding: 12px 15px; border-bottom: 1px solid var(--bv-border); cursor: pointer; display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 500; color: var(--bv-text); }
        .bv-suggestion-item:last-child { border-bottom: none; }
        .bv-suggestion-item:hover { background: var(--bv-tint); color: var(--bv-primary); }
        .bv-sugg-ico { width: 18px; text-align: center; color: var(--bv-primary); font-size: 14px; }
        .bv-suggestion-item.vuoto { justify-content: center; color: var(--bv-muted); cursor: default; }
        .bv-suggestion-item.vuoto:hover { background: transparent; color: var(--bv-muted); }

        .bv-filter-list { display: flex; flex-direction: column; overflow-y: auto; padding-right: 5px; flex-grow: 1; }
        .bv-toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--bv-border); }
        .bv-toggle-row:last-child { border-bottom: none; }
        .bv-toggle-info { display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 14px; color: var(--bv-text); }

        .bv-switch { position: relative; display: inline-block; width: 44px; height: 24px; }
        .bv-switch input { opacity: 0; width: 0; height: 0; }
        .bv-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(128, 128, 128, 0.4); transition: .3s; border-radius: 34px; }
        .bv-slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.25); }
        .bv-switch input:checked + .bv-slider { background-color: var(--bv-ok); }
        .bv-switch input:checked + .bv-slider:before { transform: translateX(20px); }
        .bv-switch input:focus-visible + .bv-slider { outline: 2px solid var(--bv-primary); outline-offset: 2px; }

        #modal-bateolive-main ::-webkit-scrollbar { width: 6px; }
        #modal-bateolive-main ::-webkit-scrollbar-track { background: transparent; }
        #modal-bateolive-main ::-webkit-scrollbar-thumb { background: rgba(128, 128, 128, 0.4); border-radius: 10px; }

        /* ---------- Rewind ---------- */
        #modal-bateolive-main.rewind-on .bv-fab-container,
        #modal-bateolive-main.rewind-on .bv-fab-menu,
        #modal-bateolive-main.rewind-on .bv-zoom,
        #modal-bateolive-main.rewind-on .bv-hud-compass,
        #modal-bateolive-main.rewind-on .bv-hud-speed,
        #modal-bateolive-main.rewind-on .bv-hud-status,
        #modal-bateolive-main.rewind-on .bv-error-banner { display: none !important; }
        #modal-bateolive-main.rewind-on #bv-drawer { top: calc(78px + env(safe-area-inset-top, 0px)); max-height: calc(100% - 78px - 190px - env(safe-area-inset-top, 0px)); }

        .bv-rw-datebar { display: none; position: absolute; top: calc(20px + env(safe-area-inset-top, 0px)); left: 75px; right: 20px; max-width: 420px; height: 45px; z-index: 1500; align-items: center; justify-content: center; gap: 10px; padding: 0 16px; box-sizing: border-box; border: 1px solid var(--bv-border); border-radius: 22px; background: var(--bv-glass); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: var(--bv-shadow); color: var(--bv-primary); font-size: 14px; font-weight: 700; line-height: 1; font-family: inherit; cursor: pointer; }
        .bv-rw-datebar span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bv-rw-datebar i:last-child { font-size: 11px; opacity: 0.7; }
        #modal-bateolive-main.rewind-on .bv-rw-datebar { display: flex; }

        .bv-rw-panel { display: none; position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); width: min(560px, calc(100% - 24px)); box-sizing: border-box; z-index: 1500; padding: 10px 16px 12px; border-radius: 20px; background: var(--bv-glass); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--bv-border); box-shadow: var(--bv-shadow); font-family: inherit; }
        #modal-bateolive-main.rewind-on .bv-rw-panel { display: block; }
        .bv-rw-slider-wrap { position: relative; padding-top: 40px; }
        .bv-rw-bubble { position: absolute; top: 0; left: 0; transform: translateX(-50%); background: var(--bv-primary); border-radius: 10px; padding: 4px 6px; box-shadow: 0 3px 10px rgba(0,0,0,0.3); z-index: 2; }
        .bv-rw-bubble::after { content: ''; position: absolute; top: 100%; left: calc(50% + var(--arrow, 0px)); transform: translateX(-50%); border: 6px solid transparent; border-top-color: var(--bv-primary); }
        .bv-rw-bubble input { width: 96px; border: 0; background: transparent; color: #fff; text-align: center; font-size: 16px; font-weight: 800; font-family: inherit; font-variant-numeric: tabular-nums; outline: none; padding: 2px 0; margin: 0; box-sizing: border-box; }
        .bv-rw-bubble input:focus { background: rgba(255,255,255,0.18); border-radius: 6px; }
        .bv-rw-range { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 28px; margin: 0; background: transparent; cursor: pointer; }
        .bv-rw-range:focus { outline: none; }
        .bv-rw-range::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: linear-gradient(to right, var(--bv-primary) var(--p, 0%), var(--bv-fill-2) var(--p, 0%)); }
        .bv-rw-range::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px; margin-top: -8px; border-radius: 50%; background: #fff; border: 3px solid var(--bv-primary); box-shadow: 0 2px 6px rgba(0,0,0,0.3); }
        .bv-rw-range::-moz-range-track { height: 6px; border-radius: 3px; background: var(--bv-fill-2); }
        .bv-rw-range::-moz-range-progress { height: 6px; border-radius: 3px; background: var(--bv-primary); }
        .bv-rw-range::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 3px solid var(--bv-primary); box-shadow: 0 2px 6px rgba(0,0,0,0.3); }
        .bv-rw-ends { display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; color: var(--bv-muted); margin-top: 2px; font-variant-numeric: tabular-nums; }
        .bv-rw-controls { display: flex; align-items: center; justify-content: center; gap: 22px; margin-top: 8px; }
        .bv-rw-controls button { border: 0; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 46px; height: 46px; font-size: 18px; color: var(--bv-primary); background: var(--bv-tint); }
        .bv-rw-controls button:disabled { opacity: 0.35; cursor: default; }
        #bv-rw-play { width: 58px; height: 58px; font-size: 22px; background: var(--bv-primary); color: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        .bv-rw-speed { text-align: center; margin-top: 6px; font-size: 12px; font-weight: 700; color: var(--bv-muted); }

        .bv-rw-cal { max-width: 340px; }
        .bv-rw-cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .bv-rw-cal-head button { width: 36px; height: 36px; border: 0; border-radius: 50%; background: var(--bv-tint); color: var(--bv-primary); cursor: pointer; }
        .bv-rw-cal-head button:disabled { opacity: 0.3; cursor: default; }
        .bv-rw-cal-title { font-weight: 800; color: var(--bv-text); font-size: 15px; }
        .bv-rw-cal-dow, .bv-rw-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; text-align: center; }
        .bv-rw-cal-dow span { font-size: 11px; font-weight: 700; color: var(--bv-muted); padding: 4px 0; }
        .bv-rw-day { aspect-ratio: 1; border: 0; border-radius: 50%; padding: 0; background: transparent; color: var(--bv-muted); opacity: 0.45; font-size: 14px; font-weight: 600; font-family: inherit; cursor: default; }
        .bv-rw-day.has { color: var(--bv-primary); background: var(--bv-tint); opacity: 1; font-weight: 800; cursor: pointer; }
        .bv-rw-day.sel { background: var(--bv-primary); color: #fff; opacity: 1; }

        /* ---------- Schermi stretti: il pannello diventa un foglio dal basso, la mappa resta visibile ---------- */
        @media (max-width: 599px) {
            #bv-drawer { top: auto; left: 10px; right: 10px; width: auto; bottom: calc(10px + env(safe-area-inset-bottom, 0px)); max-height: 60%; transform: translateY(24px); }
            #bv-drawer.open { transform: none; }
            #modal-bateolive-main:has(#bv-drawer.open) .bv-zoom { opacity: 0; pointer-events: none; }
            #modal-bateolive-main.rewind-on #bv-drawer { top: auto; bottom: 190px; max-height: calc(100% - 78px - 190px - env(safe-area-inset-top, 0px)); }
        }

        @media (prefers-reduced-motion: reduce) {
            #bv-drawer, #bv-drawer.open { transition: none; }
            .bv-st.corrente .bv-st-node { animation: none; }
            .bv-dep-live-dot { animation: none; }
            .bv-fab-container .bv-fab, .bv-fab-container.chiuso .bv-fab, .bv-fab-menu i, .bv-tiles-osm { transition: none; }
            .bv-fab-tema i.swap { animation: none; }
        }
    </style>

    <div id="modal-bateolive-main">

        <!-- Indietro (visibile solo in rewind) -->
        <button id="bv-rw-back" class="bv-profile-btn" type="button" onclick="chiudiRewind()" title="Torna alla mappa" aria-label="Torna alla mappa">
            <i class="fa-solid fa-arrow-left"></i>
        </button>

        <div id="bv-map-wrapper">
            <div id="bv-map"></div>
        </div>

        <!-- HUD Bussola e Stato -->
        <div id="bv-hud-compass" class="bv-hud-compass">
            <div class="bv-compass-center-line"></div>
            <div id="bv-compass-tape" class="bv-compass-tape"></div>
        </div>

        <div id="bv-hud-status" class="bv-hud-status">Acquisizione GPS...</div>

        <!-- HUD Velocità -->
        <div id="bv-hud-speed" class="bv-hud-speed">
            <div class="bv-speed-wrapper">
                <span id="bv-speed-val" class="bv-speed-val">0.0</span>
                <span class="bv-speed-unit">km/h</span>
            </div>
            <div id="bv-clock" class="bv-clock">--:--:--</div>
        </div>

        <!-- Tasti Fluttuanti (FAB) -->
        <div id="bv-error-banner" class="bv-error-banner">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span id="bv-error-banner-text">Impossibile collegarsi al server. Verifica la connessione.</span>
        </div>

        <div class="bv-fab-container chiuso">
            <div id="bv-fab-gps" class="bv-fab" onclick="toggleBvGPS()" title="Attiva/Disattiva GPS">
                <i class="fa-solid fa-satellite-dish"></i>
            </div>
            <div id="bv-fab-center" class="bv-fab" onclick="toggleBvCenterMap()" title="Centra sulla posizione" style="display: none;">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 2L4 20L12 17L20 20L12 2Z"/></svg>
            </div>
            <div id="bv-fab-rotate" class="bv-fab" onclick="toggleBvMapRotation()" title="Rotazione mappa (rotta in alto)" style="display: none;">
                <i class="fa-regular fa-compass"></i>
            </div>
            <div id="bv-fab-layers" class="bv-fab" onclick="cambiaStileBvMappa()" title="Cambia stile cartografico">
                <i class="fa-solid fa-layer-group"></i>
            </div>
            <div id="bv-fab-tema" class="bv-fab bv-fab-tema" onclick="toggleBvTema()" role="button" title="Passa al tema scuro" aria-label="Passa al tema scuro">
                <i class="fa-solid fa-moon"></i>
            </div>
            <div id="bv-fab-unit" class="bv-fab" onclick="apriBateoLiveUnitModal()" title="Nome della tua barca" style="display: none;">
                <i class="fa-solid fa-ship"></i>
            </div>
            <div id="bv-fab-sim" class="bv-fab" onclick="toggleBvSimulate()" role="button" aria-pressed="false" title="Mostra le posizioni simulate dall'orario" aria-label="Mostra le posizioni simulate dall'orario"><span class="bv-fab-s">S</span></div>
            <div id="bv-fab-rewind" class="bv-fab" onclick="apriRewind()" title="Rewind: rivedi i movimenti passati"><i class="fa-solid fa-clock-rotate-left"></i></div>
            <div class="bv-fab" onclick="apriBateoLiveSearchModal()" title="Cerca mezzo o fermata"><i class="fa-solid fa-magnifying-glass"></i></div>
            <div class="bv-fab" onclick="apriBateoLiveFilterModal()" title="Filtra linee"><i class="fa-solid fa-filter"></i></div>
        </div>

        <!-- Apre/chiude la colonna dei tasti (chiusa di base) -->
        <div id="bv-fab-menu" class="bv-fab bv-fab-menu" onclick="toggleBvMenu()" role="button" aria-expanded="false" aria-label="Mostra i tasti" title="Mostra i tasti">
            <i class="fa-solid fa-chevron-up"></i>
        </div>

        <!-- Zoom mappa: passo fine, tarato per viste da ~250 a ~1000 m davanti -->
        <div class="bv-zoom">
            <div id="bv-zoom-in" class="bv-fab" onclick="zoomBvMappa(1)" role="button" aria-label="Avvicina la mappa" title="Zoom +"><i class="fa-solid fa-plus"></i></div>
            <div id="bv-zoom-out" class="bv-fab" onclick="zoomBvMappa(-1)" role="button" aria-label="Allontana la mappa" title="Zoom -"><i class="fa-solid fa-minus"></i></div>
        </div>

        <div id="bv-drawer">
            <div id="bv-drawer-header">
                <div id="bv-drawer-badge"></div>
                <div class="bv-dh-text">
                    <h3 id="bv-drawer-title">Dettagli</h3>
                    <div id="bv-drawer-sub" hidden></div>
                </div>
                <button id="bv-close-btn" type="button" onclick="closeBateoLiveDrawer()" aria-label="Chiudi"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div id="bv-drawer-pinned"></div>
            <div id="bv-drawer-content"></div>
        </div>

        <!-- Rewind: barra data, controlli di riproduzione, calendario -->
        <button id="bv-rw-datebar" class="bv-rw-datebar" type="button" aria-label="Scegli la data">
            <i class="fa-regular fa-calendar"></i><span id="bv-rw-datetxt">--</span><i class="fa-solid fa-chevron-down"></i>
        </button>

        <div id="bv-rw-panel" class="bv-rw-panel">
            <div id="bv-rw-slider-wrap" class="bv-rw-slider-wrap">
                <div id="bv-rw-bubble" class="bv-rw-bubble">
                    <input id="bv-rw-time" type="text" inputmode="numeric" maxlength="8" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Orario">
                </div>
                <input id="bv-rw-range" class="bv-rw-range" type="range" min="0" max="1" step="1" value="0" aria-label="Scorri nel tempo">
            </div>
            <div class="bv-rw-ends"><span id="bv-rw-min">--:--</span><span id="bv-rw-max">--:--</span></div>
            <div class="bv-rw-controls">
                <button id="bv-rw-slower" type="button" aria-label="Più lento"><i class="fa-solid fa-backward"></i></button>
                <button id="bv-rw-play" type="button" aria-label="Play / Pausa"><i class="fa-solid fa-play"></i></button>
                <button id="bv-rw-faster" type="button" aria-label="Più veloce"><i class="fa-solid fa-forward"></i></button>
            </div>
            <div id="bv-rw-speed" class="bv-rw-speed"></div>
        </div>

        <div id="bv-rw-cal-modal" class="bv-modal-overlay">
            <div class="bv-modal bv-rw-cal">
                <div class="bv-rw-cal-head">
                    <button id="bv-rw-cal-prev" type="button" aria-label="Mese precedente"><i class="fa-solid fa-chevron-left"></i></button>
                    <span id="bv-rw-cal-title" class="bv-rw-cal-title"></span>
                    <button id="bv-rw-cal-next" type="button" aria-label="Mese successivo"><i class="fa-solid fa-chevron-right"></i></button>
                </div>
                <div class="bv-rw-cal-dow"><span>L</span><span>M</span><span>M</span><span>G</span><span>V</span><span>S</span><span>D</span></div>
                <div id="bv-rw-cal-grid" class="bv-rw-cal-grid"></div>
            </div>
        </div>

        <!-- Sottomodale Nome barca -->
        <div id="bv-unit-modal" class="bv-modal-overlay" onclick="chiudiBateoLiveModals(event)">
            <div class="bv-modal" onclick="event.stopPropagation()">
                <h3>La tua barca</h3>
                <div style="margin-bottom: 12px;">
                    <label class="bv-label" for="bv-unit-name-input">Nome della barca</label>
                    <input type="text" id="bv-unit-name-input" placeholder="Es. Aurora, Gabbiano" autocomplete="off" maxlength="40">
                    <div style="margin-top: 6px; font-size: 12px; color: var(--bv-muted);">Gli altri utenti vedranno questo nome sulla mappa. Resta salvato su questo dispositivo.</div>
                </div>
                <button class="bv-modal-btn" onclick="salvaConfigurazioneUnita()">Salva</button>
            </div>
        </div>

        <!-- Sottomodale Ricerca -->
        <div id="bv-search-modal" class="bv-modal-overlay" onclick="chiudiBateoLiveModals(event)">
            <div class="bv-modal" onclick="event.stopPropagation()">
                <h3>Cerca mezzo o fermata</h3>
                <div class="bv-search-container">
                    <input type="text" id="bv-search-input" placeholder="Es. Rialto, 4.2..." autocomplete="off">
                    <div id="bv-search-suggestions" class="bv-suggestions-dropdown"></div>
                </div>
                <button id="bv-search-btn" class="bv-modal-btn" onclick="eseguiBateoLiveSearch()">Cerca</button>
            </div>
        </div>

        <!-- Sottomodale Filtri -->
        <div id="bv-filter-modal" class="bv-modal-overlay" onclick="chiudiBateoLiveModals(event)">
            <div class="bv-modal" onclick="event.stopPropagation()">
                <h3>Filtra linee</h3>
                <div id="bv-filter-list" class="bv-filter-list"></div>
                <button class="bv-modal-btn" onclick="applicaBateoLiveFilter()">Applica filtro</button>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', uiHTML);

    // Inizializzazione Tape Bussola
    const tape = document.getElementById('bv-compass-tape');
    let tapeHTML = '';
    const directions = {0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO'};
    for (let cycle = -1; cycle <= 1; cycle++) {
        for (let deg = 0; deg < 360; deg += 10) {
            let isMajor = (deg % 90 === 0);
            let tickClass = 'bv-tick' + (isMajor ? ' major' : '');
            let labelClass = 'bv-compass-label' + (isMajor ? ' major' : '');
            let labelText = directions[deg] !== undefined ? directions[deg] : deg;
            tapeHTML += `<div class="bv-compass-mark"><div class="${tickClass}"></div><div class="${labelClass}">${labelText}</div></div>`;
        }
    }
    tape.innerHTML = tapeHTML;

    window.chiudiBateoLive = chiudiBateoLive;
    window.chiudiBateoLiveModals = chiudiBateoLiveModals;
    window.closeBateoLiveDrawer = closeBateoLiveDrawer;
    window.apriBateoLiveSearchModal = apriBateoLiveSearchModal;
    window.apriBateoLiveFilterModal = apriBateoLiveFilterModal;
    window.apriBateoLiveUnitModal = apriBateoLiveUnitModal;
    window.salvaConfigurazioneUnita = salvaConfigurazioneUnita;
    window.eseguiBateoLiveSearch = eseguiBateoLiveSearch;
    window.applicaBateoLiveFilter = applicaBateoLiveFilter;
    window.selezionaBateoLiveSuggestion = selezionaBateoLiveSuggestion;
    window.locateBateoLiveBoat = locateBateoLiveBoat;
    window.toggleBvGPS = toggleBvGPS;
    window.toggleBvCenterMap = toggleBvCenterMap;
    window.toggleBvMapRotation = toggleBvMapRotation;
    window.cambiaStileBvMappa = cambiaStileBvMappa;
    window.toggleBvMenu = toggleBvMenu;
    window.toggleBvSimulate = toggleBvSimulate;
    aggiornaFabSimulate();
    window.zoomBvMappa = zoomBvMappa;
    window.toggleBvTema = toggleBvTema;
    window.apriRewind = apriRewind;
    window.chiudiRewind = chiudiRewind;

    avviaOrologioHud();
    initRewindUI();

    document.getElementById('bv-search-input').addEventListener('input', async function(e) {
        const q = e.target.value.toLowerCase().trim();
        const suggBox = document.getElementById('bv-search-suggestions');

        if (q.length < 2) {
            suggBox.classList.remove('active');
            return;
        }

        const mStops = globalStops.filter(s => s.name.toLowerCase().includes(q));
        const mBoats = globalBoats.filter(b => b.line.toLowerCase() === q || (!b.simulated && b.label.toLowerCase().includes(q)));

        let html = '';

        mBoats.slice(0, 4).forEach(b => {
            html += `<div class="bv-suggestion-item" onclick="selezionaBateoLiveSuggestion('boat', '${b.id}')">
                        ${bvDotLinea(b.line)} <span>${bvEsc(b.label)}</span>
                     </div>`;
        });

        mStops.slice(0, 5).forEach(s => {
            html += `<div class="bv-suggestion-item" onclick="selezionaBateoLiveSuggestion('stop', '${s.id}')">
                        <i class="fa-solid fa-anchor bv-sugg-ico"></i> <span>${bvEsc(s.name)}</span>
                     </div>`;
        });

        if (!html) html = `<div class="bv-suggestion-item vuoto">Nessun risultato trovato</div>`;

        suggBox.innerHTML = html;
        suggBox.classList.add('active');
    });
}

// ==========================================
// LOGICA DI CONTROLLO MOTORE & GPS
// ==========================================

// ---- Tema chiaro/scuro: segue il sistema; il tasto sole/luna lo forza ----
// Il tema forzato vale solo finché la pagina resta aperta, non viene salvato (null = segue il sistema).
let bvTemaForzato = null;
let bvTemaAvviato = false;

function bvAggiornaIconaTema(scuro, anima) {
    const btn = document.getElementById('bv-fab-tema');
    const ico = btn && btn.querySelector('i');
    if (!ico) return;
    ico.className = scuro ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    const testo = scuro ? 'Passa al tema chiaro' : 'Passa al tema scuro';
    btn.title = testo;
    btn.setAttribute('aria-label', testo);
    if (anima) { void ico.offsetWidth; ico.classList.add('swap'); }
}

function bvAggiornaTema(anima) {
    const root = document.getElementById('modal-bateolive-main');
    if (!root) return;
    const sistemaScuro = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const scuro = bvTemaForzato ? bvTemaForzato === 'dark' : sistemaScuro;
    root.classList.toggle('bv-dark', scuro);
    bvAggiornaIconaTema(scuro, anima === true);
    // barra di stato del telefono in tinta con la mappa
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', scuro ? '#1c2430' : '#ffffff');
}

function toggleBvTema() {
    const root = document.getElementById('modal-bateolive-main');
    if (!root) return;
    bvTemaForzato = root.classList.contains('bv-dark') ? 'light' : 'dark';
    bvAggiornaTema(true);
}

function avviaOsservatoreTema() {
    bvAggiornaTema();
    if (bvTemaAvviato) return;
    bvTemaAvviato = true;
    try {
        if (window.matchMedia) {
            const mq = window.matchMedia('(prefers-color-scheme: dark)');
            if (mq.addEventListener) mq.addEventListener('change', () => bvAggiornaTema());
        }
    } catch (e) { /* il tema non deve mai rompere la mappa */ }
}

export async function avviaMotoreBateoLive() {
    tracciaApertura('/bateolive_standalone', 'BateoLive Standalone');
    caricaIdentitaLocale();

    initUIBateoLive();
    document.getElementById('modal-bateolive-main').style.display = 'flex';
    avviaOsservatoreTema();

    await loadMapDependencies();

    if (!map) {
        // OSM France: stesso stile di OSM ma senza i quadrati sbagliati in laguna.
        // updateWhenIdle:false carica le tile anche mentre scorri (su mobile di default aspetta che ti fermi),
        // keepBuffer più alto tiene in memoria più tile attorno alla vista
        baseOSM = L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
            maxZoom: 19, subdomains: 'abc', className: 'bv-tiles-osm',
            updateWhenIdle: false, updateInterval: 100, keepBuffer: 4
        });

        // Fallback: se OSM France viene bloccato o smette di rispondere, la mappa passa
        // alle tile OSM standard (quelle usate finora) senza intervento dell'utente.
        const OSM_URL_FALLBACK = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
        let osmInFallback = false, osmErroriDiFila = 0;
        baseOSM.on('tileload', () => { osmErroriDiFila = 0; });
        baseOSM.on('tileerror', (e) => {
            if (!navigator.onLine) return;                       // offline: inutile cambiare sorgente
            const t = e.tile, c = e.coords;
            // la tile fallita viene subito richiesta al fallback (una sola volta)
            if (!t._bvFallback && !/tile\.openstreetmap\.org/.test(t.src)) {
                t._bvFallback = true;
                t.src = OSM_URL_FALLBACK.replace('{z}', c.z).replace('{x}', c.x).replace('{y}', c.y);
            }
            // dopo 4 errori consecutivi tutte le tile nuove vanno direttamente al fallback
            if (!osmInFallback && ++osmErroriDiFila >= 4) {
                osmInFallback = true;
                baseOSM.setUrl(OSM_URL_FALLBACK, true);
            }
        });
        baseSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
        nauticLayer = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 18 });

        map = L.map('bv-map', { 
            attributionControl: false, 
            zoomControl: false,
            zoomSnap: 0.25,
            zoomDelta: 0.5,
            layers: [baseOSM, nauticLayer]
        }).setView([45.4371, 12.3326], 13);
        map.on('zoomend zoomlevelschange', aggiornaBvZoomBtn);
        aggiornaBvZoomBtn();

        oms = new OverlappingMarkerSpiderfier(map, {
            keepSpiderfied: true,
            legWeight: 2,
            nearbyDistance: 35
        });

        map.on('dragstart', () => {
            if (followUser && !courseUp) {
                toggleBvCenterMap(false);
            }
        });

        loadStops();
        caricaWebcam();
        fetchAndUpdateBoats();
        fetchInterval = setInterval(() => {
            fetchAndUpdateBoats();
            sincronizzaPosizioneAltriUtenti();
        }, 1500);
    } else {
        setTimeout(() => map.invalidateSize(), 100);
        caricaWebcam();
        if (!fetchInterval) {
            fetchInterval = setInterval(() => {
                fetchAndUpdateBoats();
                sincronizzaPosizioneAltriUtenti();
            }, 1500);
            fetchAndUpdateBoats();
        }
    }
}

function apriBateoLiveUnitModal() {
    document.getElementById('bv-unit-modal').classList.add('active');
    lockBateoLiveMap();
    document.getElementById('bv-unit-name-input').value = customUnitName;
}

function salvaConfigurazioneUnita() {
    customUnitName = document.getElementById('bv-unit-name-input').value.trim();
    lsSet(LS_UNIT_NAME, customUnitName);
    chiudiBateoLiveModals({ target: { classList: { contains: () => true } } });
}

function cambiaStileBvMappa() {
    if (!map) return;
    
    currentMapMode = (currentMapMode + 1) % 2;
    const hudStatus = document.getElementById('bv-hud-status');
    
    if (map.hasLayer(baseOSM)) map.removeLayer(baseOSM);
    if (map.hasLayer(baseSat)) map.removeLayer(baseSat);
    
    if (!map.hasLayer(nauticLayer)) map.addLayer(nauticLayer);

    if (currentMapMode === 0) {
        map.addLayer(baseOSM);
        hudStatus.innerText = "Mappa base nautica";
    } else if (currentMapMode === 1) {
        map.addLayer(baseSat);
        hudStatus.innerText = "Mappa Satellitare";
    }
    
    if (map.hasLayer(nauticLayer)) nauticLayer.bringToFront();

    hudStatus.style.background = "rgba(0, 82, 155, 0.9)";
    hudStatus.style.display = 'block';
    setTimeout(() => {
        if (watchId && !lastValidHeading && document.getElementById('bv-speed-val').textContent === "0.0") {
            hudStatus.innerText = "Acquisizione GPS...";
            hudStatus.style.background = "rgba(0,0,0,0.6)";
        } else {
            hudStatus.style.display = 'none';
        }
    }, 2000);
}

let menuFabAperto = false;
let menuFabTimer = null;
function toggleBvMenu(forza = null) {
    const cont = document.querySelector('#modal-bateolive-main .bv-fab-container');
    const btn = document.getElementById('bv-fab-menu');
    if (!cont || !btn) return;
    const apri = forza !== null ? !!forza : !menuFabAperto;
    menuFabAperto = apri;
    const visibili = [...cont.children].filter(el => el.style.display !== 'none');
    visibili.forEach((el, i) => {
        const dalBasso = visibili.length - 1 - i;
        el.style.transitionDelay = ((apri ? dalBasso : i) * 40) + 'ms';
    });
    cont.classList.toggle('chiuso', !apri);
    btn.classList.toggle('active', apri);
    btn.setAttribute('aria-expanded', String(apri));
    const testo = apri ? 'Nascondi i tasti' : 'Mostra i tasti';
    btn.setAttribute('aria-label', testo);
    btn.title = testo;
    clearTimeout(menuFabTimer);
    menuFabTimer = setTimeout(() => visibili.forEach(el => { el.style.transitionDelay = ''; }), 700);
}

// Zoom a passi di mezzo livello (~x1.41): da 250 a 1000 m davanti sono 4 tocchi, abbastanza fine per rifinire la vista
const ZOOM_PASSO = 0.5;
function zoomBvMappa(verso) {
    if (!map) return;
    const z = map.getZoom() + verso * ZOOM_PASSO;
    map.setZoom(Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), z)));
}

function aggiornaBvZoomBtn() {
    if (!map) return;
    const zin = document.getElementById('bv-zoom-in'), zout = document.getElementById('bv-zoom-out');
    if (zin) zin.classList.toggle('disabled', map.getZoom() >= map.getMaxZoom() - 0.01);
    if (zout) zout.classList.toggle('disabled', map.getZoom() <= map.getMinZoom() + 0.01);
}

function toggleBvCenterMap(forceState = null) {
    followUser = forceState !== null ? forceState : !followUser;
    document.getElementById('bv-fab-center').classList.toggle('active', followUser);
    
    if (followUser && userMarker && map) {
        map.setView(userMarker.getLatLng());
    }
    
    if (!followUser && courseUp) {
        toggleBvMapRotation(false);
    }
}

function toggleBvMapRotation(forceState = null) {
    courseUp = forceState !== null ? forceState : !courseUp;
    const fabRot = document.getElementById('bv-fab-rotate');
    fabRot.classList.toggle('active', courseUp);
    
    const mapEl = document.getElementById('bv-map');

    if (courseUp) {
        if (map) map.dragging.disable();
        if (!followUser) toggleBvCenterMap(true);
        
        let h = lastValidHeading || 0;
        let normalizedHeading = h % 360;
        if (normalizedHeading < 0) normalizedHeading += 360;
        
        mapEl.style.transform = `rotate(-${normalizedHeading}deg)`;
        mapEl.style.setProperty('--marker-rotation', `${normalizedHeading}deg`);
    } else {
        if (map) map.dragging.enable();
        mapEl.style.transform = `rotate(0deg)`;
        mapEl.style.setProperty('--marker-rotation', `0deg`);
    }
}

function toggleBvGPS() {
    const fab = document.getElementById('bv-fab-gps');
    const hudCompass = document.getElementById('bv-hud-compass');
    const hudSpeed = document.getElementById('bv-hud-speed');
    const hudStatus = document.getElementById('bv-hud-status');
    const fabCenter = document.getElementById('bv-fab-center');
    const fabRotate = document.getElementById('bv-fab-rotate');

    if (fab.classList.contains('active')) {
        fab.classList.remove('active');
        hudCompass.style.display = 'none';
        hudSpeed.style.display = 'none';
        hudStatus.style.display = 'none';
        fabCenter.style.display = 'none';
        fabRotate.style.display = 'none';
        document.getElementById('bv-fab-unit').style.display = 'none';
        toggleBvCenterMap(false);
        toggleBvMapRotation(false);
        
        if (watchId) navigator.geolocation.clearWatch(watchId);
        if (userMarker) {
            map.removeLayer(userMarker);
            userMarker = null;
        }
    } else {
        fab.classList.add('active');
        hudCompass.style.display = 'flex';
        hudSpeed.style.display = 'block';
        hudStatus.style.display = 'block';
        hudStatus.innerText = "Acquisizione GPS...";
        hudStatus.style.background = "rgba(0,0,0,0.6)";
        fabCenter.style.display = 'flex';
        fabRotate.style.display = 'flex';
        document.getElementById('bv-fab-unit').style.display = 'flex';
        
        toggleBvCenterMap(true);
        toggleBvMapRotation(true);   // col GPS acceso la mappa ruota subito con la rotta
        speedHistory = [];
        
        watchId = navigator.geolocation.watchPosition(elaboraBvPosizioneGPS, (err) => {
            hudStatus.innerText = "Errore GPS: " + err.message;
            hudStatus.style.background = "rgba(227, 0, 27, 0.8)";
            hudStatus.style.display = 'block';
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
    }
}

function elaboraBvPosizioneGPS(position) {
    const coords = position.coords;
    const now = Date.now();
    
    const hudStatus = document.getElementById('bv-hud-status');
    if (hudStatus.innerText === "Acquisizione GPS...") hudStatus.style.display = 'none'; 
    
    let rawSpeedMs = coords.speed || 0;
    speedHistory.push({ speed: rawSpeedMs, time: now });
    speedHistory = speedHistory.filter(entry => now - entry.time <= SMOOTHING_WINDOW_MS);
    let avgSpeedMs = speedHistory.reduce((sum, entry) => sum + entry.speed, 0) / speedHistory.length;

    let speedKmh = avgSpeedMs * 3.6;
    document.getElementById('bv-speed-val').textContent = speedKmh.toFixed(1);

    if (coords.heading !== null && (rawSpeedMs >= 0.5 || lastValidHeading === null)) {
        lastValidHeading = coords.heading;
    }
    
    let validHeading = lastValidHeading || 0;

    const svgArrow = `
    <div style="transform: rotate(${validHeading}deg); width:32px; height:32px; display:flex; align-items:center; justify-content:center; filter: drop-shadow(0px 3px 6px rgba(0,0,0,0.5)); transition: transform 0.2s linear;">
        <svg width="28" height="28" viewBox="0 0 24 24" style="fill:var(--bv-primary)" stroke="white" stroke-width="1.5" stroke-linejoin="round">
            <path d="M12 2L4 20L12 17L20 20L12 2Z"/>
        </svg>
    </div>`;
    
    const userIcon = L.divIcon({ html: svgArrow, className: '', iconSize: [32,32], iconAnchor: [16,16] });

    if (!userMarker) {
        userMarker = L.marker([coords.latitude, coords.longitude], {
            icon: userIcon, zIndexOffset: 2000
        });
        if (!rewind.attivo) userMarker.addTo(map);
    } else {
        userMarker.setLatLng([coords.latitude, coords.longitude]);
        userMarker.setIcon(userIcon);
    }
    
    if (followUser) map.setView([coords.latitude, coords.longitude]);

    let normalizedHeading = validHeading % 360;
    if (normalizedHeading < 0) normalizedHeading += 360;
    
    if (courseUp) {
        const mapEl = document.getElementById('bv-map');
        mapEl.style.transform = `rotate(-${normalizedHeading}deg)`;
        mapEl.style.setProperty('--marker-rotation', `${normalizedHeading}deg`);
    }

    const tape = document.getElementById('bv-compass-tape');
    const widthPerMark = 60; 
    const pxPerDegree = widthPerMark / 10; 
    const baseOffset = 36 * widthPerMark; 
    const targetX = - (baseOffset + (normalizedHeading * pxPerDegree)) + 125 - 30; 
    tape.style.transform = `translateX(${targetX}px)`;

    inviaBvPosizionePersonale(coords.latitude, coords.longitude, speedKmh, validHeading);
}

function inviaBvPosizionePersonale(lat, lon, speed, heading) {
    if (!currentUserId) return;

    const body = {
        id: currentUserId,
        lat: lat,
        lon: lon,
        speed: speed,
        heading: heading,
        nome: customUnitName || '', // solo il nome della barca: nessun dato personale
        line: ''
    };

    fetch(`${API_URL}/api/users/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).catch(err => console.error("Errore invio posizione:", err));
}

// ---- Finestra unità per i segnali degli altri utenti (corsa condivisa dal loro navigatore) ----
// Mostra linea, prossima fermata, ritardo e fermate; mai il nome dell'utente né il suo turno.
let ultimiUtenti = {};
const corseUtenti = new Map(); // `${uid}|${k}` -> { stato: 'caricamento' | 'ok' | 'errore', fermate, ts }

function bvBadgeRitardo(sec) {
    return Number.isFinite(sec) ? getDelayBadge(sec) : '';
}

function renderUserDrawer(uid) {
    const u = ultimiUtenti[uid];
    if (!u) return;
    activeSelection = { type: 'user', id: uid };
    const c = u.corsa && u.corsa.k ? u.corsa : null;
    const linea = String((c && c.linea) || u.line || '').trim();
    const nome = u.nome ? String(u.nome).trim() : '';
    const titolo = nome || (linea ? `Linea ${linea}` : 'Unità');
    const opts = {
        badge: linea ? bvDotLinea(linea) : '<span class="bv-dh-ico"><i class="fa-solid fa-ship"></i></span>',
        sub: nome ? (linea ? `Linea ${linea}` : '') : 'Segnale utente',
        focusKey: `user-${uid}-${c ? c.k : ''}`
    };
    if (!c) {
        openBateoLiveDrawer(titolo, `<p class="bv-empty">Nessuna corsa condivisa al momento.</p>`, opts);
        return;
    }

    const key = `${uid}|${c.k}`;
    const entry = corseUtenti.get(key);
    if (!entry) {
        // una sola corsa per utente in cache: tolgo le vecchie
        [...corseUtenti.keys()].forEach(k => { if (k.startsWith(uid + '|')) corseUtenti.delete(k); });
        corseUtenti.set(key, { stato: 'caricamento' });
        const fine = (voce) => {
            corseUtenti.set(key, voce);
            if (activeSelection && activeSelection.type === 'user' && activeSelection.id === uid) renderUserDrawer(uid);
        };
        fetch(`${API_URL}/api/users/${encodeURIComponent(uid)}/corsa?k=${encodeURIComponent(c.k)}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => fine(d && Array.isArray(d.fermate) && d.fermate.length ? { stato: 'ok', fermate: d.fermate } : { stato: 'errore', ts: Date.now() }))
            .catch(() => fine({ stato: 'errore', ts: Date.now() }));
        openBateoLiveDrawer(titolo, `<p class="bv-empty">Caricamento…</p>`, opts);
        return;
    }
    if (entry.stato === 'caricamento') {
        openBateoLiveDrawer(titolo, `<p class="bv-empty">Caricamento…</p>`, opts);
        return;
    }
    if (entry.stato === 'errore') {
        if (Date.now() - entry.ts > 5000) corseUtenti.delete(key); // al prossimo aggiornamento riprova
        openBateoLiveDrawer(titolo, `<p class="bv-empty err">Fermate non disponibili.</p>`, opts);
        return;
    }

    const F = entry.fermate;               // [[nome, arrivo, partenza]] in secondi dal giorno del turno (orari programmati)
    const ultimo = F.length - 1;
    const idx = Math.min(Math.max(Math.trunc(c.idx) || 0, 0), ultimo);
    const rit = Number.isFinite(c.ritardo) ? c.ritardo : null;
    const fuoriOrario = rit != null && Math.abs(Math.round(rit / 60)) >= 1;
    const arrivata = c.stato === 'arrivato';
    const inSosta = c.stato === 'in fermata';
    const orarioProg = (i) => (i === ultimo ? F[i][1] : F[i][2]);

    let riepilogo;
    if (arrivata) {
        riepilogo = bvRiepilogo('Arrivata a', F[idx][0], bvBadgeRitardo(rit));
    } else if (inSosta) {
        riepilogo = bvRiepilogo('In sosta a', F[idx][0], bvBadgeRitardo(rit));
    } else {
        const ora = hhmm(orarioProg(idx) + (rit || 0));
        riepilogo = bvRiepilogo('Prossima fermata' + (c.fuori ? ' · fuori percorso' : ''), F[idx][0], `<div class="bv-sum-time">${ora}</div>${bvBadgeRitardo(rit)}`);
    }

    const riga = (etichetta, t) => bvRigaOrario(etichetta, `<b class="bv-st-main">${hhmm(t)}</b>`);
    let html = `<div class="bv-timeline-title">Percorso corsa attuale</div><div class="bv-tl">`;
    F.forEach((f, i) => {
        const passata = i < idx || (arrivata && i === idx);
        const corrente = !passata && inSosta && i === idx;
        const stato = passata ? 'PASSED' : corrente ? 'CURRENT' : 'FUTURE';
        let orari;
        if (stato === 'FUTURE') {
            const t = orarioProg(i);
            orari = fuoriOrario
                ? bvRigaOrario('', `<span class="bv-st-strike">${hhmm(t)}</span><b class="bv-st-main bv-st-big">${hhmm(t + rit)}</b>`)
                : bvRigaOrario('', `<b class="bv-st-main bv-st-big">${hhmm(t)}</b>`);
        } else {
            orari = riga('Arrivo', f[1]);
            if (corrente) orari += bvRigaOrario('Partenza', `<b class="bv-st-main bv-st-here">In sosta…</b>`);
            else if (i !== ultimo) orari += riga('Partenza', f[2]);
        }
        const badge = stato === 'PASSED' ? '' : bvBadgeRitardo(rit);
        html += bvRigaFermata(stato, (inSosta || !arrivata) && i === idx ? ' prossima' : '', f[0], orari, badge);
    });
    html += `</div>`;
    openBateoLiveDrawer(titolo, html, { ...opts, pinned: riepilogo });
}

async function sincronizzaPosizioneAltriUtenti() {
    if (!map || !currentUserId || rewind.attivo) return;
    try {
        const response = await fetch(`${API_URL}/api/users/live`);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const users = await response.json();
        if (rewind.attivo) return;
        const activeIds = Object.keys(users);

        const nextHiddenActvUnitNames = new Set();

        activeIds.forEach(uid => {
            if (uid === currentUserId) return; 

            const u = users[uid];
            const uHeading = u.heading || 0;
            const uLine = u.line ? u.line.trim() : '';

            const normalizedUnitName = normalizzaNomeUnita(u.nome);
            if (normalizedUnitName) nextHiddenActvUnitNames.add(normalizedUnitName);

            let iconHtml = '';
            let iconSize = [32, 32];
            let iconAnchor = [16, 16];

            if (uLine) {
                const c = getLineColors(uLine.toUpperCase());
                iconHtml = `<div class="bv-boat-icon" style="background-color: ${c.bg}; color: ${c.text}; border: 3px solid var(--bv-ok); width: 26px; height: 26px; box-sizing: border-box;">${uLine}</div>`;
                iconSize = [26, 26];
                iconAnchor = [13, 13];
            } else {
                iconHtml = `
                <div style="transform: rotate(${uHeading}deg); width:32px; height:32px; display:flex; align-items:center; justify-content:center; filter: drop-shadow(0px 3px 6px rgba(0,0,0,0.5)); transition: transform 0.2s linear;">
                    <svg width="28" height="28" viewBox="0 0 24 24" style="fill:var(--bv-ok)" stroke="white" stroke-width="1.5" stroke-linejoin="round">
                        <path d="M12 2L4 20L12 17L20 20L12 2Z"/>
                    </svg>
                </div>`;
            }

            const icon = L.divIcon({ html: iconHtml, className: '', iconSize: iconSize, iconAnchor: iconAnchor });

            let popupContent = `<div style="text-align:center;">Velocità: ${parseFloat(u.speed || 0).toFixed(1)} km/h</div>`;
            if (u.nome) {
                popupContent = `<div style="text-align:center;"><b>${bvEsc(u.nome)}</b><br>Velocità: ${parseFloat(u.speed || 0).toFixed(1)} km/h</div>`;
            }

            // con la corsa condivisa il tocco apre la finestra unità; altrimenti resta il popup con la velocità
            ultimiUtenti[uid] = u;
            const conCorsa = !!(u.corsa && u.corsa.k);
            if (otherUsersMarkers[uid]) {
                const m = otherUsersMarkers[uid];
                m.setLatLng([u.lat, u.lon]);
                m.setIcon(icon);
                if (conCorsa) { if (m.getPopup()) m.unbindPopup(); }
                else if (m.getPopup()) m.getPopup().setContent(popupContent);
                else m.bindPopup(popupContent);
            } else {
                const marker = L.marker([u.lat, u.lon], { icon: icon }).addTo(map);
                if (!conCorsa) marker.bindPopup(popupContent);
                marker.on('click', () => {
                    const cu = ultimiUtenti[uid];
                    if (cu && cu.corsa && cu.corsa.k) renderUserDrawer(uid);
                });
                otherUsersMarkers[uid] = marker;
            }
            if (activeSelection && activeSelection.type === 'user' && activeSelection.id === uid) renderUserDrawer(uid);
        });

        Object.keys(otherUsersMarkers).forEach(uid => {
            if (!activeIds.includes(uid)) {
                map.removeLayer(otherUsersMarkers[uid]);
                delete otherUsersMarkers[uid];
                delete ultimiUtenti[uid];
                if (activeSelection && activeSelection.type === 'user' && activeSelection.id === uid) closeBateoLiveDrawer();
            }
        });

        hiddenActvUnitNames = nextHiddenActvUnitNames;
        aggiornaVisibilitaBarcheActv();
    } catch (error) { console.error("Errore ricezione altri utenti:", error); }
}

function lockBateoLiveMap() {
    if (!map) return;
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.doubleClickZoom.disable();
    map.touchZoom.disable();
    if (map.tap) map.tap.disable();
}

function unlockBateoLiveMap() {
    if (!map) return;
    map.dragging.enable();
    map.scrollWheelZoom.enable();
    map.doubleClickZoom.enable();
    map.touchZoom.enable();
    if (map.tap) map.tap.enable();
}

function chiudiBateoLive() {
    if (rewind.attivo) chiudiRewind();
    document.getElementById('modal-bateolive-main').style.display = 'none';
    closeBateoLiveDrawer();
    if (watchId) navigator.geolocation.clearWatch(watchId);
    document.getElementById('bv-hud-compass').style.display = 'none';
    document.getElementById('bv-hud-speed').style.display = 'none';
    fermaOrologioHud();
    document.getElementById('bv-fab-center').style.display = 'none';
    document.getElementById('bv-fab-rotate').style.display = 'none';
    document.getElementById('bv-fab-unit').style.display = 'none';
    toggleBvMenu(false);
    document.getElementById('bv-fab-gps').classList.remove('active');
    
    courseUp = false;
    followUser = false;
    const mapEl = document.getElementById('bv-map');
    mapEl.style.transform = `rotate(0deg)`;
    mapEl.style.setProperty('--marker-rotation', `0deg`);

    if (fetchInterval) {
        clearInterval(fetchInterval);
        fetchInterval = null;
    }
}

let drawerFocusKey = null;

function closeBateoLiveDrawer() {
    const eraWebcam = activeSelection && activeSelection.type === 'webcam';
    activeSelection = null;
    if (eraWebcam) { // togliere l'iframe ferma il video (altrimenti l'audio continua a finestra chiusa)
        const c = document.getElementById('bv-drawer-content');
        if (c) c.innerHTML = '';
    }
    drawerFocusKey = null;
    const drawer = document.getElementById('bv-drawer');
    if (drawer) drawer.classList.remove('open');
}

// opts: { badge: html a sinistra del titolo, sub: riga sotto il titolo, pinned: html fisso sotto l'intestazione (non scorre),
//         focusKey: quando cambia, la lista scorre alla fermata corrente/prossima (gli aggiornamenti live non toccano lo scroll) }
function openBateoLiveDrawer(title, htmlContent, opts = {}) {
    const content = document.getElementById('bv-drawer-content');
    document.getElementById('bv-drawer-title').textContent = title;
    const sub = document.getElementById('bv-drawer-sub');
    sub.textContent = opts.sub || '';
    sub.hidden = !opts.sub;
    document.getElementById('bv-drawer-badge').innerHTML = opts.badge || '';
    content.innerHTML = `<div class="bv-drawer-section">${htmlContent}</div>`;
    const pinned = document.getElementById('bv-drawer-pinned');
    if (pinned) pinned.innerHTML = opts.pinned || '';
    document.getElementById('bv-drawer').classList.add('open');

    if (!opts.focusKey) { drawerFocusKey = null; return; }
    if (opts.focusKey === drawerFocusKey) return;
    const target = content.querySelector('.bv-st.corrente, .bv-st.prossima');
    if (!target) return;
    drawerFocusKey = opts.focusKey;
    const dy = target.getBoundingClientRect().top - content.getBoundingClientRect().top;
    content.scrollTop += dy - content.clientHeight / 3;
}

function chiudiBateoLiveModals(e) {
    if (e && e.target && e.target.classList && !e.target.classList.contains('bv-modal-overlay')) return;
    document.getElementById('bv-search-modal').classList.remove('active');
    document.getElementById('bv-filter-modal').classList.remove('active');
    document.getElementById('bv-unit-modal').classList.remove('active');
    document.getElementById('bv-search-suggestions').classList.remove('active');

    unlockBateoLiveMap();

    const searchBtn = document.getElementById('bv-search-btn');
    if (searchBtn) {
        searchBtn.innerText = "Cerca";
        searchBtn.classList.remove("error");
    }
}

function apriBateoLiveSearchModal() {
    document.getElementById('bv-search-modal').classList.add('active');
    lockBateoLiveMap();
    const input = document.getElementById('bv-search-input');
    input.value = '';
    setTimeout(() => input.focus(), 50);
}

async function openBateoLiveFilterModalInternal() {
    document.getElementById('bv-filter-modal').classList.add('active');
    lockBateoLiveMap();
    try {
        const lines = [...new Set(globalBoats.map(b => b.line).filter(l => l !== '-'))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        let html = '';
        lines.forEach(line => {
            const isChecked = currentFilterLines.length === 0 || currentFilterLines.includes(line) ? 'checked' : '';
            const c = getLineColors(line);

            html += `
            <div class="bv-toggle-row">
                <div class="bv-toggle-info">
                    <div class="bv-line-dot" style="background-color: ${c.bg}; color: ${c.text}; border-color: ${c.border};">${line}</div>
                    <span>Linea ${line}</span>
                </div>
                <label class="bv-switch">
                    <input type="checkbox" value="${line}" class="bv-line-filter-cb" ${isChecked}>
                    <span class="bv-slider"></span>
                </label>
            </div>`;
        });
        document.getElementById('bv-filter-list').innerHTML = html || '<p class="bv-empty">Nessuna linea attiva trovata.</p>';
    } catch (e) {}
}

function apriBateoLiveFilterModal() {
    openBateoLiveFilterModalInternal();
}

function applicaBateoLiveFilter() {
    const checkboxes = document.querySelectorAll('.bv-line-filter-cb');
    const allChecked = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);

    if (allChecked.length === checkboxes.length || allChecked.length === 0) {
        currentFilterLines = [];
    } else {
        currentFilterLines = allChecked;
    }

    chiudiBateoLiveModals({ target: { classList: { contains: () => true } } });

    Object.keys(boatMarkers).forEach(id => {
        oms.removeMarker(boatMarkers[id]);
        map.removeLayer(boatMarkers[id]);
        delete boatMarkers[id];
    });
    fetchAndUpdateBoats();
}

function selezionaBateoLiveSuggestion(type, id) {
    chiudiBateoLiveModals({ target: { classList: { contains: () => true } } });
    if (type === 'stop') {
        const stop = globalStops.find(s => s.id === id);
        if (stop) {
            map.setView([stop.lat, stop.lon], 16);
            renderStopDrawer(stop);
        }
    } else if (type === 'boat') {
        const boat = globalBoats.find(b => b.id === id);
        if (boat) {
            map.setView([boat.lat, boat.lon], 16);
            renderBoatDrawer(boat);
        }
    }
}

function eseguiBateoLiveSearch() {
    const query = document.getElementById('bv-search-input').value.toLowerCase().trim();
    const btn = document.getElementById('bv-search-btn');

    if (!query) return;

    const suggBox = document.getElementById('bv-search-suggestions');
    const items = suggBox.querySelectorAll('.bv-suggestion-item');

    if (items.length > 0 && items[0].innerText !== 'Nessun risultato trovato') {
        items[0].click();
        return;
    }

    btn.innerText = "Nessun Risultato";
    btn.classList.add("error");
    setTimeout(() => {
        btn.innerText = "Cerca";
        btn.classList.remove("error");
    }, 2000);
}

// true se la corsa è accoppiata a un'unità live che locateBateoLiveBoat() può mostrare
function bvCorsaConUnita(staticTripId, liveBoatId) {
    if (liveBoatId && globalBoats.some(b => !b.simulated && b.id === liveBoatId)) return true;
    return globalBoats.some(b => !b.simulated && b.tripId === staticTripId);
}

// Corse della finestra fermata aperta: servono per aprire il percorso di una corsa non rilevata dal GPS
let bvCorseFermata = {};

function bvUnitaDaOrario(staticTripId) {
    const arr = bvCorseFermata[staticTripId] || {};
    return { id: 'sim-' + staticTripId, label: 'Corsa da orario', line: arr.routeId || '-', tripId: staticTripId, simulated: true, destination: arr.destination || '' };
}

function locateBateoLiveBoat(staticTripId, liveBoatId) {
    let boat = null;
    if (liveBoatId) {
        boat = globalBoats.find(b => !b.simulated && b.id === liveBoatId);
    }
    if (!boat) {
        boat = globalBoats.find(b => !b.simulated && b.tripId === staticTripId);
    }

    if (boat) {
        map.setView([boat.lat, boat.lon], 16);
        renderBoatDrawer(boat);
        return;
    }

    // Corsa non rilevata dal GPS: si apre il percorso con tutte le fermate e gli orari programmati
    const sim = globalBoats.find(b => b.simulated && b.tripId === staticTripId);
    if (sim) map.setView([sim.lat, sim.lon], 16);
    renderBoatDrawer(sim || bvUnitaDaOrario(staticTripId));
}

function showBateoLiveError(show, message) {
    const banner = document.getElementById('bv-error-banner');
    if (!banner) return;
    if (message) document.getElementById('bv-error-banner-text').innerText = message;
    banner.classList.toggle('active', !!show);
}

function formatTime(unixTimestamp) {
    if (!unixTimestamp || isNaN(unixTimestamp)) return '--:--';
    const d = new Date(unixTimestamp * 1000);
    return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function getDelayBadge(delaySec) {
    if (delaySec === null || delaySec === undefined) return ''; // corsa non rilevata: nessun ritardo noto, niente "In orario"
    if (delaySec === 0) return `<span class="bv-pill bv-pill-ok">In orario</span>`;
    const min = Math.round(delaySec / 60);
    if (min >= 1) return `<span class="bv-pill bv-pill-bad" title="In ritardo di ${min} min">+${min}'</span>`;
    if (min <= -1) return `<span class="bv-pill bv-pill-warn" title="In anticipo di ${-min} min">${min}'</span>`;
    return `<span class="bv-pill bv-pill-ok">In orario</span>`;
}

const bvEsc = (v) => (v == null ? '' : String(v)).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Badge della linea con i colori ACTV (gli stessi di mappa e navigatore)
function bvDotLinea(line) {
    const c = getLineColors(String(line).toUpperCase());
    return `<span class="bv-line-dot" style="background-color:${c.bg};color:${c.text};border-color:${c.border};">${bvEsc(line)}</span>`;
}

// Riquadro di riepilogo in cima al pannello
function bvRiepilogo(etichetta, valore, destra = '') {
    return `<div class="bv-sum"><div class="bv-sum-txt"><div class="bv-sum-lbl">${etichetta}</div><div class="bv-sum-val">${bvEsc(valore)}</div></div>${destra ? `<div class="bv-sum-right">${destra}</div>` : ''}</div>`;
}

// Riga del percorso: nodo sulla linea verticale, nome fermata, orari e badge
function bvRigaFermata(stato, extra, nome, orari, badge) {
    const cls = stato === 'PASSED' ? 'passata' : (stato === 'CURRENT' ? 'corrente' : 'futura');
    return `<div class="bv-st ${cls}${extra || ''}"><span class="bv-st-node"></span><span class="bv-st-name">${bvEsc(nome)}</span><div class="bv-st-time">${orari}${badge || ''}</div></div>`;
}

function bvRigaOrario(etichetta, valore, extraClass = '') {
    return `<div class="bv-st-line">${etichetta ? `<span class="bv-st-lbl">${etichetta}</span>` : ''}${valore}</div>`;
}

function buildTimeLine(label, scheduled, estimated, isDelayed) {
    if (estimated) {
        if (isDelayed && scheduled) {
            return bvRigaOrario(label, `<span class="bv-st-strike">${formatTime(scheduled)}</span><b class="bv-st-main">${formatTime(estimated)}</b>`);
        }
        return bvRigaOrario(label, `<b class="bv-st-main">${formatTime(scheduled || estimated)}</b>`);
    }
    return bvRigaOrario(label, `<b class="bv-st-main">--:--</b>`);
}

async function renderBoatDrawer(boat) {
    activeSelection = { type: 'boat', data: boat };
    const opts = {
        badge: bvDotLinea(boat.line),
        sub: [boat.line && boat.line !== '-' ? `Linea ${boat.line}` : '', boat.simulated && boat.lat ? 'posizione stimata' : ''].filter(Boolean).join(' · '),
        focusKey: `boat-${boat.id}`
    };

    if (!boat.tripId) {
        openBateoLiveDrawer(boat.label, `<p class="bv-empty">In attesa di assegnazione corsa…</p>`, opts);
        return;
    }

    try {
        const res = await fetch(`${API_URL}/api/trip/${boat.tripId}/${boat.id}`);
        const stopTimes = await res.json();

        if (!activeSelection || activeSelection.type !== 'boat' || activeSelection.data.id !== boat.id) return;

        if (stopTimes.length === 0) {
            openBateoLiveDrawer(boat.label, `<p class="bv-empty">Nessun orario disponibile per la corsa.</p>`, opts);
            return;
        }

        // riepilogo: dove si trova l'unità adesso (in sosta) o qual è la prossima fermata
        const idxCorr = stopTimes.findIndex(st => st.status === 'CURRENT');
        const idxProx = idxCorr >= 0 ? idxCorr : stopTimes.findIndex(st => st.status === 'FUTURE');
        const prox = stopTimes[idxProx];
        let riepilogo;
        if (!prox) {
            riepilogo = bvRiepilogo('Stato', 'Corsa terminata');
        } else if (idxCorr >= 0) {
            riepilogo = bvRiepilogo('In sosta a', prox.stopName, getDelayBadge(prox.delay));
        } else {
            const ora = formatTime(prox.estimatedDeparture || prox.estimatedArrival || prox.scheduledDeparture || prox.scheduledArrival);
            riepilogo = bvRiepilogo('Prossima fermata', prox.stopName, `<div class="bv-sum-time">${ora}</div>${getDelayBadge(prox.delay)}`);
        }

        // corsa non rilevata dal GPS: l'avviso resta fissato in alto, sopra il riepilogo della prossima fermata
        const simNote = boat.simulated
            ? `<div class="bv-sim-note">${boat.lat ? 'Corsa non rilevata dal GPS: <b>posizione stimata</b> in base all\'orario programmato, il ritardo non è noto.' : 'Corsa non rilevata dal GPS: orari programmati, il ritardo non è noto.'}</div>`
            : '';
        let html = `<div class="bv-timeline-title">${boat.simulated ? 'Percorso corsa · orari programmati' : 'Percorso corsa attuale'}</div><div class="bv-tl">`;
        stopTimes.forEach((st, i) => {
            const isOffSchedule = Math.abs(Math.round(st.delay / 60)) >= 1;

            let orari;
            if (st.status === 'FUTURE') {
                const targetSched = st.scheduledDeparture || st.scheduledArrival;
                const targetEst = st.estimatedDeparture || st.estimatedArrival;
                if (targetEst) {
                    if (isOffSchedule && targetSched) {
                        orari = bvRigaOrario('', `<span class="bv-st-strike">${formatTime(targetSched)}</span><b class="bv-st-main bv-st-big">${formatTime(targetEst)}</b>`);
                    } else {
                        orari = bvRigaOrario('', `<b class="bv-st-main bv-st-big">${formatTime(targetSched || targetEst)}</b>`);
                    }
                } else {
                    orari = bvRigaOrario('', `<b class="bv-st-main bv-st-big">--:--</b>`);
                }
            } else {
                const arrHtml = buildTimeLine('Arrivo', st.scheduledArrival, st.estimatedArrival, isOffSchedule);
                const depHtml = st.status === 'CURRENT'
                    ? bvRigaOrario('Partenza', `<b class="bv-st-main bv-st-here">In sosta…</b>`)
                    : buildTimeLine('Partenza', st.scheduledDeparture, st.estimatedDeparture, isOffSchedule);
                orari = arrHtml + depHtml;
            }

            html += bvRigaFermata(st.status, i === idxProx ? ' prossima' : '', st.stopName, orari, getDelayBadge(st.delay));
        });
        html += `</div>`;
        openBateoLiveDrawer(boat.label, html, { ...opts, pinned: simNote + riepilogo });
    } catch (e) { console.error(e); }
}

async function renderStopDrawer(stop) {
    if (rewind.attivo) return; // in rewind le fermate non mostrano i dati live
    activeSelection = { type: 'stop', data: stop };
    const opts = { badge: '<span class="bv-dh-ico"><i class="fa-solid fa-anchor"></i></span>', sub: 'Fermata' };
    try {
        const res = await fetch(`${API_URL}/api/stop/${stop.id}`);
        const arrivals = await res.json();

        if (!activeSelection || activeSelection.type !== 'stop' || activeSelection.data.id !== stop.id) return;

        bvCorseFermata = {};
        arrivals.forEach(a => { bvCorseFermata[a.tripId] = a; });
        let html = `<div class="bv-timeline-title">Partenze da un'ora fa alle prossime 3 ore</div>`;
        if (arrivals.length === 0) {
            html += `<p class="bv-empty">Nessuna partenza in programma.</p>`;
        } else {
            arrivals.forEach(arr => {
                const badgeHtml = getDelayBadge(arr.delay);
                const isOffSchedule = Math.abs(Math.round(arr.delay / 60)) >= 1;

                let timeHtml;
                if (arr.estimated) {
                    if (isOffSchedule && arr.scheduled) {
                        timeHtml = bvRigaOrario('', `<span class="bv-st-strike">${formatTime(arr.scheduled)}</span><b class="bv-st-main">${formatTime(arr.estimated)}</b>`);
                    } else {
                        timeHtml = bvRigaOrario('', `<b class="bv-st-main">${formatTime(arr.scheduled || arr.estimated)}</b>`);
                    }
                } else {
                    timeHtml = bvRigaOrario('', `<b class="bv-st-main">--:--</b>`);
                }

                const cls = arr.status === 'PASSED' ? ' passata' : (arr.status === 'CURRENT' ? ' corrente' : '');
                let stato = '';
                if (arr.status === 'PASSED') stato = '<span>Partito</span>';
                else if (arr.status === 'CURRENT') stato = '<span class="here">In sosta</span>';

                const dest = bvEsc(arr.destination || 'Sconosciuta');
                html += `
                <div class="bv-dep${cls}" onclick="locateBateoLiveBoat('${arr.tripId}', '${arr.liveBoatId || ''}')">
                    ${bvDotLinea(arr.routeId)}
                    <div class="bv-dep-txt">
                        <div class="bv-dep-dest" title="${dest}">${dest}</div>
                        <div class="bv-dep-sub">${stato}<span id="msg-${arr.tripId}" class="bv-dep-msg"></span></div>
                    </div>
                    ${bvCorsaConUnita(arr.tripId, arr.liveBoatId) ? '<span class="bv-dep-live" title="Unità accoppiata: tocca per vederla in mappa"><span class="bv-dep-live-dot"></span>live</span>' : ''}
                    <div class="bv-dep-time">${timeHtml}${badgeHtml}</div>
                </div>`;
            });
        }
        openBateoLiveDrawer(stop.name, html, opts);
    } catch (e) { console.error(e); }
}

async function loadStops() {
    try {
        const res = await fetch(`${API_URL}/api/stops`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        globalStops = await res.json();
        showBateoLiveError(false);
        
        const stopIcon = L.divIcon({ html: '<div class="bv-stop-icon-inner"></div>', className: 'bv-stop-icon-wrap', iconSize: [14, 14], iconAnchor: [7, 7] });

        globalStops.forEach(stop => {
            const marker = L.marker([stop.lat, stop.lon], { icon: stopIcon }).addTo(map);
            marker.on('click', () => renderStopDrawer(stop));
            oms.addMarker(marker);
        });
    } catch (e) {
        console.error("Errore caricamento fermate:", e);
        showBateoLiveError(true, "Impossibile collegarsi al server. Verifica la connessione.");
    }
}

// Normalizza un nome unità per il confronto: maiuscolo, senza prefisso M/S M/B M/N M/Z
// (con o senza slash/spazio, es. "M/S 200", "MS200", "M/S200" -> "200"), e senza spazi/simboli superflui.
function normalizzaNomeUnita(nome) {
    if (!nome) return '';
    return nome
        .toUpperCase()
        .replace(/\bM\s*\/?\s*[SBNZ]\b\.?\s*/g, '')
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim();
}

// Crea/aggiorna/rimuove il marker di una singola unità ACTV, nascondendola se un altro
// utente ha inserito manualmente lo stesso nome unità (i suoi dati GPS sono più precisi).
function renderOrHideBoatMarker(boat) {
    if (!boat.lat || !boat.lon) return;

    if (currentFilterLines.length > 0 && !currentFilterLines.includes(boat.line.toUpperCase())) {
        if (boatMarkers[boat.id]) {
            oms.removeMarker(boatMarkers[boat.id]);
            map.removeLayer(boatMarkers[boat.id]);
            delete boatMarkers[boat.id];
        }
        return;
    }

    const normalizedLabel = normalizzaNomeUnita(boat.label);
    if (normalizedLabel && hiddenActvUnitNames.has(normalizedLabel)) {
        if (boatMarkers[boat.id]) {
            oms.removeMarker(boatMarkers[boat.id]);
            map.removeLayer(boatMarkers[boat.id]);
            delete boatMarkers[boat.id];
        }
        return;
    }

    const c = getLineColors(boat.line.toUpperCase());
    const iconHtml = boat.simulated
        ? `<div class="bv-boat-icon bv-boat-sim" style="background-color: ${c.bg}; color: ${c.text}; width: 26px; height: 26px; box-sizing: border-box;">${boat.line}<span class="bv-sim-badge">S</span></div>`
        : `<div class="bv-boat-icon" style="background-color: ${c.bg}; color: ${c.text}; border: 2.5px solid ${c.border}; width: 26px; height: 26px; box-sizing: border-box;">${boat.line}</div>`;
    const customBoatIcon = L.divIcon({ html: iconHtml, className: '', iconSize: [26, 26], iconAnchor: [13, 13] });

    if (boatMarkers[boat.id]) {
        boatMarkers[boat.id].setLatLng([boat.lat, boat.lon]);
        boatMarkers[boat.id].setIcon(customBoatIcon);
        boatMarkers[boat.id].off('click').on('click', () => renderBoatDrawer(boat));
    } else {
        const marker = L.marker([boat.lat, boat.lon], { icon: customBoatIcon, zIndexOffset: boat.simulated ? 500 : 1000 }).addTo(map);
        marker.on('click', () => renderBoatDrawer(boat));
        oms.addMarker(marker);
        boatMarkers[boat.id] = marker;
    }

    if (activeSelection && activeSelection.type === 'boat' && activeSelection.data.id === boat.id) {
        renderBoatDrawer(boat);
    }
}

// Riapplica la logica di visibilità (usata quando cambia l'elenco degli altri utenti)
// senza dover rifare la fetch delle unità ACTV.
function aggiornaVisibilitaBarcheActv() {
    if (!map) return;
    globalBoats.forEach(boat => renderOrHideBoatMarker(boat));
}

function aggiornaFabSimulate() {
    const fab = document.getElementById('bv-fab-sim');
    if (!fab) return;
    fab.classList.toggle('active', bvMostraSimulate);
    fab.setAttribute('aria-pressed', bvMostraSimulate ? 'true' : 'false');
    const t = bvMostraSimulate ? 'Nascondi le posizioni simulate' : "Mostra le posizioni simulate dall'orario";
    fab.title = t;
    fab.setAttribute('aria-label', t);
}

function toggleBvSimulate() {
    bvMostraSimulate = !bvMostraSimulate;
    try { localStorage.setItem('bv_mostra_simulate', bvMostraSimulate ? '1' : '0'); } catch (e) {}
    aggiornaFabSimulate();
    if (!bvMostraSimulate) {
        // spegnendo, le unità simulate spariscono subito senza aspettare il prossimo aggiornamento
        globalBoats = globalBoats.filter(b => !b.simulated);
        Object.keys(boatMarkers).forEach(id => {
            if (!id.startsWith('sim-')) return;
            oms.removeMarker(boatMarkers[id]);
            map.removeLayer(boatMarkers[id]);
            delete boatMarkers[id];
        });
    }
    fetchAndUpdateBoats();
}

// ==========================================
// TELECAMERE IN DIRETTA (YouTube) - sola visione
// Segnalini sulla mappa che aprono la diretta. L'elenco sta sul server (data/webcam.json) e si modifica
// solo dalla versione completa di BateoLive.
// ==========================================
const escWc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function iconaWebcam() {
    return L.divIcon({ html: '<div class="bv-cam-icon"><i class="fa-solid fa-video"></i></div>', className: '', iconSize: [30, 30], iconAnchor: [15, 15] });
}

function urlEmbedWebcam(w) {
    const base = 'https://www.youtube-nocookie.com/embed/';
    const p = 'autoplay=1&mute=1&playsinline=1&rel=0';
    return w.tipo === 'canale'
        ? `${base}live_stream?channel=${encodeURIComponent(w.ytId)}&${p}`
        : `${base}${encodeURIComponent(w.ytId)}?${p}`;
}

function apriPlayerWebcam(w) {
    activeSelection = { type: 'webcam', id: w.id };
    const html = `<div class="bv-cam-player"><iframe src="${escWc(urlEmbedWebcam(w))}" title="${escWc(w.nome)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
        <a class="bv-cam-link" href="${escWc(w.url)}" target="_blank" rel="noopener noreferrer">Apri su YouTube</a>`;
    openBateoLiveDrawer(w.nome, html, { badge: '<span class="bv-cam-badge"><i class="fa-solid fa-video"></i></span>', sub: 'Telecamera in diretta' });
}

function disegnaWebcam() {
    if (!map) return;
    const ids = new Set(webcams.map(w => w.id));
    Object.keys(webcamMarkers).forEach(id => {
        if (ids.has(id)) return;
        map.removeLayer(webcamMarkers[id]);
        delete webcamMarkers[id];
    });
    webcams.forEach(w => {
        const m = webcamMarkers[w.id];
        if (m) { m.setLatLng([w.lat, w.lon]); return; }
        const nuovo = L.marker([w.lat, w.lon], { icon: iconaWebcam(), zIndexOffset: 300, title: w.nome, keyboard: false }).addTo(map);
        nuovo.on('click', () => {
            const c = webcams.find(x => x.id === w.id);
            if (c) apriPlayerWebcam(c);
        });
        webcamMarkers[w.id] = nuovo;
    });
}

async function caricaWebcam() {
    try {
        const r = await fetch(`${API_URL}/api/webcam`);
        if (!r.ok) return;
        const lista = await r.json();
        if (!Array.isArray(lista)) return;
        webcams = lista;
        disegnaWebcam();
    } catch (e) { /* senza rete restano quelle già in mappa */ }
}

async function fetchAndUpdateBoats() {
    if (!map || rewind.attivo) return;
    try {
        const response = await fetch(`${API_URL}/api/vaporetti/live${bvMostraSimulate ? '?sim=1' : ''}`);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const boats = await response.json();
        if (rewind.attivo) return;
        globalBoats = boats;
        showBateoLiveError(false);

        // le unità sparite dal feed (o corse simulate finite) non devono restare ferme in mappa
        const idsAttuali = new Set(boats.map(b => b.id));
        Object.keys(boatMarkers).forEach(id => {
            if (idsAttuali.has(id)) return;
            oms.removeMarker(boatMarkers[id]);
            map.removeLayer(boatMarkers[id]);
            delete boatMarkers[id];
        });

        boats.forEach(boat => renderOrHideBoatMarker(boat));

        if (activeSelection && activeSelection.type === 'stop') {
            renderStopDrawer(activeSelection.data);
        }

    } catch (error) {
        console.error("Errore di rete:", error);
        showBateoLiveError(true, "Impossibile collegarsi al server. Verifica la connessione.");
    }
}

// ==========================================
// ORARIO, GEOMETRIA E OROLOGIO HUD
// ==========================================
const pad2 = (n) => String(n).padStart(2, '0');

// secondi dall'inizio di un giorno -> "HH:MM" (oltre le 24 riparte da 00:00)
function hhmm(sec) {
    const min = Math.floor(sec / 60);
    return `${pad2(((Math.floor(min / 60) % 24) + 24) % 24)}:${pad2(((min % 60) + 60) % 60)}`;
}

function interpola(xs, ys, v) {
    // ys in funzione di xs (xs crescente), con estremi bloccati
    if (v <= xs[0]) return ys[0];
    const n = xs.length - 1;
    if (v >= xs[n]) return ys[n];
    let lo = 0, hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= v) lo = mid; else hi = mid; }
    const span = xs[hi] - xs[lo];
    const t = span > 0 ? (v - xs[lo]) / span : 0;
    return ys[lo] + t * (ys[hi] - ys[lo]);
}


// L'orologio (ore:minuti:secondi, ora del dispositivo) gira solo finché il modulo è aperto.
// L'altezza del riquadro velocità arriva al CSS tramite --bv-hud-box-h, così i tasti zoom restano sopra.
let orologioTimer = null, hudObserver = null;

function aggiornaOrologio() {
    const el = document.getElementById('bv-clock');
    if (!el) return;
    const t = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    if (el.textContent !== t) el.textContent = t;
}

function aggiornaSpazioHud() {
    const hud = document.getElementById('bv-hud-speed'), root = document.getElementById('modal-bateolive-main');
    if (!hud || !root) return;
    const h = hud.offsetHeight;
    root.classList.toggle('hud-box', h > 0);
    root.style.setProperty('--bv-hud-box-h', h > 0 ? h + 'px' : '0px');
}

function avviaOrologioHud() {
    aggiornaOrologio();
    if (!orologioTimer) orologioTimer = setInterval(aggiornaOrologio, 250);
    const hud = document.getElementById('bv-hud-speed');
    if (hud && typeof ResizeObserver === 'function' && !hudObserver) {
        hudObserver = new ResizeObserver(aggiornaSpazioHud);
        hudObserver.observe(hud);
    }
}

function fermaOrologioHud() {
    if (orologioTimer) { clearInterval(orologioTimer); orologioTimer = null; }
    if (hudObserver) { hudObserver.disconnect(); hudObserver = null; }
}

// ==========================================
// REWIND: rivedi come si sono mossi i mezzi in un giorno registrato dal server.
// Il server filtra e riduce i dati (/api/history/...): qui si scaricano solo finestre da 10 minuti,
// si uniscono per battello e si interpola linearmente tra una posizione registrata e la successiva.
// ==========================================
const RW_TZ = 'Europe/Rome';           // i giorni dello storico seguono il fuso del server
const RW_VELOCITA = [1, 2, 5, 10, 30, 60, 120, 300];
const RW_VELOCITA_INIZIALE = 3;        // x10
const RW_CHUNK = 600;                  // secondi di storico per richiesta
const RW_MARGINE = 60;                 // ogni richiesta copre un minuto in più per lato, così a cavallo dei blocchi si interpola senza buchi
const RW_STEP = 10;                    // secondi minimi tra due punti dello stesso battello
const RW_GAP_MAX = 150;                // oltre questo buco tra due punti non si interpola (il battello non era registrato)
const RW_HOLD = 90;                    // dopo l'ultimo punto noto il battello resta fermo ancora per tanto, poi sparisce
const RW_MEMORIA = 5400;               // dati più lontani di così dalla posizione attuale vengono scartati (più del massimo precaricamento)
const RW_FPS_MS = 33;

const rwFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: RW_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
});

// unix -> data e ora "a muro" in Europe/Rome
function rwParti(unix) {
    const o = {};
    for (const p of rwFmt.formatToParts(new Date(unix * 1000))) o[p.type] = p.value;
    return { date: `${o.year}-${o.month}-${o.day}`, h: +o.hour, m: +o.minute, s: +o.second };
}
function rwOffset(unix) {
    const p = rwParti(unix);
    const [y, mo, d] = p.date.split('-').map(Number);
    return Date.UTC(y, mo - 1, d, p.h, p.m, p.s) / 1000 - unix;
}
// "2026-10-06" + ora a muro -> unix (corretto anche nei giorni del cambio ora)
function romeToUnix(date, h = 0, m = 0, s = 0) {
    const [y, mo, d] = date.split('-').map(Number);
    const asUTC = Date.UTC(y, mo - 1, d, h, m, s) / 1000;
    const prima = asUTC - rwOffset(asUTC);
    return asUTC - rwOffset(prima);
}
function rwOra(unix, conSecondi = false) {
    const p = rwParti(unix);
    return `${pad2(p.h)}:${pad2(p.m)}` + (conSecondi ? ':' + pad2(p.s) : '');
}
// "10:30", "10.30.15", "1030", "930", "103015" -> {h, m, s}; null se non valido
function rwParseOra(txt) {
    const s = String(txt || '').trim();
    let h, m, sec = 0;
    let mt = /^(\d{1,2})[:.,\s](\d{1,2})(?:[:.,\s](\d{1,2}))?$/.exec(s);
    if (mt) { h = +mt[1]; m = +mt[2]; sec = +(mt[3] || 0); }
    else if (/^\d{3,6}$/.test(s)) {
        const d = (s.length === 3 || s.length === 5) ? '0' + s : s;
        h = +d.slice(0, 2); m = +d.slice(2, 4); sec = d.length === 6 ? +d.slice(4, 6) : 0;
    } else return null;
    if (h > 23 || m > 59 || sec > 59) return null;
    return { h, m, s: sec };
}
// unisce due liste di punti [t, lat, lon, ritardo] ordinate per tempo, senza doppioni
function rwUnisci(a, b) {
    const tutti = a.concat(b).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const p of tutti) if (!out.length || out[out.length - 1][0] !== p[0]) out.push(p);
    return out;
}
// posizione di un battello all'istante t: interpolazione lineare tra due punti registrati
function rwPosizione(pts, t) {
    const n = pts.length;
    if (!n || t < pts[0][0]) return null;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pts[mid][0] <= t) lo = mid; else hi = mid - 1; }
    const a = pts[lo], b = pts[lo + 1];
    if (!b || b[0] - a[0] > RW_GAP_MAX) return (t - a[0] <= RW_HOLD) ? [a[1], a[2]] : null;
    const f = (t - a[0]) / (b[0] - a[0]);
    return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
const rwChunk = (t) => Math.floor(t / RW_CHUNK);

// celle del calendario di un mese (settimana da lunedì): null = vuota, altrimenti {key, d, has, sel}
function rwCalGriglia(y, m, giorni, selezionato) {
    const vuote = (new Date(y, m, 1).getDay() + 6) % 7;
    const n = new Date(y, m + 1, 0).getDate();
    const celle = Array(vuote).fill(null);
    for (let d = 1; d <= n; d++) {
        const key = `${y}-${pad2(m + 1)}-${pad2(d)}`;
        celle.push({ key, d, has: giorni.has(key), sel: key === selezionato });
    }
    return celle;
}

function rwAvviso(msg) {
    showBateoLiveError(true, msg);
    setTimeout(() => showBateoLiveError(false), 3500);
}

// Mezzi live, utente e rotta spariscono dalla mappa mentre si è in rewind (si rimettono all'uscita)
function rwNascondiLive() {
    Object.values(boatMarkers).forEach(m => map.removeLayer(m));
    Object.values(otherUsersMarkers).forEach(m => map.removeLayer(m));
    if (userMarker) map.removeLayer(userMarker);
}
function rwRimettiLive() {
    Object.values(boatMarkers).forEach(m => { if (!map.hasLayer(m)) m.addTo(map); });
    Object.values(otherUsersMarkers).forEach(m => { if (!map.hasLayer(m)) m.addTo(map); });
    if (userMarker && !map.hasLayer(userMarker)) userMarker.addTo(map);
}

async function apriRewind() {
    if (!map || rewind.attivo || rewind.apertura) return;
    rewind.apertura = true;
    let giorni;
    try {
        const res = await fetch(`${API_URL}/api/history/days`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        giorni = (await res.json()).filter(g => g && Array.isArray(g.hours) && g.hours.length);
    } catch (e) {
        console.error('Rewind: storico non raggiungibile', e);
        rewind.apertura = false;
        rwAvviso('Impossibile caricare lo storico. Riprova.');
        return;
    }
    rewind.apertura = false;
    if (!giorni.length) { rwAvviso('Nessuna registrazione disponibile per ora.'); return; }
    giorni.sort((a, b) => b.date.localeCompare(a.date));

    closeBateoLiveDrawer();
    chiudiBateoLiveModals({ target: { classList: { contains: () => true } } });
    if (courseUp) toggleBvMapRotation(false);
    if (followUser) toggleBvCenterMap(false);

    rewind.attivo = true;
    rwNascondiLive();
    rewind.giorni = new Map(giorni.map(g => [g.date, g]));
    rewind.layer = L.layerGroup().addTo(map);
    rewind.speedIdx = RW_VELOCITA_INIZIALE;
    rewind.speed = RW_VELOCITA[rewind.speedIdx];
    rewind.playing = false;

    document.getElementById('modal-bateolive-main').classList.add('rewind-on');

    rwImpostaGiorno(giorni[0].date);
    rwSetPlaying(false);
    rewind.lastTs = 0;
    rewind.raf = requestAnimationFrame(rwTick);
}

function chiudiRewind() {
    if (!rewind.attivo) return;
    rewind.attivo = false;
    rewind.playing = false;
    if (rewind.raf) cancelAnimationFrame(rewind.raf);
    rewind.raf = null;
    rewind.sessione++;                 // scarta i caricamenti ancora in corso
    clearTimeout(rewind.dt);
    rwChiudiCal();
    closeBateoLiveDrawer();
    if (rewind.layer) { map.removeLayer(rewind.layer); rewind.layer = null; }
    rewind.markers = {};
    rewind.boats = new Map();
    rewind.loaded.clear();
    rewind.loading.clear();

    document.getElementById('modal-bateolive-main').classList.remove('rewind-on');

    rwRimettiLive();
    fetchAndUpdateBoats();
    sincronizzaPosizioneAltriUtenti();
}

// Cambia giorno (o imposta il primo): azzera i dati, calcola l'intervallo della barra e carica i blocchi attorno a tInit
function rwImpostaGiorno(date, tInit) {
    rewind.sessione++;
    rewind.date = date;
    rewind.boats = new Map();
    rewind.loaded.clear();
    rewind.loading.clear();
    rewind.pending = 0;
    rewind.errore = false;
    if (rewind.layer) rewind.layer.clearLayers();
    rewind.markers = {};

    const ore = rewind.giorni.get(date).hours.map(Number).sort((a, b) => a - b);
    rewind.min = romeToUnix(date, ore[0]);
    rewind.max = romeToUnix(date, ore[ore.length - 1] + 1);
    const ora = Math.floor(Date.now() / 1000);
    if (rewind.min < ora && ora < rewind.max) rewind.max = ora;      // oggi: non oltre adesso

    let t = tInit;
    if (t === undefined) t = (ora > rewind.min && ora <= rewind.max) ? ora - 1800 : rewind.min;
    rewind.t = Math.min(Math.max(t, rewind.min), rewind.max);

    const d = new Date(...date.split('-').map((v, i) => i === 1 ? v - 1 : +v));
    const txt = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('bv-rw-datetxt').textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
    document.getElementById('bv-rw-min').textContent = rwOra(rewind.min);
    document.getElementById('bv-rw-max').textContent = rwOra(rewind.max);
    rwSetPlaying(false);
    rwEnsure(rewind.t, 2);
    rewind.dirty = true;
    rwAggiornaUI();
}

// ---------------------------------------------------------------- caricamento dati
function rwEnsure(t, avanti = 1) {
    for (let c = rwChunk(t); c <= rwChunk(t) + avanti; c++) {
        if ((c + 1) * RW_CHUNK < rewind.min || c * RW_CHUNK > rewind.max) continue;
        rwCaricaChunk(c);
    }
}

async function rwCaricaChunk(c) {
    if (rewind.loaded.has(c) || rewind.loading.has(c)) return;
    const sessione = rewind.sessione, date = rewind.date;
    rewind.loading.add(c);
    rewind.pending++;
    rwAggiornaEtichetta();
    try {
        const a = rwParti(c * RW_CHUNK - RW_MARGINE), b = rwParti((c + 1) * RW_CHUNK + RW_MARGINE);
        const from = a.date === date ? `${pad2(a.h)}:${pad2(a.m)}` : '00:00';
        const to = b.date === date ? `${pad2(b.h)}:${pad2(b.m)}` : null;
        let url = `${API_URL}/api/history/${date}/frames?from=${from}&step=${RW_STEP}`;
        if (to && to > from) url += `&to=${to}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const dati = await res.json();
        if (sessione !== rewind.sessione) return;                 // nel frattempo si è cambiato giorno o si è usciti
        for (const [id, bt] of Object.entries(dati.boats || {})) {
            let tb = rewind.boats.get(id);
            if (!tb) { tb = { line: bt.line, label: bt.label || null, pts: [] }; rewind.boats.set(id, tb); }
            if (bt.line && bt.line !== '-') tb.line = bt.line;
            if (bt.label) tb.label = bt.label;
            tb.pts = rwUnisci(tb.pts, bt.pts);
        }
        rewind.loaded.add(c);
        rewind.errore = false;
        rewind.dirty = true;
    } catch (e) {
        if (sessione !== rewind.sessione) return;
        console.error('Rewind: errore caricamento', e);
        rewind.errore = true;
        rwSetPlaying(false);
    } finally {
        if (sessione === rewind.sessione) {
            rewind.loading.delete(c);
            rewind.pending = Math.max(0, rewind.pending - 1);
            rwAggiornaEtichetta();
        }
    }
}

// libera memoria: via i dati troppo lontani dall'istante attuale (si riscaricano se servono)
function rwPota() {
    const c0 = rwChunk(rewind.t - RW_MEMORIA), c1 = rwChunk(rewind.t + RW_MEMORIA);
    rewind.boats.forEach((b, id) => {
        b.pts = b.pts.filter(p => { const c = rwChunk(p[0]); return c >= c0 && c <= c1; });
        if (!b.pts.length) rewind.boats.delete(id);
    });
    for (const c of [...rewind.loaded]) if (c < c0 || c > c1) rewind.loaded.delete(c);
}

// ---------------------------------------------------------------- riproduzione e disegno
function rwTick(ts) {
    if (!rewind.attivo) return;
    rewind.raf = requestAnimationFrame(rwTick);
    const dt = rewind.lastTs ? Math.min((ts - rewind.lastTs) / 1000, 0.25) : 0;
    rewind.lastTs = ts;

    if (rewind.playing && !rewind.dragging && !rewind.editing) {
        if (rewind.loaded.has(rwChunk(rewind.t))) {
            rewind.t += dt * rewind.speed;
            if (rewind.t >= rewind.max) { rewind.t = rewind.max; rwSetPlaying(false); }
        }
        // precarica i blocchi davanti, in proporzione alla velocità
        rwEnsure(rewind.t, Math.min(8, Math.ceil(rewind.speed * 8 / RW_CHUNK) + 1));
        rewind.dirty = true;
    }
    if (ts - rewind.lastPota > 10000) { rewind.lastPota = ts; rwPota(); }
    if (rewind.dirty && (!rewind.playing || ts - rewind.lastDraw >= RW_FPS_MS)) {
        rewind.lastDraw = ts;
        rewind.dirty = false;
        rwDisegna();
    }
}

function rwIcona(line) {
    const c = getLineColors(String(line || '-').toUpperCase());
    const html = `<div class="bv-boat-icon" style="background-color: ${c.bg}; color: ${c.text}; border: 2.5px solid ${c.border}; width: 26px; height: 26px; box-sizing: border-box;">${bvEsc(line || '-')}</div>`;
    return L.divIcon({ html, className: '', iconSize: [26, 26], iconAnchor: [13, 13] });
}

function rwDisegna() {
    if (!rewind.layer) return;
    const t = rewind.t, visibili = new Set();
    rewind.boats.forEach((b, id) => {
        const pos = rwPosizione(b.pts, t);
        if (!pos) return;
        visibili.add(id);
        let m = rewind.markers[id];
        if (!m) {
            m = L.marker(pos, { icon: rwIcona(b.line), zIndexOffset: 1000, keyboard: false });
            m.on('click', () => rwApriBarca(id));
            m.addTo(rewind.layer);
            m.rwLine = b.line;
            rewind.markers[id] = m;
        } else {
            if (m.rwLine !== b.line) { m.setIcon(rwIcona(b.line)); m.rwLine = b.line; }
            m.setLatLng(pos);
        }
    });
    for (const id of Object.keys(rewind.markers)) {
        if (!visibili.has(id)) { rewind.layer.removeLayer(rewind.markers[id]); delete rewind.markers[id]; }
    }
    rewind.nVisibili = visibili.size;
    rwAggiornaUI();
    rwAggiornaBarca();
}

function rwSetPlaying(si) {
    rewind.playing = si;
    const btn = document.getElementById('bv-rw-play');
    if (btn) btn.innerHTML = si ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
    rewind.dirty = true;
}

function rwAggiornaEtichetta() {
    const el = document.getElementById('bv-rw-speed');
    if (!el) return;
    let txt = `×${rewind.speed}`;
    if (rewind.errore) txt = 'Errore di rete: riprova con Play';
    else if (rewind.pending > 0 && !rewind.loaded.has(rwChunk(rewind.t))) txt = 'Caricamento…';
    else txt += ` · ${rewind.nVisibili || 0} mezzi`;
    el.textContent = txt;
    document.getElementById('bv-rw-slower').disabled = rewind.speedIdx === 0;
    document.getElementById('bv-rw-faster').disabled = rewind.speedIdx === RW_VELOCITA.length - 1;
}

// barra, fumetto con l'ora e etichetta
function rwAggiornaUI() {
    const range = document.getElementById('bv-rw-range');
    const span = Math.max(1, rewind.max - rewind.min);
    range.max = String(span);
    if (!rewind.dragging) range.value = String(Math.round(rewind.t - rewind.min));
    const pct = Math.min(1, Math.max(0, (rewind.t - rewind.min) / span));
    range.style.setProperty('--p', (pct * 100).toFixed(2) + '%');

    const wrap = document.getElementById('bv-rw-slider-wrap');
    const bubble = document.getElementById('bv-rw-bubble');
    const W = wrap.clientWidth, bw = bubble.offsetWidth || 100;
    const thumbX = 11 + pct * Math.max(0, W - 22);
    const x = Math.min(Math.max(thumbX, bw / 2), Math.max(bw / 2, W - bw / 2));
    bubble.style.left = x + 'px';
    bubble.style.setProperty('--arrow', (thumbX - x) + 'px');

    const inp = document.getElementById('bv-rw-time');
    if (!rewind.editing) inp.value = rwOra(rewind.t, true);
    rwAggiornaEtichetta();
}

function rwVaiA(t) {
    rewind.t = Math.min(Math.max(t, rewind.min), rewind.max);
    rewind.dirty = true;
    rwDisegna();
    clearTimeout(rewind.dt);
    rewind.dt = setTimeout(() => rwEnsure(rewind.t, 2), 120);   // niente raffica di richieste mentre si trascina
}

function rwConfermaOra() {
    const inp = document.getElementById('bv-rw-time');
    rewind.editing = false;
    const p = rwParseOra(inp.value);
    if (p) rwVaiA(romeToUnix(rewind.date, p.h, p.m, p.s));
    else rwAggiornaUI();                                         // non valido: torna all'ora attuale
}

// ---------------------------------------------------------------- calendario
function rwApriCal() {
    const [y, m] = rewind.date.split('-').map(Number);
    rewind.cal = { y, m: m - 1 };
    rwDisegnaCal();
    document.getElementById('bv-rw-cal-modal').classList.add('active');
    lockBateoLiveMap();
}
function rwChiudiCal() {
    const el = document.getElementById('bv-rw-cal-modal');
    if (el && el.classList.contains('active')) { el.classList.remove('active'); unlockBateoLiveMap(); }
}
function rwDisegnaCal() {
    const { y, m } = rewind.cal;
    const mesi = [...rewind.giorni.keys()].map(k => k.slice(0, 7)).sort();
    const cur = `${y}-${pad2(m + 1)}`;
    document.getElementById('bv-rw-cal-prev').disabled = !(mesi[0] < cur);
    document.getElementById('bv-rw-cal-next').disabled = !(mesi[mesi.length - 1] > cur);
    const titolo = new Date(y, m, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    document.getElementById('bv-rw-cal-title').textContent = titolo.charAt(0).toUpperCase() + titolo.slice(1);
    const celle = rwCalGriglia(y, m, new Set(rewind.giorni.keys()), rewind.date);
    document.getElementById('bv-rw-cal-grid').innerHTML = celle.map(c => c
        ? `<button type="button" class="bv-rw-day${c.has ? ' has' : ''}${c.sel ? ' sel' : ''}" data-day="${c.key}"${c.has ? '' : ' disabled'}>${c.d}</button>`
        : '<span></span>').join('');
}

// ---------------------------------------------------------------- dettaglio battello (dallo storico)
// ---- Pannello unità in rewind: segue il tempo che scorre ----
// Tiene i dati della corsa e ridisegna le fermate (passate / in sosta / prossima) a ogni cambio di stato;
// se l'unità passa a una corsa successiva, carica da sola quella nuova.
let rewindBarca = null;

function rwScegliCorsa(corse, t) {
    let corsa = corse.find(c => c.first - 600 <= t && t <= c.last + 600);
    if (!corsa) corsa = [...corse].reverse().find(c => c.first <= t);
    return corsa || null;
}

function rwBarcaAncora(d) {
    return rewindBarca === d && rewind.attivo && activeSelection && activeSelection.type === 'rewind' && activeSelection.id === d.id;
}

function rwBarcaIntestazione(d) {
    const det = d.det;
    const lineaFinale = (det && det.line) || d.linea;
    const nome = d.nomeUnita || (det && det.boatLabel) || null;
    return {
        titolo: nome || `Linea ${lineaFinale}`,
        badge: bvDotLinea(lineaFinale),
        sub: `${nome ? `Linea ${lineaFinale} · ` : ''}Rewind alle ${rwOra(rewind.t, true)}`
    };
}

function rwRenderBarca(forza = false) {
    const d = rewindBarca;
    if (!d || !d.det) return;
    const t = rewind.t, det = d.det;

    let primo = true;
    const righe = det.stops.map(s => {
        const dep = s.departure, arr = s.arrival;
        const passata = dep !== null && dep <= t;
        const inSosta = !passata && arr <= t;
        const stato = passata ? 'PASSED' : (inSosta ? 'CURRENT' : 'FUTURE');
        const extra = (!passata && primo && !inSosta) ? ' prossima' : '';
        if (!passata) primo = false;
        return { s, dep, arr, stato, extra };
    });
    const firma = righe.map(r => r.stato[0] + (r.extra ? 'n' : '')).join('');
    const intest = rwBarcaIntestazione(d);

    // stesso stato di prima: si aggiorna solo l'orario del rewind nel sottotitolo
    if (!forza && firma === d.firma) {
        const sub = document.getElementById('bv-drawer-sub');
        if (sub && d.subTxt !== intest.sub) { sub.textContent = intest.sub; d.subTxt = intest.sub; }
        return;
    }

    // se la fermata corrente era in vista, dopo l'aggiornamento la lista la segue; se hai scorso altrove non ti sposta
    const content = document.getElementById('bv-drawer-content');
    let segui = false;
    if (!forza && d.firma && content) {
        const vecchio = content.querySelector('.bv-st.corrente, .bv-st.prossima');
        if (vecchio) {
            const r = vecchio.getBoundingClientRect(), c = content.getBoundingClientRect();
            segui = r.bottom > c.top && r.top < c.bottom;
        }
    }

    let html = `<div class="bv-timeline-title">Passaggi registrati</div><div class="bv-tl">`;
    righe.forEach(({ s, dep, arr, stato, extra }) => {
        const orari = bvRigaOrario('Programmato', `<b class="bv-st-main">${rwOra(s.scheduled)}</b>`)
            + bvRigaOrario('Arrivo', `<b class="bv-st-main">${rwOra(arr)}</b>`)
            + (dep !== null ? bvRigaOrario('Partenza', `<b class="bv-st-main">${rwOra(dep)}</b>`) : '');
        html += bvRigaFermata(stato, extra, s.stopName || s.stopId, orari, getDelayBadge(s.delay));
    });
    html += `</div>`;
    const riepilogo = det.headsign ? bvRiepilogo('Destinazione', det.headsign) : '';

    openBateoLiveDrawer(intest.titolo, html, { badge: intest.badge, sub: intest.sub, pinned: riepilogo, focusKey: `rw-${d.id}-${d.trip}` });
    d.firma = firma;
    d.subTxt = intest.sub;

    if (segui && content) {
        const nuovo = content.querySelector('.bv-st.corrente, .bv-st.prossima');
        if (nuovo) {
            const dy = nuovo.getBoundingClientRect().top - content.getBoundingClientRect().top;
            content.scrollTo({ top: content.scrollTop + dy - content.clientHeight / 3, behavior: 'smooth' });
        }
    }
}

async function rwCaricaCorsaBarca(d, corsa) {
    d.caricando = true;
    try {
        const r = await fetch(`${API_URL}/api/history/${d.date}/trip/${encodeURIComponent(corsa.trip)}`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const det = await r.json();
        if (!rwBarcaAncora(d)) return;
        d.trip = corsa.trip; d.det = det; d.firma = ''; d.caricando = false;
        rwRenderBarca(true);
    } catch (e) {
        console.error('Rewind: dettaglio battello', e);
        d.caricando = false; d.errore = true;
        if (rwBarcaAncora(d)) {
            const i = rwBarcaIntestazione(d);
            openBateoLiveDrawer(i.titolo, '<p class="bv-empty err">Impossibile caricare il dettaglio.</p>', { badge: i.badge, sub: i.sub });
        }
    }
}

// chiamata a ogni ridisegno del rewind (tempo che scorre, barra trascinata, cambio giorno)
function rwAggiornaBarca() {
    const d = rewindBarca;
    if (!d) return;
    if (!rwBarcaAncora(d) || rewind.date !== d.date) {
        if (rewind.attivo && rewind.date !== d.date && rwBarcaAncora(d)) closeBateoLiveDrawer();
        rewindBarca = null;
        return;
    }
    if (d.caricando || d.errore) return;
    const nuova = rwScegliCorsa(d.corse, rewind.t);
    if (nuova && nuova.trip !== d.trip) { rwCaricaCorsaBarca(d, nuova); return; }
    rwRenderBarca();
}

async function rwApriBarca(id) {
    const b = rewind.boats.get(id);
    activeSelection = { type: 'rewind', id };
    const linea = b ? b.line : '-';
    // Nome dell'unità: dallo storico del server, altrimenti dall'elenco live (la flotta è la stessa)
    const nomeUnita = (b && b.label) || (globalBoats.find(x => x.id === id) || {}).label || null;
    const d = rewindBarca = { id, date: rewind.date, linea, nomeUnita, corse: [], trip: null, det: null, firma: '', subTxt: '', caricando: true, errore: false };
    const i0 = rwBarcaIntestazione(d);
    openBateoLiveDrawer(i0.titolo, '<p class="bv-empty">Caricamento…</p>', { badge: i0.badge, sub: i0.sub });
    try {
        const r1 = await fetch(`${API_URL}/api/history/${d.date}/trips?boat=${encodeURIComponent(id)}`);
        if (!r1.ok) throw new Error('HTTP ' + r1.status);
        d.corse = await r1.json();
        if (!rwBarcaAncora(d)) return;
        const corsa = rwScegliCorsa(d.corse, rewind.t);
        if (!corsa) {
            // nessuna corsa adesso: se il tempo scorre fino a una corsa, il pannello si riempie da solo
            d.caricando = false;
            const i = rwBarcaIntestazione(d);
            openBateoLiveDrawer(i.titolo, '<p class="bv-empty">Nessuna corsa registrata per questa unità in questo momento.</p>', { badge: i.badge, sub: i.sub });
            return;
        }
        await rwCaricaCorsaBarca(d, corsa);
    } catch (e) {
        console.error('Rewind: dettaglio battello', e);
        d.caricando = false; d.errore = true;
        if (rwBarcaAncora(d)) {
            const i = rwBarcaIntestazione(d);
            openBateoLiveDrawer(i.titolo, '<p class="bv-empty err">Impossibile caricare il dettaglio.</p>', { badge: i.badge, sub: i.sub });
        }
    }
}

// ---------------------------------------------------------------- collegamento dei controlli
function initRewindUI() {
    const $ = (id) => document.getElementById(id);
    $('bv-rw-datebar').addEventListener('click', rwApriCal);
    $('bv-rw-cal-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) rwChiudiCal(); });
    $('bv-rw-cal-prev').addEventListener('click', () => { rewind.cal.m--; if (rewind.cal.m < 0) { rewind.cal.m = 11; rewind.cal.y--; } rwDisegnaCal(); });
    $('bv-rw-cal-next').addEventListener('click', () => { rewind.cal.m++; if (rewind.cal.m > 11) { rewind.cal.m = 0; rewind.cal.y++; } rwDisegnaCal(); });
    $('bv-rw-cal-grid').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-day]');
        if (!b || b.disabled) return;
        rwChiudiCal();
        if (b.dataset.day !== rewind.date) { closeBateoLiveDrawer(); rwImpostaGiorno(b.dataset.day); }
    });

    $('bv-rw-play').addEventListener('click', () => {
        if (!rewind.playing && rewind.t >= rewind.max - 1) rewind.t = rewind.min;   // a fine corsa Play riparte dall'inizio
        rewind.errore = false;
        rwSetPlaying(!rewind.playing);
        if (rewind.playing) rwEnsure(rewind.t, 2);
        rwAggiornaEtichetta();
    });
    const cambiaVelocita = (d) => {
        rewind.speedIdx = Math.min(RW_VELOCITA.length - 1, Math.max(0, rewind.speedIdx + d));
        rewind.speed = RW_VELOCITA[rewind.speedIdx];
        rwAggiornaEtichetta();
    };
    $('bv-rw-slower').addEventListener('click', () => cambiaVelocita(-1));
    $('bv-rw-faster').addEventListener('click', () => cambiaVelocita(1));

    const range = $('bv-rw-range');
    range.addEventListener('pointerdown', () => { rewind.dragging = true; });
    const finePressione = () => { if (rewind.dragging) { rewind.dragging = false; rwEnsure(rewind.t, 2); } };
    window.addEventListener('pointerup', finePressione);
    window.addEventListener('pointercancel', finePressione);
    range.addEventListener('input', () => rwVaiA(rewind.min + Number(range.value)));

    const inp = $('bv-rw-time');
    inp.addEventListener('focus', () => { rewind.editing = true; rwSetPlaying(false); setTimeout(() => inp.select(), 0); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    inp.addEventListener('blur', rwConfermaOra);
}

export const _test = { hhmm, rwParseOra, rwPosizione, rwUnisci, romeToUnix, rwOra, rwCalGriglia };
