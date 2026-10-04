// ==========================================
// BATEOLIVE - JS MODULE (Versione Completa)
// Include il navigatore di turno (ex gps.js): ritardo/anticipo, attività in corso, prossima fermata,
// tendina fermate e rotta della linea sulla mappa.
// ==========================================

import { getApps, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const BATEOLIVE_FIREBASE_CONFIG = {
    apiKey: "AIzaSyDpamGt2bsT6TJMwnerIUTSfCVFBTJtos4",
    authDomain: "utility-haze.firebaseapp.com",
    projectId: "utility-haze",
    storageBucket: "utility-haze.firebasestorage.app",
    messagingSenderId: "686237947418",
    appId: "1:686237947418:web:f03ba19ab8fff43110a3a3"
};

const bateoliveFirebaseApp = getApps().length ? getApp() : initializeApp(BATEOLIVE_FIREBASE_CONFIG);
const bateoliveAuth = getAuth(bateoliveFirebaseApp);
let bateoliveAuthenticated = !!bateoliveAuth.currentUser;

import {
    TURNI_SENZA_CORSE, dateToLocalISO, stringToNum, esc,
    turnoEffettivo, unisciRebecchini, ferieDelGiorno, haVarianti, caricaDatiTurni
} from "./turni-core.js"; // va importato sempre con questo stesso percorso (vedi turni-core.js)

const API_URL = 'https://api.bateolive.stream';
let globalBoats = [];
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
let currentUserName = "Collega";
let customUnitName = '';
let customLine = '';

// Variabili Controllo Vista Mappa
let followUser = false; 
let courseUp = false;

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
        #modal-bateolive-main { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999; background: #e0e0e0; display: none; flex-direction: column; font-family: 'Inter', sans-serif; overflow: hidden; }
        
        #bv-map-wrapper { flex-grow: 1; position: relative; overflow: hidden; background: #aad3df; z-index: 1; }
        #bv-map { width: 200%; height: 200%; position: absolute; top: -50%; left: -50%; z-index: 1; transition: transform 0.2s linear; }

        .bv-boat-icon { border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; box-shadow: 0 4px 10px rgba(0,0,0,0.4); cursor: pointer; transform: rotate(var(--marker-rotation, 0deg)); transition: transform 0.2s linear, scale 0.2s ease; }
        .bv-boat-icon:hover { scale: 1.15; }
        
        .bv-stop-icon-wrap { width: 14px; height: 14px; }
        .bv-stop-icon-inner { background: #ffffff; border: 2.5px solid #00529b; border-radius: 50%; width: 14px; height: 14px; box-sizing: border-box; box-shadow: 0 2px 5px rgba(0,0,0,0.3); cursor: pointer; transition: scale 0.2s ease; }
        .bv-stop-icon-inner:hover { scale: 1.4; }
        
        .bv-line-dot { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; border: 2px solid; flex-shrink: 0; box-sizing: border-box; }

        /* Tasto fluttuante in alto a sinistra (Indietro) */
        .bv-back-btn { position: absolute; top: calc(20px + env(safe-area-inset-top, 0px)); left: 20px; z-index: 1000; width: 45px; height: 45px; border-radius: 50%; background: rgba(255, 255, 255, 0.94); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.8); box-shadow: 0 4px 15px rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; font-size: 20px; cursor: pointer; color: #00529b; }

        /* Contenitore Fabs in basso a sinistra */
        .bv-fab-container { position: absolute; bottom: calc(30px + env(safe-area-inset-bottom, 0px)); left: 20px; z-index: 1000; display: flex; flex-direction: column; gap: 15px; }

        .bv-error-banner { position: absolute; top: calc(20px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%) translateY(-20px); z-index: 1500; background: #e53935; color: white; padding: 10px 18px; border-radius: 10px; font-size: 13px; font-weight: 600; box-shadow: 0 4px 15px rgba(0,0,0,0.25); display: flex; align-items: center; gap: 8px; opacity: 0; pointer-events: none; transition: opacity 0.25s ease, transform 0.25s ease; max-width: 85%; text-align: center; }
        .bv-error-banner.active { opacity: 1; transform: translateX(-50%) translateY(0); }
        .bv-fab { width: 45px; height: 45px; border-radius: 50%; background: rgba(255, 255, 255, 0.94); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.8); box-shadow: 0 4px 15px rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; font-size: 18px; cursor: pointer; transition: transform 0.2s, background 0.2s; color: #00529b; }
        .bv-fab.active { background: #00529b; color: white; }
        .bv-fab:hover { transform: scale(1.05); }

        /* HUD Bussola Superiore */
        .bv-hud-compass { position: absolute; top: calc(15px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); width: 250px; height: 60px; background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(10px); border-radius: 12px; border: 1px solid rgba(255,255,255,0.5); box-shadow: 0 4px 15px rgba(0,0,0,0.2); overflow: hidden; z-index: 1000; display: flex; align-items: center; justify-content: center; display: none; }
        .bv-compass-tape { position: absolute; top: 10px; left: 0; height: 100%; display: flex; transition: transform 0.15s linear; }
        .bv-compass-mark { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; width: 60px; flex-shrink: 0; }
        .bv-tick { width: 2px; height: 8px; background: #666; margin-bottom: 4px; border-radius: 2px; }
        .bv-tick.major { height: 16px; background: #00529b; width: 3px; }
        .bv-compass-label { color: #666; font-size: 12px; font-weight: 600; }
        .bv-compass-label.major { color: #333; font-size: 14px; font-weight: 900; }
        .bv-compass-center-line { position: absolute; left: 50%; top: 0; width: 3px; height: 30px; background: #e3001b; transform: translateX(-50%); z-index: 10; border-radius: 2px; }

        /* HUD Velocità Inferiore Destra */
        .bv-hud-speed { position: absolute; bottom: calc(30px + env(safe-area-inset-bottom, 0px)); right: 20px; background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(10px); padding: 12px 18px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.5); box-shadow: 0 4px 15px rgba(0,0,0,0.2); z-index: 1000; display: none; }
        .bv-speed-wrapper { display: flex; align-items: baseline; justify-content: center; gap: 5px; }
        .bv-speed-val { font-size: 42px; font-weight: 900; color: #00529b; line-height: 0.9; }
        .bv-speed-unit { font-size: 16px; font-weight: bold; color: #666; }

        /* Navigatore di turno: dentro il riquadro velocità, impilato verso l'alto */
        .bv-hud-speed [hidden] { display: none !important; }
        .bv-hud-speed.nav-on { width: min(290px, calc(100vw - 110px)); box-sizing: border-box; padding: 8px 12px 10px; }
        .bv-hud-speed.nav-on .bv-speed-wrapper { justify-content: flex-start; }
        .bv-hud-speed.nav-on .bv-speed-val { font-size: 36px; }
        .bv-nav-extra { display: none; flex-direction: column; gap: 6px; margin-bottom: 6px; }
        .bv-hud-speed.nav-on .bv-nav-extra { display: flex; }
        .bv-nav-delay { display: none; margin-left: auto; font-size: 30px; font-weight: 900; line-height: 0.9; font-variant-numeric: tabular-nums; padding-left: 10px; border-left: 1px solid rgba(0,0,0,0.12); }
        .bv-hud-speed.nav-on .bv-nav-delay { display: inline-block; }
        .bv-nav-delay.tardi { color: #e53935; }
        .bv-nav-delay.presto { color: #f39c12; }
        .bv-nav-delay.puntuale { color: #43a047; }
        .bv-nav-delay.spento { color: #999; opacity: 0.6; }
        .bv-nav-lista { display: none; position: relative; max-height: 34vh; overflow-y: auto; border-bottom: 1px solid rgba(0,0,0,0.08); padding-bottom: 4px; }
        .bv-nav-lista.aperta { display: block; }
        .bv-nav-toggle { width: 100%; border: none; background: transparent; color: #00529b; font-size: 15px; line-height: 1; padding: 2px 0; cursor: pointer; }
        .bv-nav-toggle i { transition: transform 0.25s; }
        .bv-nav-toggle.aperto i { transform: rotate(180deg); }
        .bv-nav-next { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .bv-nav-next-txt { flex: 1; min-width: 0; }
        .bv-nav-next-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #666; }
        .bv-nav-next-nome { font-size: 15px; font-weight: 800; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bv-nav-next-ora { flex: none; font-size: 20px; font-weight: 900; color: #00529b; font-variant-numeric: tabular-nums; }
        .bv-nav-act-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
        .bv-nav-turno { flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 36px; height: 26px; padding: 0 4px; box-sizing: border-box; border-radius: 6px; background: #1c355e; color: #fff; font-size: 12px; font-weight: 800; line-height: 1; }
        .bv-nav-turno small { font-size: 7px; font-weight: 700; letter-spacing: 0.5px; opacity: 0.8; }
        .bv-nav-linea { flex: none; min-width: 26px; height: 26px; padding: 0 4px; box-sizing: border-box; border-radius: 13px; border: 2px solid; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; }
        .bv-nav-act-row { align-items: flex-start; }
        .bv-nav-id { flex: none; display: flex; flex-direction: column; align-items: center; gap: 4px; }
        .bv-nav-blocco { flex: 1; min-width: 0; }
        .bv-nav-ora { font-size: 16px; font-weight: 800; color: #111; line-height: 1.1; font-variant-numeric: tabular-nums; }
        .bv-nav-luogo { font-size: 11px; font-weight: 600; color: #555; line-height: 1.15; margin-top: 1px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
        .bv-nav-freccia { flex: none; display: flex; flex-direction: column; align-items: center; gap: 2px; padding-top: 3px; color: #999; font-size: 13px; }
        .bv-nav-reb { font-size: 8px; font-weight: 800; color: #8b5cf6; }
        .bv-nav-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #666; margin-bottom: 3px; }
        .bv-nav-dest { flex: 1; min-width: 0; font-size: 13px; font-weight: 700; color: #222; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bv-nav-msg { white-space: normal; font-size: 12px; font-weight: 600; color: #555; }
        .bv-nav-pre { flex: none; font-size: 12px; font-weight: 800; color: #00529b; }
        .bv-nav-pill { flex: none; font-size: 10px; font-weight: 800; padding: 3px 6px; border-radius: 6px; background: rgba(100,116,139,0.15); color: #555; }
        .bv-nav-warn { color: #d97706; }
        .bv-nav-fermata { display: flex; align-items: center; gap: 8px; padding: 5px 4px; margin: 0 -4px; font-size: 13px; color: #222; }
        .bv-nav-fermata.passata { opacity: 0.45; }
        .bv-nav-fermata.prossima { font-weight: 800; background: rgba(0,82,155,0.08); border-radius: 6px; }
        .bv-nav-punto { flex: none; width: 8px; height: 8px; box-sizing: border-box; border-radius: 50%; border: 2px solid #00529b; background: #fff; }
        .bv-nav-fnome { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bv-nav-fora { flex: none; font-weight: 700; font-variant-numeric: tabular-nums; }
        .bv-nav-fora.fine { color: #00529b; }

        .bv-hud-status { position: absolute; top: calc(85px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); z-index: 1500; background: rgba(0,0,0,0.6); color: white; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: bold; display: none; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }

        #bv-drawer { position: absolute; top: calc(15px + env(safe-area-inset-top, 0px)); bottom: calc(15px + env(safe-area-inset-bottom, 0px)); right: -390px; width: 360px; max-height: calc(100% - 30px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); height: auto; background: rgba(255, 255, 255, 0.94); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 16px; box-shadow: -4px 10px 30px rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.8); z-index: 1000; transition: right 0.35s cubic-bezier(0.2, 0.8, 0.2, 1); display: flex; flex-direction: column; overflow: hidden; }
        #bv-drawer.open { right: 15px; }
        #bv-drawer-header { padding: 20px; background: linear-gradient(135deg, #00529b 0%, #003666 100%); color: white; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
        #bv-drawer-title { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: 0.5px; }
        #bv-close-btn { background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; font-size: 14px; cursor: pointer; transition: background 0.2s; display: flex; align-items: center; justify-content: center; }
        #bv-close-btn:hover { background: rgba(255,255,255,0.4); }
        #bv-drawer-content { padding: 0; overflow-y: auto; flex-grow: 1; }

        .bv-drawer-section { padding: 20px; }
        .bv-speed-card { background: linear-gradient(to right, #f8f9fa, #ffffff); padding: 15px; border-radius: 10px; font-size: 14px; margin-bottom: 20px; border-left: 4px solid #00529b; box-shadow: 0 2px 8px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center; }
        .bv-timeline-title { font-size: 13px; text-transform: uppercase; color: #666; font-weight: 600; margin-bottom: 15px; letter-spacing: 0.5px; }

        .bv-time-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; cursor: pointer; transition: background-color 0.2s ease; }
        .bv-time-row:hover { background-color: rgba(0,0,0,0.02); }
        .bv-time-row:last-child { border-bottom: none; }
        .bv-stop-info { display: flex; align-items: center; gap: 10px; flex: 1; padding-right: 15px; overflow: hidden; }
        .bv-dot { width: 8px; height: 8px; background: #00529b; border-radius: 50%; }
        .bv-stop-name { font-weight: 500; color: #333; }

        .bv-stop-passed { opacity: 0.5; }
        .bv-stop-passed .bv-dot { background: #999; }
        .bv-stop-current { background: #f0f8ff; border-radius: 8px; padding: 12px 10px; margin: -12px -10px; }

        .bv-time-block { text-align: right; min-width: 90px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
        .bv-time-sub { font-size: 12px; color: #555; margin-bottom: 2px; }
        .bv-time-main { font-weight: 700; font-size: 14px; color: #111; }
        .bv-time-strike { text-decoration: line-through; color: #9e9e9e; font-size: 12px; margin-right: 4px; font-weight: 400; }

        .bv-badge { padding: 3px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; color: white; display: inline-block; text-align: center; margin-top: 4px; }
        .bv-badge-delay { background: #e53935; }
        .bv-badge-early { background: #f39c12; }
        .bv-badge-ok { background: #43a047; }

        .bv-modal-overlay { display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); z-index: 2000; align-items: center; justify-content: center; backdrop-filter: blur(3px); opacity: 0; transition: opacity 0.2s ease; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); box-sizing: border-box; }
        .bv-modal-overlay.active { display: flex; opacity: 1; }

        .bv-modal { background: white; padding: 20px; border-radius: 16px; width: 90%; max-width: 320px; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.3); position: relative; }
        .bv-modal h3 { margin-top: 0; margin-bottom: 15px; color: #00529b; font-weight: 600; flex-shrink: 0; }

        .bv-search-container { position: relative; flex-shrink: 0; }
        .bv-modal input[type="text"] { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #ddd; margin-bottom: 15px; box-sizing: border-box; font-family: 'Inter', sans-serif; outline: none; font-size: 14px; }
        .bv-modal input[type="text"]:focus { border-color: #00529b; }
        .bv-modal-btn { background: #00529b; color: white; border: none; padding: 12px; width: 100%; border-radius: 8px; cursor: pointer; font-weight: 600; font-family: 'Inter', sans-serif; transition: background 0.2s; flex-shrink: 0; margin-top: 15px; }
        .bv-modal-btn:hover { background: #003666; }
        .bv-modal-btn.error { background: #e53935; }

        .bv-suggestions-dropdown { position: absolute; top: 48px; left: 0; right: 0; background: white; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); max-height: 220px; overflow-y: auto; z-index: 10; display: none; border: 1px solid #ddd; }
        .bv-suggestions-dropdown.active { display: block; }
        .bv-suggestion-item { padding: 12px 15px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 500; }
        .bv-suggestion-item:last-child { border-bottom: none; }
        .bv-suggestion-item:hover { background: #f0f8ff; color: #00529b; }

        .bv-filter-list { display: flex; flex-direction: column; overflow-y: auto; padding-right: 5px; flex-grow: 1; }
        .bv-toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
        .bv-toggle-row:last-child { border-bottom: none; }
        .bv-toggle-info { display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 14px; color: #333; }

        .bv-switch { position: relative; display: inline-block; width: 44px; height: 24px; }
        .bv-switch input { opacity: 0; width: 0; height: 0; }
        .bv-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .3s; border-radius: 34px; }
        .bv-slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
        .bv-switch input:checked + .bv-slider { background-color: #43a047; }
        .bv-switch input:checked + .bv-slider:before { transform: translateX(20px); }

        #modal-bateolive-main ::-webkit-scrollbar { width: 6px; }
        #modal-bateolive-main ::-webkit-scrollbar-track { background: transparent; }
        #modal-bateolive-main ::-webkit-scrollbar-thumb { background: #ccc; border-radius: 10px; }
        .bv-profile-btn { position: absolute; top: 16px; left: 16px; z-index: 3000; width: 44px; height: 44px; border: 0; border-radius: 50%; background: rgba(255,255,255,.95); color: #00529b; box-shadow: 0 3px 12px rgba(0,0,0,.25); cursor: pointer; font-size: 18px; }
        .bv-profile-btn.logged { color: #28a745; }
        .bv-auth-modal .bv-modal { max-width: 360px; }
        .bv-auth-title { display:flex; align-items:center; gap:8px; }
        .bv-auth-input { width:100%; box-sizing:border-box; padding:11px 12px; border:1px solid #ddd; border-radius:8px; margin-bottom:10px; font-size:14px; }
        .bv-auth-error { display:none; color:#c62828; background:#ffebee; border-radius:8px; padding:9px; font-size:12px; margin-bottom:10px; }
        .bv-auth-link { border:0; background:none; color:#00529b; cursor:pointer; padding:8px 0; font-size:12px; text-decoration:underline; }
        .bv-auth-user { font-size:12px; color:#666; margin-bottom:10px; }
    </style>

    <div id="modal-bateolive-main">

        <!-- Profilo / Accesso -->
        <button id="bv-profile-btn" class="bv-profile-btn" type="button" onclick="apriBateoLiveAuthModal()" title="Profilo / Accesso">
            <i class="fa-solid fa-user"></i>
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

        <!-- HUD Velocità + navigatore (ritardo di fianco, sopra: attività, prossima fermata, tendina fermate) -->
        <div id="bv-hud-speed" class="bv-hud-speed">
            <div class="bv-nav-extra">
                <div id="bv-nav-lista" class="bv-nav-lista"></div>
                <button id="bv-nav-toggle" class="bv-nav-toggle" type="button" aria-label="Mostra tutte le fermate" hidden><i class="fa-solid fa-chevron-up"></i></button>
                <div id="bv-nav-next" class="bv-nav-next" hidden>
                    <div class="bv-nav-next-txt">
                        <div id="bv-nav-next-label" class="bv-nav-next-label"></div>
                        <div id="bv-nav-next-nome" class="bv-nav-next-nome"></div>
                    </div>
                    <div id="bv-nav-next-ora" class="bv-nav-next-ora"></div>
                </div>
                <div id="bv-nav-act"></div>
            </div>
            <div class="bv-speed-wrapper">
                <span id="bv-speed-val" class="bv-speed-val">0.0</span>
                <span class="bv-speed-unit">km/h</span>
                <span id="bv-nav-delay" class="bv-nav-delay spento" title="Ritardo / anticipo">--</span>
            </div>
        </div>

        <!-- Tasti Fluttuanti (FAB) -->
        <div id="bv-error-banner" class="bv-error-banner">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span id="bv-error-banner-text">Impossibile collegarsi al server. Verifica la connessione.</span>
        </div>

        <div class="bv-fab-container">
            <div id="bv-fab-gps" class="bv-fab" onclick="toggleBvGPS()" title="Attiva/Disattiva GPS">
                <i class="fa-solid fa-satellite-dish"></i>
            </div>
            <div id="bv-fab-center" class="bv-fab" onclick="toggleBvCenterMap()" title="Centra sulla Posizione" style="display: none;">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 2L4 20L12 17L20 20L12 2Z"/></svg>
            </div>
            <div id="bv-fab-rotate" class="bv-fab" onclick="toggleBvMapRotation()" title="Rotazione Mappa (Rotta in alto)" style="display: none;">
                <i class="fa-regular fa-compass"></i>
            </div>
            <div id="bv-fab-nav" class="bv-fab active" onclick="toggleBvNavigatore()" title="Navigatore turno" style="display: none;">
                <i class="fa-solid fa-route"></i>
            </div>
            <div id="bv-fab-layers" class="bv-fab" onclick="cambiaStileBvMappa()" title="Cambia Stile Cartografico">
                <i class="fa-solid fa-layer-group"></i>
            </div>
            <div id="bv-fab-unit" class="bv-fab" onclick="apriBateoLiveUnitModal()" title="Configura Unità" style="display: none;">
                <i class="fa-solid fa-ship"></i>
            </div>
            <div class="bv-fab" onclick="apriBateoLiveSearchModal()" title="Cerca Mezzo o Fermata"><i class="fa-solid fa-magnifying-glass"></i></div>
            <div class="bv-fab" onclick="apriBateoLiveFilterModal()" title="Filtra Linee"><i class="fa-solid fa-filter"></i></div>
        </div>

        <div id="bv-drawer">
            <div id="bv-drawer-header">
                <h3 id="bv-drawer-title">Dettagli</h3>
                <button id="bv-close-btn" onclick="closeBateoLiveDrawer()">✖</button>
            </div>
            <div id="bv-drawer-content"></div>
        </div>

        <!-- Sottomodale Configurazione Unità -->
        <div id="bv-unit-modal" class="bv-modal-overlay" onclick="chiudiBateoLiveModals(event)">
            <div class="bv-modal" onclick="event.stopPropagation()">
                <h3>Configurazione Unità</h3>
                <div style="margin-bottom: 12px;">
                    <label style="font-size: 12px; font-weight: 600; color: #666; display: block; margin-bottom: 4px;">Nome Unità / Mezzo</label>
                    <input type="text" id="bv-unit-name-input" placeholder="Es. M/S 200, M/B 1" autocomplete="off">
                </div>
                <button class="bv-modal-btn" onclick="salvaConfigurazioneUnita()">Salva</button>
            </div>
        </div>

        <!-- Sottomodale Ricerca -->
        <div id="bv-search-modal" class="bv-modal-overlay" onclick="chiudiBateoLiveModals(event)">
            <div class="bv-modal" onclick="event.stopPropagation()">
                <h3>Cerca Mezzo / Fermata</h3>
                <div class="bv-search-container">
                    <input type="text" id="bv-search-input" placeholder="Es. Rialto, 4.2..." autocomplete="off">
                    <div id="bv-search-suggestions" class="bv-suggestions-dropdown"></div>
                </div>
                <button id="bv-search-btn" class="bv-modal-btn" onclick="eseguiBateoLiveSearch()">Cerca</button>
            </div>
        </div>

        <!-- Sottomodale Accesso -->
        <div id="bv-auth-modal" class="bv-modal-overlay bv-auth-modal" onclick="chiudiBateoLiveAuthModal(event)">
            <div class="bv-modal" onclick="event.stopPropagation()">
                <h3 id="bv-auth-title" class="bv-auth-title"><i class="fa-solid fa-user"></i> Accedi</h3>
                <div id="bv-auth-user" class="bv-auth-user" style="display:none;"></div>
                <input id="bv-auth-email" class="bv-auth-input" type="email" placeholder="Email" autocomplete="username">
                <input id="bv-auth-password" class="bv-auth-input" type="password" placeholder="Password" autocomplete="current-password">
                <div id="bv-auth-error" class="bv-auth-error"></div>
                <button id="bv-auth-login" class="bv-modal-btn" type="button" onclick="eseguiBateoLiveLogin()">Accedi</button>
                <button id="bv-auth-reset" class="bv-auth-link" type="button" onclick="recuperaBateoLivePassword()">Password dimenticata?</button>
                <button id="bv-auth-logout" class="bv-auth-link" type="button" onclick="eseguiBateoLiveLogout()" style="display:none;">Esci</button>
            </div>
        </div>

        <!-- Sottomodale Filtri -->
        <div id="bv-filter-modal" class="bv-modal-overlay" onclick="chiudiBateoLiveModals(event)">
            <div class="bv-modal" onclick="event.stopPropagation()">
                <h3>Filtra Linee</h3>
                <div id="bv-filter-list" class="bv-filter-list"></div>
                <button class="bv-modal-btn" onclick="applicaBateoLiveFilter()">Applica Filtro</button>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', uiHTML);

    // Stato iniziale autenticazione: il navigatore resta nascosto finché non si accede.
    aggiornaBateoLiveAuthUI();

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
    window.toggleBvNavigatore = toggleBvNavigatore;
    window.apriBateoLiveAuthModal = apriBateoLiveAuthModal;
    window.chiudiBateoLiveAuthModal = chiudiBateoLiveAuthModal;
    window.eseguiBateoLiveLogin = eseguiBateoLiveLogin;
    window.recuperaBateoLivePassword = recuperaBateoLivePassword;
    window.eseguiBateoLiveLogout = eseguiBateoLiveLogout;

    document.getElementById('bv-nav-toggle').addEventListener('click', toggleListaFermate);

    document.getElementById('bv-search-input').addEventListener('input', async function(e) {
        const q = e.target.value.toLowerCase().trim();
        const suggBox = document.getElementById('bv-search-suggestions');

        if (q.length < 2) {
            suggBox.classList.remove('active');
            return;
        }

        const mStops = globalStops.filter(s => s.name.toLowerCase().includes(q));
        const mBoats = globalBoats.filter(b => b.line.toLowerCase() === q || b.label.toLowerCase().includes(q));

        let html = '';

        mBoats.slice(0, 4).forEach(b => {
            const c = getLineColors(b.line);
            const dotHtml = `<div class="bv-line-dot" style="background-color: ${c.bg}; color: ${c.text}; border-color: ${c.border}; width: 18px; height: 18px; font-size: 8px;">${b.line}</div>`;
            html += `<div class="bv-suggestion-item" onclick="selezionaBateoLiveSuggestion('boat', '${b.id}')">
                        ${dotHtml} <span>🚤 ${b.label}</span>
                     </div>`;
        });

        mStops.slice(0, 5).forEach(s => {
            html += `<div class="bv-suggestion-item" onclick="selezionaBateoLiveSuggestion('stop', '${s.id}')">
                        ⚓ <span>${s.name}</span>
                     </div>`;
        });

        if (!html) html = `<div class="bv-suggestion-item" style="color:#999; justify-content: center;">Nessun risultato trovato</div>`;

        suggBox.innerHTML = html;
        suggBox.classList.add('active');
    });
}

// ==========================================
// AUTENTICAZIONE BATEOLIVE
// ==========================================
function aggiornaBateoLiveAuthUI() {
    const btn = document.getElementById('bv-profile-btn');
    const modal = document.getElementById('bv-auth-modal');
    const title = document.getElementById('bv-auth-title');
    const userBox = document.getElementById('bv-auth-user');
    const email = document.getElementById('bv-auth-email');
    const password = document.getElementById('bv-auth-password');
    const login = document.getElementById('bv-auth-login');
    const reset = document.getElementById('bv-auth-reset');
    const logout = document.getElementById('bv-auth-logout');
    const nav = document.getElementById('bv-fab-nav');
    if (!btn) return;
    const user = bateoliveAuth.currentUser;
    bateoliveAuthenticated = !!user;
    btn.classList.toggle('logged', bateoliveAuthenticated);
    if (nav) nav.style.display = bateoliveAuthenticated ? 'flex' : 'none';
    if (!modal) return;
    if (user) {
        title.innerHTML = '<i class="fa-solid fa-circle-check"></i> Profilo';
        userBox.textContent = user.email || ''; userBox.style.display = 'block';
        email.style.display = 'none'; password.style.display = 'none'; login.style.display = 'none'; reset.style.display = 'none'; logout.style.display = 'block';
    } else {
        title.innerHTML = '<i class="fa-solid fa-user"></i> Accedi';
        userBox.style.display = 'none'; email.style.display = 'block'; password.style.display = 'block'; login.style.display = 'block'; reset.style.display = 'block'; logout.style.display = 'none';
    }
}
function apriBateoLiveAuthModal() {
    aggiornaBateoLiveAuthUI();
    document.getElementById('bv-auth-error').style.display = 'none';
    document.getElementById('bv-auth-modal').classList.add('active');
    if (!bateoliveAuthenticated) setTimeout(() => document.getElementById('bv-auth-email').focus(), 50);
}
function chiudiBateoLiveAuthModal(e) {
    if (e && e.target && e.target.classList && !e.target.classList.contains('bv-modal-overlay')) return;
    document.getElementById('bv-auth-modal').classList.remove('active');
}
async function eseguiBateoLiveLogin() {
    const email = document.getElementById('bv-auth-email').value.trim();
    const pwd = document.getElementById('bv-auth-password').value;
    const err = document.getElementById('bv-auth-error');
    err.style.display = 'none';
    if (!email || !pwd) { err.textContent = 'Inserisci email e password.'; err.style.display = 'block'; return; }
    try {
        await signInWithEmailAndPassword(bateoliveAuth, email, pwd);
        chiudiBateoLiveAuthModal();
    } catch (e) {
        err.textContent = 'Email o password non valide.'; err.style.display = 'block';
        console.error('Errore login BateoLive:', e);
    }
}
async function recuperaBateoLivePassword() {
    const email = document.getElementById('bv-auth-email').value.trim();
    const err = document.getElementById('bv-auth-error');
    if (!email) { err.textContent = 'Inserisci prima il tuo indirizzo email.'; err.style.display = 'block'; return; }
    try { await sendPasswordResetEmail(bateoliveAuth, email); alert('Email di ripristino inviata. Controlla anche la cartella Spam.'); }
    catch (e) { err.textContent = 'Impossibile inviare il link di ripristino. Verifica l'indirizzo email.'; err.style.display = 'block'; }
}
async function eseguiBateoLiveLogout() {
    await signOut(bateoliveAuth);
    chiudiBateoLiveAuthModal();
    if (document.getElementById('bv-fab-gps')?.classList.contains('active')) toggleBvGPS();
}

onAuthStateChanged(bateoliveAuth, () => aggiornaBateoLiveAuthUI());

// ==========================================
// LOGICA DI CONTROLLO MOTORE & GPS
// ==========================================

export async function avviaMotoreBateoLive(db, auth, userData, isAdmin) {
    currentUserId = (auth && auth.currentUser) ? auth.currentUser.uid : 'user_' + Math.random().toString(36).substr(2, 9);
    currentUserName = (userData && userData.nome) ? userData.nome : "Collega";
    userMansione = (userData && userData.mansione) || null;

    initUIBateoLive();
    document.getElementById('modal-bateolive-main').style.display = 'flex';

    await loadMapDependencies();

    if (!map) {
        baseOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
        baseSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
        nauticLayer = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 18 });

        map = L.map('bv-map', { 
            attributionControl: false, 
            zoomControl: false,
            layers: [baseOSM, nauticLayer]
        }).setView([45.4371, 12.3326], 13);

        // rotta della linea: sopra le tile, sotto marker di unità e fermate, non intercetta i click
        map.createPane('bv-rotta');
        map.getPane('bv-rotta').style.zIndex = 430;
        map.getPane('bv-rotta').style.pointerEvents = 'none';

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
        fetchAndUpdateBoats();
        fetchInterval = setInterval(() => {
            fetchAndUpdateBoats();
            sincronizzaPosizioneAltriUtenti();
        }, 1500);
    } else {
        setTimeout(() => map.invalidateSize(), 100);
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
        hudStatus.innerText = "Mappa Base Nautica";
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
        document.getElementById('bv-fab-nav').style.display = 'none';
        fermaNavigatore();
        
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
        document.getElementById('bv-fab-nav').style.display = bateoliveAuthenticated ? 'flex' : 'none';
        if (bateoliveAuthenticated) avviaNavigatore();
        
        toggleBvCenterMap(true);
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
    aggiornaPosizioneNavigatore(coords, now, avgSpeedMs);

    if (coords.heading !== null && (rawSpeedMs >= 0.5 || lastValidHeading === null)) {
        lastValidHeading = coords.heading;
    }
    
    let validHeading = lastValidHeading || 0;

    const svgArrow = `
    <div style="transform: rotate(${validHeading}deg); width:32px; height:32px; display:flex; align-items:center; justify-content:center; filter: drop-shadow(0px 3px 6px rgba(0,0,0,0.5)); transition: transform 0.2s linear;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="#00529b" stroke="white" stroke-width="1.5" stroke-linejoin="round">
            <path d="M12 2L4 20L12 17L20 20L12 2Z"/>
        </svg>
    </div>`;
    
    const userIcon = L.divIcon({ html: svgArrow, className: '', iconSize: [32,32], iconAnchor: [16,16] });

    if (!userMarker) {
        userMarker = L.marker([coords.latitude, coords.longitude], {
            icon: userIcon, zIndexOffset: 2000
        }).addTo(map);
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

    renderNavigatore(); // aggiorna anche la linea (da turno) che viene inviata agli altri utenti
    inviaBvPosizionePersonale(coords.latitude, coords.longitude, speedKmh, validHeading);
}

function inviaBvPosizionePersonale(lat, lon, speed, heading) {
    if (!currentUserId) return;

    fetch(`${API_URL}/api/users/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id: currentUserId,
            lat: lat,
            lon: lon,
            speed: speed,
            heading: heading,
            nome: customUnitName || currentUserName,
            line: customLine || ''
        })
    }).catch(err => console.error("Errore invio posizione:", err));
}

async function sincronizzaPosizioneAltriUtenti() {
    if (!map || !currentUserId) return;
    try {
        const response = await fetch(`${API_URL}/api/users/live`);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const users = await response.json();
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
                iconHtml = `<div class="bv-boat-icon" style="background-color: ${c.bg}; color: ${c.text}; border: 3px solid #28a745; width: 26px; height: 26px; box-sizing: border-box;">${uLine}</div>`;
                iconSize = [26, 26];
                iconAnchor = [13, 13];
            } else {
                iconHtml = `
                <div style="transform: rotate(${uHeading}deg); width:32px; height:32px; display:flex; align-items:center; justify-content:center; filter: drop-shadow(0px 3px 6px rgba(0,0,0,0.5)); transition: transform 0.2s linear;">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="#28a745" stroke="white" stroke-width="1.5" stroke-linejoin="round">
                        <path d="M12 2L4 20L12 17L20 20L12 2Z"/>
                    </svg>
                </div>`;
            }

            const icon = L.divIcon({ html: iconHtml, className: '', iconSize: iconSize, iconAnchor: iconAnchor });

            let popupContent = `<div style="text-align:center;">Velocità: ${parseFloat(u.speed || 0).toFixed(1)} km/h</div>`;
            if (u.nome && u.nome !== currentUserName) {
                popupContent = `<div style="text-align:center;"><b>${u.nome}</b><br>Velocità: ${parseFloat(u.speed || 0).toFixed(1)} km/h</div>`;
            }

            if (otherUsersMarkers[uid]) {
                otherUsersMarkers[uid].setLatLng([u.lat, u.lon]);
                otherUsersMarkers[uid].setIcon(icon);
                if (otherUsersMarkers[uid].getPopup()) {
                    otherUsersMarkers[uid].getPopup().setContent(popupContent);
                }
            } else {
                const marker = L.marker([u.lat, u.lon], { icon: icon }).addTo(map);
                marker.bindPopup(popupContent);
                otherUsersMarkers[uid] = marker;
            }
        });

        Object.keys(otherUsersMarkers).forEach(uid => {
            if (!activeIds.includes(uid)) {
                map.removeLayer(otherUsersMarkers[uid]);
                delete otherUsersMarkers[uid];
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
    document.getElementById('modal-bateolive-main').style.display = 'none';
    closeBateoLiveDrawer();
    if (watchId) navigator.geolocation.clearWatch(watchId);
    document.getElementById('bv-hud-compass').style.display = 'none';
    document.getElementById('bv-hud-speed').style.display = 'none';
    document.getElementById('bv-fab-center').style.display = 'none';
    document.getElementById('bv-fab-rotate').style.display = 'none';
    document.getElementById('bv-fab-nav').style.display = 'none';
    document.getElementById('bv-fab-unit').style.display = 'none';
    fermaNavigatore();
    document.getElementById('bv-fab-gps').classList.remove('active');
    
    courseUp = false;
    followUser = false;
    const mapEl = document.getElementById('bv-map');
    mapEl.style.transform = `rotate(0deg)`;
    mapEl.style.setProperty('--marker-rotation', `0deg`);

    customUnitName = '';
    customLine = '';
    localStorage.removeItem('bv_custom_unit');

    if (fetchInterval) {
        clearInterval(fetchInterval);
        fetchInterval = null;
    }
}

function closeBateoLiveDrawer() {
    activeSelection = null;
    const drawer = document.getElementById('bv-drawer');
    if (drawer) drawer.classList.remove('open');
}

function openBateoLiveDrawer(title, htmlContent) {
    document.getElementById('bv-drawer-title').innerText = title;
    document.getElementById('bv-drawer-content').innerHTML = `<div class="bv-drawer-section">${htmlContent}</div>`;
    document.getElementById('bv-drawer').classList.add('open');
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
        document.getElementById('bv-filter-list').innerHTML = html || '<p style="font-size:13px; color:#666; text-align:center;">Nessuna linea attiva trovata.</p>';
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

function locateBateoLiveBoat(staticTripId, liveBoatId) {
    let boat = null;
    if (liveBoatId) {
        boat = globalBoats.find(b => b.id === liveBoatId);
    }
    if (!boat) {
        boat = globalBoats.find(b => b.tripId === staticTripId);
    }

    if (boat) {
        map.setView([boat.lat, boat.lon], 16);
        renderBoatDrawer(boat);
    } else {
        const msgDiv = document.getElementById('msg-' + staticTripId);
        if (msgDiv) {
            msgDiv.innerHTML = "Posizione non disponibile";
            msgDiv.style.color = "#e53935";
            setTimeout(() => { msgDiv.innerHTML = ""; }, 3000);
        }
    }
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
    if (delaySec === 0 || delaySec === null || delaySec === undefined) return `<span class="bv-badge bv-badge-ok">In orario</span>`;
    const min = Math.round(delaySec / 60);
    if (min >= 1) return `<span class="bv-badge bv-badge-delay">+${min}'</span>`;
    if (min <= -1) return `<span class="bv-badge bv-badge-early">${min}'</span>`;
    return `<span class="bv-badge bv-badge-ok">In orario</span>`;
}

function buildTimeLine(label, scheduled, estimated, isDelayed) {
    if (estimated) {
        if (isDelayed && scheduled) {
            return `<div class="bv-time-sub">${label}: <span class="bv-time-strike">${formatTime(scheduled)}</span><span class="bv-time-main">${formatTime(estimated)}</span></div>`;
        }
        return `<div class="bv-time-sub">${label}: <span class="bv-time-main">${formatTime(scheduled || estimated)}</span></div>`;
    }
    return `<div class="bv-time-sub">${label}: <span class="bv-time-main">--:--</span></div>`;
}

async function renderBoatDrawer(boat) {
    activeSelection = { type: 'boat', data: boat };
    let baseInfo = `
        <div class="bv-speed-card" style="justify-content: flex-start;">
            <div>Linea <strong style="font-size:16px;">${boat.line}</strong></div>
        </div>`;

    if (!boat.tripId) {
        openBateoLiveDrawer(boat.label, baseInfo + `<p style="color:#666; font-size:14px;">In attesa di assegnazione corsa...</p>`);
        return;
    }

    try {
        const res = await fetch(`${API_URL}/api/trip/${boat.tripId}/${boat.id}`);
        const stopTimes = await res.json();

        if (!activeSelection || activeSelection.type !== 'boat' || activeSelection.data.id !== boat.id) return;

        if (stopTimes.length === 0) {
            openBateoLiveDrawer(boat.label, baseInfo + `<p style="color:#666; font-size:14px;">Nessun orario disponibile per la corsa.</p>`);
            return;
        }

        let html = baseInfo + `<div class="bv-timeline-title">Percorso corsa attuale</div>`;
        stopTimes.forEach(st => {
            let badgeHtml = getDelayBadge(st.delay);
            const isOffSchedule = Math.abs(Math.round(st.delay / 60)) >= 1;

            const passedClass = st.status === 'PASSED' ? 'bv-stop-passed' : (st.status === 'CURRENT' ? 'bv-stop-current' : '');
            const dotIndicator = st.status === 'PASSED' ? '✔️' : (st.status === 'CURRENT' ? '⚓' : '<div class="bv-dot"></div>');

            let timeContent = "";
            if (st.status === 'FUTURE') {
                const targetSched = st.scheduledDeparture || st.scheduledArrival;
                const targetEst = st.estimatedDeparture || st.estimatedArrival;

                if (targetEst) {
                    if (isOffSchedule && targetSched) {
                        timeContent = `<div><span class="bv-time-strike">${formatTime(targetSched)}</span><span class="bv-time-main">${formatTime(targetEst)}</span></div>`;
                    } else {
                        timeContent = `<div><span class="bv-time-main">${formatTime(targetSched || targetEst)}</span></div>`;
                    }
                } else {
                    timeContent = `<div><span class="bv-time-main">--:--</span></div>`;
                }
            } else {
                let arrHtml = buildTimeLine("Arr", st.scheduledArrival, st.estimatedArrival, isOffSchedule);
                let depHtml = "";
                if (st.status === 'CURRENT') {
                    depHtml = `<div class="bv-time-sub">Part: <span class="bv-time-main" style="color:#00529b;">In sosta...</span></div>`;
                } else {
                    depHtml = buildTimeLine("Part", st.scheduledDeparture, st.estimatedDeparture, isOffSchedule);
                }
                timeContent = arrHtml + depHtml;
            }

            html += `
            <div class="bv-time-row ${passedClass}" style="cursor:default;">
                <div class="bv-stop-info">
                    ${dotIndicator}
                    <span class="bv-stop-name">${st.stopName}</span>
                </div>
                <div class="bv-time-block">
                    ${timeContent}
                    ${badgeHtml}
                </div>
            </div>`;
        });
        openBateoLiveDrawer(boat.label, html);
    } catch (e) { console.error(e); }
}

async function renderStopDrawer(stop) {
    activeSelection = { type: 'stop', data: stop };
    try {
        const res = await fetch(`${API_URL}/api/stop/${stop.id}`);
        const arrivals = await res.json();

        if (!activeSelection || activeSelection.type !== 'stop' || activeSelection.data.id !== stop.id) return;

        let html = `<div class="bv-timeline-title" style="margin-bottom:20px;">Partenze (Fino a -1h / +3h)</div>`;
        if (arrivals.length === 0) {
            html += `<p style="color:#666; font-size:14px;">Nessuna partenza in programma.</p>`;
        } else {
            arrivals.forEach(arr => {
                let badgeHtml = getDelayBadge(arr.delay);
                const isOffSchedule = Math.abs(Math.round(arr.delay / 60)) >= 1;

                let timeHtml = "";
                if (arr.estimated) {
                    if (isOffSchedule && arr.scheduled) {
                        timeHtml = `<span class="bv-time-strike">${formatTime(arr.scheduled)}</span><span class="bv-time-main">${formatTime(arr.estimated)}</span>`;
                    } else {
                        timeHtml = `<span class="bv-time-main">${formatTime(arr.scheduled || arr.estimated)}</span>`;
                    }
                } else {
                    timeHtml = `<span class="bv-time-main">--:--</span>`;
                }

                let opacityClass = arr.status === 'PASSED' ? 'style="opacity: 0.5;"' : (arr.status === 'CURRENT' ? 'style="background: #f0f8ff; padding: 10px; border-radius: 8px; margin: -10px;"' : '');

                let statusTextHtml = '';
                if (arr.status === 'PASSED') statusTextHtml = '<small style="color:#666; margin-top:2px;">(Partito)</small>';
                else if (arr.status === 'CURRENT') statusTextHtml = '<small style="color:#00529b; margin-top:2px; font-weight:600;">(In sosta)</small>';

                const colors = getLineColors(arr.routeId);
                const dotHtml = `<div class="bv-line-dot" style="background-color: ${colors.bg}; color: ${colors.text}; border-color: ${colors.border}; margin-right: 8px;">${arr.routeId}</div>`;

                html += `
                <div class="bv-time-row" ${opacityClass} onclick="locateBateoLiveBoat('${arr.tripId}', '${arr.liveBoatId || ''}')">
                    <div class="bv-stop-info" style="flex-direction: column; align-items: flex-start; gap: 4px; padding-bottom:4px;">
                        <div style="display: flex; align-items: center; width: 100%;">
                            ${dotHtml}
                            <span style="font-size: 14px; font-weight: 600; color: #333; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${arr.destination || 'Sconosciuta'}">${arr.destination || 'Sconosciuta'}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; width:100%;">
                            ${statusTextHtml}
                            <span id="msg-${arr.tripId}" style="font-size:10px; font-weight:600; height:12px; margin-left: auto;"></span>
                        </div>
                    </div>
                    <div class="bv-time-block">
                        <div>${timeHtml}</div>
                        ${badgeHtml}
                    </div>
                </div>`;
            });
        }
        openBateoLiveDrawer(stop.name, html);
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
    const iconHtml = `<div class="bv-boat-icon" style="background-color: ${c.bg}; color: ${c.text}; border: 2.5px solid ${c.border}; width: 26px; height: 26px; box-sizing: border-box;">${boat.line}</div>`;
    const customBoatIcon = L.divIcon({ html: iconHtml, className: '', iconSize: [26, 26], iconAnchor: [13, 13] });

    if (boatMarkers[boat.id]) {
        boatMarkers[boat.id].setLatLng([boat.lat, boat.lon]);
        boatMarkers[boat.id].setIcon(customBoatIcon);
        boatMarkers[boat.id].off('click').on('click', () => renderBoatDrawer(boat));
    } else {
        const marker = L.marker([boat.lat, boat.lon], { icon: customBoatIcon, zIndexOffset: 1000 }).addTo(map);
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

async function fetchAndUpdateBoats() {
    if (!map) return;
    try {
        const response = await fetch(`${API_URL}/api/vaporetti/live`);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const boats = await response.json();
        globalBoats = boats;
        showBateoLiveError(false);

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
// NAVIGATORE DI TURNO (ex gps.js)
// Calcola da solo il turno del giorno, scarica fermate e percorso dal backend e, con la posizione GPS,
// ricava ritardo/anticipo, prossima fermata e rotta della corsa in corso.
// ==========================================

// Nei giorni con varianti di servizio gli orari dei turni possono non valere: come la dashboard,
// in quei giorni non si carica il turno. Metti false per usare comunque gli orari del libro turni.
const BLOCCA_SE_VARIANTI = true;


// --- parametri della navigazione
const SOGLIA_FERMATA_M = 30;      // entro questa distanza dalla fermata il mezzo è "in fermata"
const ACCURATEZZA_MAX_M = 80;     // fix GPS meno precisi di così non servono per la posizione sul percorso
const FUORI_PERCORSO_M = 120;     // oltre questa distanza dalla linea non si è più sul percorso
const FINESTRA_INDIETRO_M = 150;  // dove cercare il mezzo rispetto all'ultima posizione nota
const FINESTRA_AVANTI_M = 800;
const FIX_SCADUTO_MS = 15000;     // senza fix da più di così il ritardo non si mostra
const SMORZA_RITARDO = 0.2;       // peso di ogni nuovo fix nella media mobile del ritardo
const PESO_CONTINUITA = 0.25;      // metri di "costo" per ogni metro di scostamento dalla posizione prevista
const SOGLIA_MOVIMENTO_MS = 1.5;    // sopra questa velocità (m/s) il mezzo si considera in movimento
const PRECARICA_MIN = 15;         // quanti minuti prima si caricano le fermate della corsa successiva

const pad2 = (n) => String(n).padStart(2, '0');

// secondi dall'inizio di un giorno -> "HH:MM" (oltre le 24 riparte da 00:00)
function hhmm(sec) {
    const min = Math.floor(sec / 60);
    return `${pad2(((Math.floor(min / 60) % 24) + 24) % 24)}:${pad2(((min % 60) + 60) % 60)}`;
}
function parseHHMM(s) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(s || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// secondi trascorsi dalla mezzanotte del giorno del turno (anche oltre 86400 se il turno è iniziato "ieri")
function secondiDalGiorno(dataTurnoISO, d = new Date()) {
    const giorni = stringToNum(dateToLocalISO(d)) - stringToNum(dataTurnoISO);
    return giorni * 86400 + d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
}

// "+3'" ritardo, "-2'" anticipo, "0'" in orario
function formattaRitardo(sec) {
    const m = Math.round(sec / 60);
    return (m > 0 ? '+' : m < 0 ? '-' : '') + Math.abs(m) + "'";
}

// ==========================================
// 2. GEOMETRIA DEL PERCORSO (funzioni pure)
// ==========================================
const R_TERRA = 6371008.8;
const RAD = Math.PI / 180;

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

// Indice del segmento che contiene la distanza d (cum crescente)
function cercaSegmento(cum, d) {
    const n = cum.length - 1;
    if (d <= cum[0]) return 0;
    if (d >= cum[n]) return n - 1;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    return lo;
}

// Il percorso dal server (intero shape) viene ritagliato tra la prima e l'ultima fermata del tratto del turno.
function ritaglia(p, d0, d1) {
    const pts = [{ lat: interpola(p.dist, p.lat, d0), lon: interpola(p.dist, p.lon, d0), d: 0 }];
    for (let i = 0; i < p.dist.length; i++) {
        if (p.dist[i] > d0 + 0.5 && p.dist[i] < d1 - 0.5) pts.push({ lat: p.lat[i], lon: p.lon[i], d: p.dist[i] - d0 });
    }
    pts.push({ lat: interpola(p.dist, p.lat, d1), lon: interpola(p.dist, p.lon, d1), d: d1 - d0 });
    return pts;
}

// Orari di una corsa in secondi dal giorno del turno. Usa arrivo_sec/partenza_sec del backend;
// se mancano ripiega su "HH:MM", aggiungendo 24 ore ogni volta che l'orario "torna indietro".
function orariCorsa(dati, dataTurno) {
    const sfasa = (stringToNum(dati.corsa && dati.corsa.data_servizio) - stringToNum(dataTurno)) * 86400 || 0;
    const fc = dati.fermate;
    let giorno = 0, prec = -1;
    const fallback = (s, oltre) => {
        let v = parseHHMM(s) * 60;
        if (prec < 0 && oltre && v < 12 * 3600) giorno = 86400;
        while (v + giorno < prec) giorno += 86400;
        prec = v + giorno;
        return v + giorno;
    };
    return fc.map((f) => ({
        arr: (Number.isFinite(f.arrivo_sec) ? f.arrivo_sec : fallback(f.arrivo, f.oltre_mezzanotte)) + sfasa,
        dep: (Number.isFinite(f.partenza_sec) ? f.partenza_sec : fallback(f.partenza, f.oltre_mezzanotte)) + sfasa,
    }));
}

// Mette insieme una o più corse (più di una solo nei rebecchini) in un unico percorso:
//   { lat[], lon[], x[], y[], cum[], lunghezza, geometria, fermate: [{ id, nome, dist, arr, dep }] }
// tratte = [{ corsa: risposta di /corsa, percorso: risposta di /percorso | null }]
function costruisciPercorso(tratte, dataTurno) {
    const punti = [];
    const fermate = [];
    let offset = 0;
    let geometria = true;

    tratte.forEach((t, n) => {
        const { fermate: fc, tratta } = t.corsa;
        const orari = orariCorsa(t.corsa, dataTurno);
        const p = t.percorso;
        const conGeometria = !!(p && p.fermate && p.fermate.length === fc.length && p.fermate[tratta.a].dist > p.fermate[tratta.da].dist);
        let d0 = 0;
        if (conGeometria) {
            d0 = p.fermate[tratta.da].dist;
            const pts = ritaglia(p, d0, p.fermate[tratta.a].dist);
            pts.forEach((pt, k) => { if (n === 0 || k > 0) punti.push({ lat: pt.lat, lon: pt.lon, d: offset + pt.d }); });
        } else geometria = false;

        for (let i = tratta.da; i <= tratta.a; i++) {
            const dist = conGeometria ? offset + p.fermate[i].dist - d0 : 0;
            if (n > 0 && i === tratta.da) {
                // fermata di passaggio tra due corse (rebecchino): arriva con la prima corsa, riparte con la seconda
                const ultima = fermate[fermate.length - 1];
                if (ultima) ultima.dep = orari[i].dep;
                continue;
            }
            fermate.push({ id: fc[i].id, nome: fc[i].nome, dist, arr: orari[i].arr, dep: orari[i].dep });
        }
        if (conGeometria) offset = punti[punti.length - 1].d;
    });

    const percorso = { fermate, geometria, lunghezza: geometria ? offset : 0, lat: [], lon: [], x: [], y: [], cum: [] };
    if (geometria) {
        const lat0 = punti.reduce((s, q) => s + q.lat, 0) / punti.length;
        const lon0 = punti.reduce((s, q) => s + q.lon, 0) / punti.length;
        const kx = RAD * R_TERRA * Math.cos(lat0 * RAD);
        const ky = RAD * R_TERRA;
        percorso.origine = { lat0, lon0, kx, ky };
        for (const q of punti) {
            percorso.lat.push(q.lat); percorso.lon.push(q.lon); percorso.cum.push(q.d);
            percorso.x.push((q.lon - lon0) * kx); percorso.y.push((q.lat - lat0) * ky);
        }
    }
    return percorso;
}

// Posizione (x, y in metri nel riferimento del percorso) di un punto GPS
function aPiano(rt, lat, lon) {
    const o = rt.origine;
    return { x: (lon - o.lon0) * o.kx, y: (lat - o.lat0) * o.ky };
}

// Dove si trova, in base all'orario, il mezzo se fosse perfettamente in orario (usato per scegliere tra due passaggi)
function alongDaOrario(rt, nowSec) {
    const F = rt.fermate;
    if (nowSec <= F[0].dep) return F[0].dist;
    for (let k = 0; k < F.length - 1; k++) {
        if (nowSec <= F[k + 1].arr) {
            const span = F[k + 1].arr - F[k].dep;
            const t = span > 0 ? Math.max(0, Math.min(1, (nowSec - F[k].dep) / span)) : 1;
            return F[k].dist + t * (F[k + 1].dist - F[k].dist);
        }
        if (nowSec <= F[k + 1].dep) return F[k + 1].dist;
    }
    return F[F.length - 1].dist;
}

// Proietta la posizione sul percorso. Con una posizione precedente cerca solo nei dintorni, preferendo il punto
// coerente con il moto ("atteso" = ultima posizione + velocità × tempo): così le andate e ritorno a pochi metri
// di distanza (canali senza uscita) e i ripassi dallo stesso punto non fanno saltare la posizione.
// Se non trova nulla cerca su tutto il percorso. Restituisce { along, scarto } oppure null.
function proietta(rt, x, y, ultimaAlong, nowSec, atteso) {
    const nSeg = rt.x.length - 1;
    if (nSeg < 1) return null;

    const valuta = (i) => {
        const ax = rt.x[i], ay = rt.y[i], dx = rt.x[i + 1] - ax, dy = rt.y[i + 1] - ay;
        const l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        return { along: rt.cum[i] + t * (rt.cum[i + 1] - rt.cum[i]), scarto: Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) };
    };

    if (ultimaAlong != null) {
        const i0 = cercaSegmento(rt.cum, ultimaAlong - FINESTRA_INDIETRO_M);
        const i1 = cercaSegmento(rt.cum, ultimaAlong + FINESTRA_AVANTI_M);
        const previsto = atteso != null ? atteso : ultimaAlong;
        const candidatiLocali = [];
        let migliorScarto = Infinity;
        for (let i = i0; i <= i1; i++) {
            const c = valuta(i);
            if (c.scarto > FUORI_PERCORSO_M) continue;
            candidatiLocali.push(c);
            if (c.scarto < migliorScarto) migliorScarto = c.scarto;
        }
        if (candidatiLocali.length) {
            // Nei punti in cui andata e ritorno si sovrappongono (es. Colonna a Murano)
            // la sola distanza geometrica non basta: i due passaggi possono essere a pochi
            // metri ma molto distanti lungo il giro. In questi casi usiamo anche la posizione
            // prevista dall'orario per evitare di saltare direttamente al passaggio successivo.
            const ambigui = candidatiLocali.filter(c => c.scarto <= migliorScarto + 25);
            if (ambigui.length > 1) {
                const attesa = alongDaOrario(rt, nowSec);
                ambigui.forEach(c => {
                    c.costo = c.scarto
                        + PESO_CONTINUITA * Math.abs(c.along - previsto)
                        + 0.80 * Math.abs(c.along - attesa);
                });
                ambigui.sort((a, b) => a.costo - b.costo);
                return ambigui[0];
            }
            candidatiLocali.sort((a, b) =>
                (a.scarto + PESO_CONTINUITA * Math.abs(a.along - previsto)) -
                (b.scarto + PESO_CONTINUITA * Math.abs(b.along - previsto))
            );
            return candidatiLocali[0];
        }
    }

    // ricerca su tutto il percorso: un candidato per ogni passaggio della linea vicino al punto
    const candidati = [];
    let corrente = null;
    let migliore = null;
    for (let i = 0; i < nSeg; i++) {
        const c = valuta(i);
        if (!migliore || c.scarto < migliore.scarto) migliore = c;
        if (c.scarto <= FUORI_PERCORSO_M) { if (!corrente || c.scarto < corrente.scarto) corrente = c; }
        else if (corrente) { candidati.push(corrente); corrente = null; }
    }
    if (corrente) candidati.push(corrente);
    if (!candidati.length) return migliore; // fuori percorso: si riporta comunque il punto più vicino
    const attesa = alongDaOrario(rt, nowSec);
    const vicini = candidati.filter((c) => c.scarto <= migliore.scarto + 40);
    vicini.sort((a, b) => Math.abs(a.along - attesa) - Math.abs(b.along - attesa));
    return vicini[0];
}

// Orario che il mezzo dovrebbe avere in questo punto del percorso (interpolando tra le fermate in base alla distanza)
function orarioProgrammato(rt, along, nowSec) {
    const F = rt.fermate;
    const k0 = F.findIndex((f) => Math.abs(along - f.dist) <= SOGLIA_FERMATA_M);
    if (k0 >= 0) {
        // in fermata: finché si è dentro l'orario di sosta non c'è scostamento
        if (k0 === 0 && nowSec < F[0].dep) return nowSec; // in attesa di partire
        return Math.max(F[k0].arr, Math.min(F[k0].dep, nowSec));
    }
    if (along <= F[0].dist) return F[0].dep;
    for (let k = 0; k < F.length - 1; k++) {
        if (along < F[k + 1].dist) {
            const span = F[k + 1].dist - F[k].dist;
            const t = span > 0 ? (along - F[k].dist) / span : 0;
            return F[k].dep + t * (F[k + 1].arr - F[k].dep);
        }
    }
    return F[F.length - 1].arr;
}

// Prossima fermata in base alla posizione. "minimo" è l'indice sotto il quale le fermate sono già passate,
// "velocita" (m/s) serve a distinguere un mezzo che arriva alla fermata da uno che la sta lasciando.
function trovaProssima(rt, along, nowSec, minimo, velocita) {
    const F = rt.fermate;
    const inMovimento = velocita != null && velocita > SOGLIA_MOVIMENTO_MS;
    for (let k = Math.max(0, minimo); k < F.length; k++) {
        const d = F[k].dist - along; // > 0: la fermata è ancora avanti
        if (d > SOGLIA_FERMATA_M) return { idx: k, stato: 'in arrivo', distM: d };
        if (d >= -SOGLIA_FERMATA_M) {
            if (k === F.length - 1) return inMovimento && d > 10 ? { idx: k, stato: 'in arrivo', distM: d } : { idx: k, stato: 'arrivato', distM: 0 };
            if (d > 0 && inMovimento) return { idx: k, stato: 'in arrivo', distM: d };
            if (d <= 0 && inMovimento) continue; // la sta lasciando
            return { idx: k, stato: 'in fermata', distM: 0 };
        }
    }
    return { idx: F.length - 1, stato: 'arrivato', distM: 0 };
}

// Senza GPS: prossima fermata secondo l'orario
function trovaProssimaDaOrario(rt, nowSec) {
    const F = rt.fermate;
    for (let k = 0; k < F.length; k++) {
        const t = k === F.length - 1 ? F[k].arr : F[k].dep;
        if (nowSec <= t) return { idx: k, stato: 'in arrivo', distM: null };
    }
    return { idx: F.length - 1, stato: 'arrivato', distM: null };
}

// ---------------------------------------------------------------- stato del navigatore
let gpsAttivo = false;                 // GPS di BateoLive acceso
let navVisibile = true;                // tasto fa-route: false = solo velocità
let navTimer = null;
let userMansione = null;

let datiTurni = null;                  // rotazioni, disponibilità, varianti, ferie (turni-core.js, scaricati una volta sola)
const cacheFetch = new Map();          // url -> json
let inCaricamento = false;
let turnoCorrente = null;              // { data, codice, stato, attivita, turno }
let ultimoTentativoTurno = 0;
let oraRif = null;                     // { giorno, presto } usato per capire quando ricaricare il turno

let attKey = null;                     // attività di cui si sta caricando/mostrando il percorso
let percorso = null;                   // percorso costruito per l'attività, null finché non arriva
let percorsoStato = 'nessuno';         // nessuno | caricamento | ok | errore
let percorsoErroreTs = 0;
let direzioneCorsa = '';
let lineaCorsa = '';
let tokenPercorso = 0;
let minimoFermata = 0;                 // le fermate sotto questo indice sono già passate

let gpsPos = { lat: null, lon: null, acc: null, vel: null, along: null, scarto: null, ts: 0, fuori: false, ritardoIstantaneo: 0 };
let ritardoSmussato = null;
let firmaLista = '';
let listaAperta = false;
let htmlAttPrecedente = '';

let rottaLayer = null;                 // rotta della linea sulla mappa
let rottaKey = null;

const navEl = (id) => document.getElementById(id);


// ---------------------------------------------------------------- turno del giorno e percorso
async function initCaches() {
    if (datiTurni && !datiTurni.incompleto) return;
    try { datiTurni = await caricaDatiTurni(); }
    catch (e) { console.error("GPS: errore cache turni", e); }
}

async function fetchJson(url) {
    if (cacheFetch.has(url)) return cacheFetch.get(url);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const dati = await resp.json();
    cacheFetch.set(url, dati);
    return dati;
}

// Turno di un giorno: { data, codice, stato: 'ok' | 'riposo' | 'varianti' | 'errore', attivita[], turno }
async function turnoDelGiorno(dStr) {
    let state = {};
    try { state = JSON.parse(localStorage.getItem('myTurniApp')) || {}; } catch (e) { }
    const manuale = !!(state.variazioni && state.variazioni[dStr]);
    let codice = turnoEffettivo(dStr, state, datiTurni, userMansione);
    // ferie previste dalla rotazione ferie (come nel calendario): senza variazione manuale il turno diventa FEP
    if (!manuale && datiTurni && !["RI", "AL"].includes(String(codice).toUpperCase())) {
        const ferie = ferieDelGiorno(state, dStr, datiTurni.ferie);
        if (ferie) codice = ferie;
    }
    const senzaCorse = !codice || TURNI_SENZA_CORSE.includes(String(codice).toUpperCase().trim());
    const esito = { data: dStr, codice: codice || "N/D", stato: 'ok', attivita: [], turno: null };

    if (senzaCorse) { esito.stato = 'riposo'; return esito; }
    if (esito.codice === "N/D") { esito.stato = 'nd'; return esito; }
    if (BLOCCA_SE_VARIANTI && haVarianti(datiTurni, dStr)) { esito.stato = 'varianti'; return esito; }

    try {
        const dati = await fetchJson(`${API_URL}/api/v1/turno?codice=${encodeURIComponent(codice)}&data=${encodeURIComponent(dStr)}`);
        esito.turno = dati.turno;
        esito.attivita = preparaAttivita(dati.turno);
    } catch (e) {
        console.warn("GPS: turno non disponibile", e);
        esito.stato = 'errore';
    }
    return esito;
}

// Attività in ordine, con partenza/arrivo in minuti dalla mezzanotte del giorno del turno (_p, _a)
function preparaAttivita(turno) {
    const tutte = [...unisciRebecchini(turno.corse_linea || []), ...(turno.altre_attivita || [])]
        .sort((a, b) => a.ordine - b.ordine)
        .map((a) => ({ ...a }));
    let prec = 0;
    for (const act of tutte) {
        const conMin = Number.isFinite(act.partenza_min);
        let p = conMin ? act.partenza_min : parseHHMM(act.partenza);
        if (p == null) p = prec;
        if (!conMin) while (p < prec) p += 1440;
        const aConMin = Number.isFinite(act.arrivo_min);
        let a = aConMin ? act.arrivo_min : parseHHMM(act.arrivo);
        if (a == null) a = p;
        if (!aConMin) while (a < p) a += 1440;
        act._p = p; act._a = a; prec = p;
    }
    return tutte;
}

async function caricaTurno() {
    if (inCaricamento) return;
    inCaricamento = true;
    ultimoTentativoTurno = Date.now();
    try {
        await initCaches();

        const ora = new Date();
        const oggi = dateToLocalISO(ora);
        const presto = ora.getHours() < 6;
        let scelto = null;

        // di notte il turno in corso può essere quello iniziato ieri sera
        if (presto) {
            const ieriData = new Date(ora.getFullYear(), ora.getMonth(), ora.getDate() - 1, 12);
            const ieri = await turnoDelGiorno(dateToLocalISO(ieriData));
            if (ieri.stato === 'ok' && ieri.attivita.length) {
                const fine = Math.max(...ieri.attivita.map((a) => a._a));
                if (secondiDalGiorno(ieri.data, ora) / 60 <= fine + 30) scelto = ieri;
            }
        }
        if (!scelto) scelto = await turnoDelGiorno(oggi);

        // stesso turno di prima: si tengono percorso e fermate già caricati
        const uguale = turnoCorrente && scelto.data === turnoCorrente.data && scelto.codice === turnoCorrente.codice && scelto.stato === turnoCorrente.stato;
        turnoCorrente = scelto;
        oraRif = { giorno: oggi, presto };
        if (!uguale) { attKey = null; percorso = null; percorsoStato = 'nessuno'; minimoFermata = 0; firmaLista = ''; tokenPercorso++; }
    } catch (e) {
        console.error("GPS: errore nel caricamento del turno", e);
    } finally {
        inCaricamento = false;
    }
    renderNavigatore();
}

// ---------------------------------------------------------------- attività e percorso
function scegliAttivita(nowMin) {
    const lista = turnoCorrente ? turnoCorrente.attivita : [];
    if (!lista.length) return { act: null, tipo: null };
    const inCorso = lista.find((a) => a._p <= nowMin && nowMin < a._a);
    if (inCorso) return { act: inCorso, tipo: 'in corso' };
    const prossima = lista.find((a) => a._p > nowMin);
    if (prossima) return { act: prossima, tipo: 'prossima' };
    return { act: null, tipo: 'finito' };
}

const eCorsa = (act) => !!(act && Object.prototype.hasOwnProperty.call(act, 'linea'));
const chiaveAttivita = (act) => act ? `${turnoCorrente.data}|${act.ordine}|${act.partenza}|${act.linea || ''}` : null;

async function datiCorsa(act, data) {
    const params = new URLSearchParams({
        linea: act.linea, data: data,
        partenza_min: act.partenza_min, arrivo_min: act.arrivo_min, da: act.da, a: act.a
    });
    return fetchJson(`${API_URL}/api/v1/corsa?${params}`);
}

async function datiPercorso(corsa) {
    const shapeId = corsa.corsa && corsa.corsa.shapeId;
    if (!shapeId) return null; // backend non aggiornato: si va avanti solo con gli orari
    try {
        const ids = corsa.fermate.map((f) => f.id).join(',');
        return await fetchJson(`${API_URL}/api/v1/percorso?shape_id=${encodeURIComponent(shapeId)}&fermate=${encodeURIComponent(ids)}`);
    } catch (e) {
        console.warn("GPS: percorso non disponibile", e);
        return null;
    }
}

async function costruisciPercorsoAttivita(act, data) {
    const corse = act.tipo_attivita === "rebecchino" && act.rebecchino_prima_corsa && act.rebecchino_seconda_corsa
        ? [act.rebecchino_prima_corsa, act.rebecchino_seconda_corsa] : [act];
    const tratte = [];
    for (const c of corse) {
        const corsa = await datiCorsa(c, data);
        tratte.push({ corsa, percorso: await datiPercorso(corsa) });
    }
    return { rt: costruisciPercorso(tratte, data), direzione: (tratte[tratte.length - 1].corsa.corsa || {}).direzione || '' };
}

function caricaPercorso(act) {
    const chiave = chiaveAttivita(act);
    const mio = ++tokenPercorso;
    attKey = chiave; lineaCorsa = String(act.linea || ''); percorso = null; percorsoStato = 'caricamento'; minimoFermata = 0; firmaLista = '';
    gpsPos.along = null; ritardoSmussato = null;
    costruisciPercorsoAttivita(act, turnoCorrente.data).then(({ rt, direzione }) => {
        if (mio !== tokenPercorso) return;
        percorso = rt; direzioneCorsa = direzione; percorsoStato = 'ok'; firmaLista = '';
        renderNavigatore();
        precaricaSuccessiva(act);
    }).catch((e) => {
        if (mio !== tokenPercorso) return;
        console.warn("GPS: fermate non disponibili", e);
        percorsoStato = 'errore'; percorsoErroreTs = Date.now();
        renderNavigatore();
    });
}

// scarica in anticipo la corsa dopo quella in corso, così funziona anche se la linea dati cade
function precaricaSuccessiva(act) {
    const lista = turnoCorrente ? turnoCorrente.attivita : [];
    const dopo = lista.find((a) => a._p >= act._a && eCorsa(a));
    if (dopo) costruisciPercorsoAttivita(dopo, turnoCorrente.data).catch(() => { });
}

function serveRicaricare() {
    if (!turnoCorrente || !oraRif) return true;
    const ora = new Date();
    if (dateToLocalISO(ora) !== oraRif.giorno || (ora.getHours() < 6) !== oraRif.presto) return true;
    if (turnoCorrente.stato === 'errore' && Date.now() - ultimoTentativoTurno > 30000) return true;
    return false;
}

// ---------------------------------------------------------------- linea e attività
// La linea si prende dal turno. Nei rebecchini cambia a metà: dopo la prima corsa vale quella della seconda.
function lineaDellAttivita(act, nowMin) {
    if (act.tipo_attivita === 'rebecchino' && act.rebecchino_prima_corsa && act.rebecchino_seconda_corsa) {
        const prima = act.rebecchino_prima_corsa;
        if (Number.isFinite(prima.arrivo_min) && nowMin >= prima.arrivo_min) {
            return String(act.rebecchino_seconda_corsa.linea || act.linea || '');
        }
    }
    return String(act.linea || '');
}

function badgeLineaNav(linea) {
    const c = getLineColors(String(linea).toUpperCase());
    return `<span class="bv-nav-linea" style="background:${c.bg};color:${c.text};border-color:${c.border};">${esc(linea)}</span>`;
}

function pillTurnoNav() {
    if (!turnoCorrente) return '';
    return `<span class="bv-nav-turno" title="Turno"><small>TURNO</small>${esc(turnoCorrente.codice)}</span>`;
}

function htmlMessaggioNav(testo) {
    return `<div class="bv-nav-act-row">${pillTurnoNav()}<span class="bv-nav-dest bv-nav-msg">${testo}</span></div>`;
}

function htmlAttivitaNav(act, tipo, direzione, nowMin) {
    // a sinistra turno e linea impilati; a destra orario e luogo di partenza → arrivo (il luogo va a capo, non si taglia)
    let sinistra;
    if (eCorsa(act)) sinistra = badgeLineaNav(lineaDellAttivita(act, nowMin));
    else sinistra = `<span class="bv-nav-pill">${esc(act.tipo || 'Attività')}</span>`;
    const reb = act.tipo_attivita === 'rebecchino' ? '<span class="bv-nav-reb">REB</span>' : '';
    const blocco = (ora, luogo) => `<div class="bv-nav-blocco"><div class="bv-nav-ora">${esc(ora)}</div><div class="bv-nav-luogo">${esc(luogo || '')}</div></div>`;
    const tag = tipo === 'prossima' ? '<div class="bv-nav-tag">Prossima attività</div>' : '';
    return `${tag}<div class="bv-nav-act-row">
        <div class="bv-nav-id">${pillTurnoNav()}${sinistra}</div>
        ${blocco(act.partenza, act.da)}
        <div class="bv-nav-freccia"><i class="fa-solid fa-arrow-right-long"></i>${reb}</div>
        ${blocco(act.arrivo, act.a)}
    </div>`;
}

function impostaAttivitaNav(html) {
    if (html === htmlAttPrecedente) return;
    htmlAttPrecedente = html;
    navEl('bv-nav-act').innerHTML = html;
}

// ---------------------------------------------------------------- prossima fermata e tendina
function oraFermata(rt, i) {
    const f = rt.fermate[i];
    return hhmm(i === rt.fermate.length - 1 ? f.arr : f.dep);
}

function chiudiListaFermate() {
    listaAperta = false;
    navEl('bv-nav-lista').classList.remove('aperta');
    navEl('bv-nav-toggle').classList.remove('aperto');
}

function scrollaSuProssima() {
    const lista = navEl('bv-nav-lista');
    const p = lista.querySelector('.prossima');
    if (p) lista.scrollTop = Math.max(0, p.offsetTop - lista.clientHeight / 2 + p.offsetHeight / 2);
}

function toggleListaFermate() {
    listaAperta = !listaAperta;
    navEl('bv-nav-lista').classList.toggle('aperta', listaAperta);
    navEl('bv-nav-toggle').classList.toggle('aperto', listaAperta);
    if (listaAperta) scrollaSuProssima();
}

// visibile=false nasconde blocco e freccetta; con "testo" mostra solo un messaggio al posto della fermata
function mostraProssima(visibile, testo) {
    navEl('bv-nav-next').hidden = !visibile;
    navEl('bv-nav-toggle').hidden = !(visibile && !testo);
    if (!visibile || testo) {
        chiudiListaFermate();
        firmaLista = '';
        navEl('bv-nav-lista').innerHTML = '';
    }
    if (visibile && testo) {
        navEl('bv-nav-next-label').innerHTML = testo;
        navEl('bv-nav-next-nome').textContent = '';
        navEl('bv-nav-next-ora').textContent = '';
    }
}

function disegnaProssimaNav(nav, fuori) {
    const rt = percorso;
    const f = rt.fermate[nav.idx];
    const etichette = { 'in arrivo': 'Prossima', 'in fermata': 'In fermata', 'arrivato': 'Arrivato a' };
    let info = '';
    if (fuori) info = ` · <span class="bv-nav-warn">fuori percorso</span>`;
    else if (nav.stato === 'in arrivo' && nav.distM != null) {
        info = nav.distM >= 1000 ? ` · ${(nav.distM / 1000).toFixed(1)} km` : ` · ${Math.max(10, Math.round(nav.distM / 10) * 10)} m`;
    }
    mostraProssima(true);
    navEl('bv-nav-next-label').innerHTML = etichette[nav.stato] + info;
    navEl('bv-nav-next-nome').textContent = f.nome;
    navEl('bv-nav-next-ora').textContent = oraFermata(rt, nav.idx);

    // la tendina (tutte le fermate) si ricostruisce solo quando cambia la fermata, non a ogni secondo
    const firma = `${attKey}|${nav.idx}`;
    if (firma !== firmaLista) {
        firmaLista = firma;
        const ultima = rt.fermate.length - 1;
        navEl('bv-nav-lista').innerHTML = rt.fermate.map((s, i) => {
            const cls = i < nav.idx ? ' passata' : i === nav.idx ? ' prossima' : '';
            return `<div class="bv-nav-fermata${cls}"><span class="bv-nav-punto"></span><span class="bv-nav-fnome">${esc(s.nome)}</span><span class="bv-nav-fora${i === ultima ? ' fine' : ''}">${oraFermata(rt, i)}</span></div>`;
        }).join('');
        if (listaAperta) scrollaSuProssima();
    }
}

function disegnaRitardoNav(sec) {
    const d = navEl('bv-nav-delay');
    d.classList.remove('tardi', 'presto', 'puntuale', 'spento');
    if (sec == null) { d.textContent = '--'; d.classList.add('spento'); d.title = 'Ritardo / anticipo'; return; }
    const m = Math.round(sec / 60);
    d.textContent = formattaRitardo(sec);
    d.classList.add(m > 0 ? 'tardi' : m < 0 ? 'presto' : 'puntuale');
    d.title = m > 0 ? 'In ritardo' : m < 0 ? 'In anticipo' : 'In orario';
}

// ---------------------------------------------------------------- rotta sulla mappa
// Disegnata in un pane proprio (sotto marker di unità e fermate, sopra le tile) e senza intercettare i click.
function coloreRotta(linea) {
    const c = getLineColors(String(linea).toUpperCase());
    return c.bg.toLowerCase() === '#ffffff' ? c.border : c.bg;
}

function aggiornaRottaMappa() {
    const voluta = (map && gpsAttivo && navVisibile && percorso && percorso.geometria && percorsoStato === 'ok') ? attKey : null;
    if (voluta === rottaKey) return;
    if (rottaLayer && map) { map.removeLayer(rottaLayer); }
    rottaLayer = null;
    rottaKey = voluta;
    if (!voluta) return;
    const punti = percorso.lat.map((la, i) => [la, percorso.lon[i]]);
    const comune = { pane: 'bv-rotta', interactive: false, lineCap: 'round', lineJoin: 'round' };
    rottaLayer = L.layerGroup([
        L.polyline(punti, { ...comune, color: '#0b1b2b', weight: 8, opacity: 0.45 }),
        L.polyline(punti, { ...comune, color: coloreRotta(lineaCorsa), weight: 5, opacity: 0.95 })
    ]).addTo(map);
}

// ---------------------------------------------------------------- posizione sul percorso
function aggiornaPosizioneNavigatore(coords, now, avgSpeedMs) {
    gpsPos.lat = coords.latitude; gpsPos.lon = coords.longitude; gpsPos.acc = coords.accuracy; gpsPos.vel = avgSpeedMs;

    if (percorso && percorso.geometria && turnoCorrente && coords.accuracy <= ACCURATEZZA_MAX_M) {
        const nowSec = secondiDalGiorno(turnoCorrente.data);
        const p = aPiano(percorso, coords.latitude, coords.longitude);
        let atteso = null;
        if (gpsPos.along != null) atteso = gpsPos.along + (gpsPos.vel || 0) * Math.min(10, (now - gpsPos.ts) / 1000);
        const pr = proietta(percorso, p.x, p.y, gpsPos.along, nowSec, atteso);
        if (pr) {
            gpsPos.fuori = pr.scarto > FUORI_PERCORSO_M;
            if (!gpsPos.fuori) {
                // un salto indietro di molto (nuovo passaggio) azzera le fermate già passate
                if (gpsPos.along != null && pr.along < gpsPos.along - 300) minimoFermata = 0;
                gpsPos.along = pr.along; gpsPos.scarto = pr.scarto; gpsPos.ts = now;
                const inst = nowSec - orarioProgrammato(percorso, pr.along, nowSec);
                gpsPos.ritardoIstantaneo = inst;
                const arrivato = pr.along >= percorso.lunghezza - SOGLIA_FERMATA_M;
                const inAttesa = pr.along <= percorso.fermate[0].dist + SOGLIA_FERMATA_M && nowSec < percorso.fermate[0].dep; // fermo al primo attracco, non è ancora partito
                if (!arrivato && !inAttesa) ritardoSmussato = ritardoSmussato == null ? inst : ritardoSmussato + SMORZA_RITARDO * (inst - ritardoSmussato);
            }
        }
    }
}

// ---------------------------------------------------------------- disegno
// Un giro completo: sceglie l'attività, carica il percorso se serve, calcola ritardo e prossima fermata,
// aggiorna la linea che BateoLive comunica agli altri utenti (customLine).
function renderNavigatore() {
    if (!gpsAttivo) return;

    const messaggio = (testo) => {
        customLine = '';
        impostaAttivitaNav(htmlMessaggioNav(testo));
        mostraProssima(false);
        disegnaRitardoNav(null);
        aggiornaRottaMappa();
    };

    if (!turnoCorrente) return messaggio('<i class="fa-solid fa-spinner fa-spin"></i> Carico il turno…');
    const st = turnoCorrente.stato;
    if (st === 'riposo') return messaggio('Nessuna corsa in programma oggi');
    if (st === 'varianti') return messaggio('<i class="fa-solid fa-triangle-exclamation"></i> Variante in corso: orari del turno non validi');
    if (st === 'nd') return messaggio('Turno non calcolabile: completa il calendario');
    if (st === 'errore') return messaggio('<i class="fa-solid fa-triangle-exclamation"></i> Turno non disponibile');

    const adesso = new Date();
    const nowSec = secondiDalGiorno(turnoCorrente.data, adesso);
    const nowMin = nowSec / 60;
    const { act, tipo } = scegliAttivita(nowMin);
    if (!act) return messaggio(tipo === 'finito' ? 'Turno terminato' : 'Nessuna attività nel turno');

    // percorso: serve per la corsa in corso e, poco prima, per la successiva
    const serve = eCorsa(act) && (tipo === 'in corso' || act._p - nowMin <= PRECARICA_MIN);
    const chiave = chiaveAttivita(act);
    if (serve && chiave !== attKey) caricaPercorso(act);
    else if (serve && percorsoStato === 'errore' && Date.now() - percorsoErroreTs > 30000) caricaPercorso(act);
    else if (!serve && attKey) { attKey = null; percorso = null; percorsoStato = 'nessuno'; tokenPercorso++; }

    // linea comunicata agli altri: solo durante la corsa
    customLine = (tipo === 'in corso' && eCorsa(act)) ? lineaDellAttivita(act, nowMin) : '';

    impostaAttivitaNav(htmlAttivitaNav(act, tipo, serve && percorsoStato === 'ok' ? direzioneCorsa : '', nowMin));

    // ritardo e prossima fermata
    let ritardo = null;
    if (serve && percorsoStato === 'ok') {
        let nav;
        const fixFresco = gpsPos.along != null && (Date.now() - gpsPos.ts) < FIX_SCADUTO_MS && !gpsPos.fuori;
        if (percorso.geometria && fixFresco) {
            nav = trovaProssima(percorso, gpsPos.along, nowSec, minimoFermata, gpsPos.vel);
            minimoFermata = Math.max(minimoFermata, nav.idx);
            // media mobile dei fix, aggiornata con quanto il ritardo è cambiato dall'ultimo fix
            const istantaneo = nowSec - orarioProgrammato(percorso, gpsPos.along, nowSec);
            ritardo = ritardoSmussato == null ? istantaneo : ritardoSmussato + (istantaneo - gpsPos.ritardoIstantaneo);
            if (nav.stato === 'arrivato' && ritardoSmussato != null) ritardo = ritardoSmussato; // a fine corsa il ritardo non cresce più
        } else {
            nav = trovaProssimaDaOrario(percorso, nowSec);
        }
        disegnaProssimaNav(nav, tipo === 'in corso' && gpsPos.fuori);
    } else if (serve && percorsoStato === 'errore') {
        mostraProssima(true, 'Fermate non disponibili');
    } else if (serve) {
        mostraProssima(true, '<i class="fa-solid fa-spinner fa-spin"></i> Carico le fermate…');
    } else {
        mostraProssima(false);
    }
    disegnaRitardoNav(ritardo);
    aggiornaRottaMappa();
}

// ---------------------------------------------------------------- ciclo di vita
function tickNavigatore() {
    if (!gpsAttivo) return;
    if (serveRicaricare() && Date.now() - ultimoTentativoTurno > 5000) caricaTurno();
    else renderNavigatore();
}

function azzeraStatoNavigatore() {
    turnoCorrente = null; oraRif = null;
    attKey = null; percorso = null; percorsoStato = 'nessuno'; direzioneCorsa = ''; lineaCorsa = '';
    tokenPercorso++;
    minimoFermata = 0; ritardoSmussato = null; firmaLista = ''; htmlAttPrecedente = '';
    gpsPos = { lat: null, lon: null, acc: null, vel: null, along: null, scarto: null, ts: 0, fuori: false, ritardoIstantaneo: 0 };
}

// chiamata quando si accende il GPS: il tasto fa-route parte attivo
function avviaNavigatore() {
    gpsAttivo = true;
    navVisibile = true;
    azzeraStatoNavigatore();
    navEl('bv-hud-speed').classList.add('nav-on');
    navEl('bv-fab-nav').classList.add('active');
    mostraProssima(false);
    disegnaRitardoNav(null);
    impostaAttivitaNav(htmlMessaggioNav('<i class="fa-solid fa-spinner fa-spin"></i> Carico il turno…'));
    if (!navTimer) navTimer = setInterval(tickNavigatore, 1000);
    caricaTurno();
}

// chiamata quando si spegne il GPS o si chiude BateoLive
function fermaNavigatore() {
    gpsAttivo = false;
    if (navTimer) { clearInterval(navTimer); navTimer = null; }
    azzeraStatoNavigatore();
    customLine = '';
    aggiornaRottaMappa();
}

// tasto fa-route: mostra/nasconde dati del navigatore e rotta, lasciando solo la velocità
function toggleBvNavigatore(forceState = null) {
    if (!bateoliveAuthenticated) { apriBateoLiveAuthModal(); return; }
    navVisibile = forceState !== null ? forceState : !navVisibile;
    navEl('bv-fab-nav').classList.toggle('active', navVisibile);
    navEl('bv-hud-speed').classList.toggle('nav-on', navVisibile);
    if (!navVisibile) chiudiListaFermate();
    aggiornaRottaMappa();
    if (navVisibile) renderNavigatore();
}

export const _test = { costruisciPercorso, proietta, orarioProgrammato, trovaProssima, trovaProssimaDaOrario, alongDaOrario, aPiano, formattaRitardo, hhmm };
