// ==========================================
// TURNI-CORE — logica dei turni condivisa da calendario.js, dashboard.js e gps.js
//
// Qui c'e' UNA sola copia di: calcolo del turno di un giorno, regole DISP per giorno della settimana,
// ferie da rotazione, conversione per mansione, ricerca del codice nel libro turni, unione dei rebecchini
// e caricamento dei file JSON (rotazioni, disponibilita', libro turni, varianti, ferie).
//
// Le funzioni di calcolo sono pure: ricevono tutto quello che serve come parametro e non toccano
// DOM, localStorage o variabili globali.
//
// IMPORTANTE: tutti i moduli devono importarlo con lo STESSO percorso, per esempio sempre
//     import { ... } from "./turni-core.js";
// Con un percorso diverso (anche solo "?v=123") il browser crea una seconda copia del modulo, con una
// cache dei dati tutta sua.
// ==========================================

export const API_URL = 'https://api.bateolive.stream';

// Data da cui vale la nuova rotazione: prima di questa data si usa state.history.
// E' l'UNICO posto in cui va cambiata.
export const DATA_INIZIO_NUOVI_TURNI = "2026-10-01";

// Codici di turno che non hanno corse da mostrare
export const TURNI_SENZA_CORSE = ["RIPOSO", "RI", "DISP", "NPL", "AL", "FER", "FEP", "FES", "PRT", "KINF", "KMAL", "KNOP", "AVIS"];

export const ACTV_COLORS = {
    '1': { bg: '#ffffff', text: '#000000', border: '#000000' },
    '2': { bg: '#e3001b', text: '#ffffff', border: '#e3001b' },
    '2/': { bg: '#e3001b', text: '#ffffff', border: '#e3001b' },
    '3': { bg: '#ff8c00', text: '#000000', border: '#ff8c00' },
    '4.1': { bg: '#bd429b', text: '#ffffff', border: '#bd429b' },
    '4.2': { bg: '#bd429b', text: '#ffffff', border: '#bd429b' },
    '5.1': { bg: '#60b9a6', text: '#000000', border: '#60b9a6' },
    '5.2': { bg: '#60b9a6', text: '#000000', border: '#60b9a6' },
    '6': { bg: '#0070bc', text: '#ffffff', border: '#0070bc' },
    'N': { bg: '#1c355e', text: '#ffffff', border: '#1c355e' },
    '11': { bg: '#f49ab4', text: '#000000', border: '#f49ab4' }
};

// ==========================================
// 1. UTILITA' DI DATA E TESTO
// ==========================================
export function dateToLocalISO(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
}

export function stringToNum(s) {
    if (!s) return 0;
    let p = s.split('-');
    return Math.floor(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
}

export function creaDataSicura(dataStr) {
    if (!dataStr) return new Date();
    let p = dataStr.split('-');
    return new Date(p[0], p[1] - 1, p[2], 12, 0, 0);
}

export function estraiDataDaNome(nome) {
    const match = String(nome).match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : null;
}

export function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function getLineStyle(linea) {
    const c = ACTV_COLORS[linea] || { bg: '#ffffff', text: '#000000', border: '#333333' };
    return `background-color: ${c.bg}; color: ${c.text}; border-color: ${c.border};`;
}

// ==========================================
// 2. MANSIONE E CODICI TURNO
// ==========================================
export function convertiTurnoPerMansione(turno, mansione) {
    if (!turno || !mansione) return turno;
    let t = String(turno).toUpperCase();
    let m = String(mansione).toLowerCase();
    let isMarinaio = m.includes('marinaio') || m.includes('timoniere');

    if (isMarinaio) {
        let matchP = t.match(/^([1-9])[CP](\d{2})$/);
        if (matchP) return `${matchP[1]}B${matchP[2]}`;
    } else {
        let matchB = t.match(/^([1-9])B(\d{2})$/);
        if (matchB) {
            let l = matchB[1]; let f = matchB[2];
            let letPilota = (l === '1' || l === '2') ? 'C' : 'P';
            return `${l}${letPilota}${f}`;
        }
    }
    return t;
}

// Trova nel libro turni (info_turni) la chiave giusta per un codice e un giorno della settimana
export function trovaChiaveEsatta(db, codiceBase, dateStr) {
    if (!db || !codiceBase) return codiceBase;

    let codiciDaCercare = [codiceBase];

    let matchB = codiceBase.match(/^([1-9])B(\d{2})$/);
    if (matchB) {
        let linea = matchB[1];
        let finale = matchB[2];
        let letteraPilota = (linea === '1' || linea === '2') ? 'C' : 'P';

        let regex = new RegExp(`^${linea}[A-Z]${finale}$`);
        let trovati = Object.keys(db).filter(k => regex.test(k));
        if (trovati.length > 0) {
            codiciDaCercare.push(...trovati);
        } else {
            codiciDaCercare.push(`${linea}${letteraPilota}${finale}`);
        }
    } else {
        let match50 = codiceBase.match(/^([A-Z0-9]+?)(\d{2})$/);
        if (match50) {
            let pref = match50[1];
            let num = parseInt(match50[2], 10);
            if (num >= 50) {
                let numPilota = String(num - 50).padStart(2, '0');
                codiciDaCercare.push(pref + numPilota);
            }
        }
    }

    let giornoIdx = creaDataSicura(dateStr).getDay();
    let targetDay = giornoIdx === 0 ? 7 : giornoIdx;
    const dayMap = { "LUN": 1, "MAR": 2, "MER": 3, "GIO": 4, "VEN": 5, "SAB": 6, "DOM": 7 };

    for (let codCercato of codiciDaCercare) {
        let keys = Object.keys(db).filter(k => k === codCercato || k.startsWith(codCercato + "_"));

        let exactMatch = null;
        let genericMatch = null;

        for (let k of keys) {
            if (k === codCercato) {
                genericMatch = k;
                continue;
            }

            let suffix = k.substring(codCercato.length + 1);

            if (suffix.includes("-")) {
                let parts = suffix.split("-");
                if (parts.length === 2 && dayMap[parts[0]] && dayMap[parts[1]]) {
                    let start = dayMap[parts[0]];
                    let end = dayMap[parts[1]];

                    if (start <= end) {
                        if (targetDay >= start && targetDay <= end) exactMatch = k;
                    } else {
                        if (targetDay >= start || targetDay <= end) exactMatch = k;
                    }
                }
            } else {
                if (dayMap[suffix] && dayMap[suffix] === targetDay) {
                    exactMatch = k;
                }
            }
        }
        if (exactMatch) return exactMatch;
        if (genericMatch) return genericMatch;
    }

    return codiceBase;
}

// Due corse consecutive "... -> MUSEO" e "MUSEO -> ..." con lo stesso orario diventano un'unica attivita' "rebecchino"
export function unisciRebecchini(corse) {
    const ordinate = [...(corse || [])].sort((a, b) => a.ordine - b.ordine);
    const risultato = [];
    for (let i = 0; i < ordinate.length; i++) {
        const corrente = ordinate[i];
        const successiva = ordinate[i + 1];
        const eRebecchino = successiva && String(corrente.a || "").trim().toUpperCase() === "MUSEO" &&
            String(successiva.da || "").trim().toUpperCase() === "MUSEO" && String(corrente.arrivo || "") === String(successiva.partenza || "");

        if (eRebecchino) {
            risultato.push({
                ...corrente, a: successiva.a, arrivo: successiva.arrivo, arrivo_min: successiva.arrivo_min,
                durata_min: (corrente.durata_min || 0) + (successiva.durata_min || 0),
                tipo_attivita: "rebecchino", note: [...(corrente.note || []), ...(successiva.note || [])],
                consegna: successiva.consegna || corrente.consegna || null,
                rebecchino_prima_corsa: corrente, rebecchino_seconda_corsa: successiva
            });
            i++;
        } else { risultato.push(corrente); }
    }
    return risultato;
}

// ==========================================
// 3. CALCOLO DEL TURNO DI UN GIORNO
// ==========================================
export function isGiornoRiposoBase(curr, cfg) {
    if (!cfg.riposoStart) return false;
    let ref = stringToNum(cfg.riposoStart);
    if (cfg.depositoAttivo === 'disp_det') return (((curr - ref) % 6 + 6) % 6 === 0);
    let pos = ((curr - ref + 6) % 15 + 15) % 15;
    return (pos === 6 || pos === 13 || pos === 14);
}

// Tra le versioni di una cache indicizzata per data di inizio ("2026-10-01": {...}) sceglie quella in vigore.
// Prima della prima data vale la prima versione.
export function cachePerData(cache, dateStr) {
    const dSelezionata = stringToNum(dateStr);
    const dateChiavi = Object.keys(cache || {}).sort();
    if (dateChiavi.length === 0) return null;

    let corrente = cache[dateChiavi[0]];
    for (let i = dateChiavi.length - 1; i >= 0; i--) {
        if (dSelezionata >= stringToNum(dateChiavi[i])) {
            corrente = cache[dateChiavi[i]];
            break;
        }
    }
    return corrente;
}

// Turno "di base" (cioe' senza le variazioni manuali) di un giorno.
//   cfgData = lo stato dell'utente (state del calendario, anche quello di un collega)
//   dati    = { rot, disp } cache delle rotazioni e delle disponibilita' per giorno della settimana
// Restituisce "RI", "AL", "DISP", un codice di turno, oppure "N/D" se non si puo' calcolare.
// NON applica la conversione per mansione (vedi turnoEffettivo).
export function calcolaTurnoBase(dStr, cfgData, dati) {
    if (!cfgData || !cfgData.depositoAttivo || !cfgData.riposoStart) return "N/D";
    const rot = (dati && dati.rot) || {};
    const disp = (dati && dati.disp) || {};
    let curr = stringToNum(dStr);
    let isPastUpdate = (cfgData.history && curr < stringToNum(DATA_INIZIO_NUOVI_TURNI));
    let cfgBase = isPastUpdate ? cfgData.history : cfgData;

    if (isGiornoRiposoBase(curr, cfgBase)) {
        let tituloRiposo = 'RI';
        if (cfgBase.riposoStart && cfgBase.depositoAttivo !== 'disp_det') {
            let ref = stringToNum(cfgBase.riposoStart);
            let pos = ((curr - ref + 6) % 15 + 15) % 15;
            if (pos === 13) tituloRiposo = 'AL';
        }
        return tituloRiposo;
    }

    if (cfgBase.depositoAttivo.startsWith('disp_')) return "DISP";
    if (!cfgBase.rotazioneStart) return "N/D";

    let activeCfg = (cfgData.futureConfig && curr >= stringToNum(cfgData.futureConfig.dataInizio))
        ? { start: cfgData.futureConfig.dataInizio, idx: cfgData.futureConfig.turnoIndex, tcPattern: cfgData.futureConfig.tcPattern }
        : { start: cfgBase.rotazioneStart, idx: cfgBase.turnoIndex, tcPattern: cfgBase.tcPattern };

    let refRot = stringToNum(activeCfg.start), w = 0;
    if (curr >= refRot) { for (let j = refRot; j < curr; j++) { if (!isGiornoRiposoBase(j, cfgBase)) w++; } }
    else { for (let j = refRot; j > curr; j--) { if (!isGiornoRiposoBase(j, cfgBase)) w--; } }

    let refRip = stringToNum(cfgBase.riposoStart);
    let startPos = ((refRot - refRip + 6) % 15 + 15) % 15;
    let offset = [1, 3, 5, 8, 10, 12].includes(startPos) ? 1 : 0;

    const rotCorrente = cachePerData(rot, dStr);
    const rotList = (rotCorrente && rotCorrente[cfgBase.depositoAttivo]) ? rotCorrente[cfgBase.depositoAttivo] : [];
    if (rotList.length === 0) return "N/D";

    let t;
    if (cfgBase.depositoAttivo.startsWith('tc_')) {
        let currPos = ((curr - refRip + 6) % 15 + 15) % 15;
        let isBlock2 = (currPos >= 7 && currPos <= 12);
        let k = isBlock2 ? (currPos - 7) : currPos;
        let patternDopoSingolo = activeCfg.tcPattern || cfgBase.tcPattern || 'doppio';
        let isAlternato = (patternDopoSingolo === 'disp') ? isBlock2 : !isBlock2;
        let idx = Math.floor(k / 2);

        if (idx >= rotList.length) idx = rotList.length - 1;
        t = rotList[idx].toUpperCase();

        if (isAlternato) {
            let dispOnEven = (cfgBase.depositoAttivo === 'tc_spez_lido');
            if (dispOnEven && k % 2 === 0) t = "DISP";
            if (!dispOnEven && k % 2 !== 0) t = "DISP";
        }
    } else {
        let expandedRotList = [];
        let originalToExpanded = [];

        for (let j = 0; j < rotList.length; j++) {
            originalToExpanded[j] = expandedRotList.length;
            let currentTurn = rotList[j].toUpperCase();

            if (currentTurn.includes('+')) {
                let parts = currentTurn.split('+');
                expandedRotList.push(parts[0].trim());
                if (parts.length > 1) {
                    expandedRotList.push(parts[1].trim());
                }
            } else {
                expandedRotList.push(currentTurn);
                expandedRotList.push(currentTurn);
            }
        }

        let L_exp = expandedRotList.length;
        let baseExpIdx = originalToExpanded[activeCfg.idx];
        let blockStartIdx = baseExpIdx - (baseExpIdx % 2);
        let idxExp = (blockStartIdx + w + offset) % L_exp;

        if (idxExp < 0) idxExp += L_exp;
        t = expandedRotList[idxExp];
    }

    // Disponibilita' per giorno della settimana (file turni_disp_*.json): il turno diventa DISP in quei giorni
    const regoleDisp = cachePerData(disp, dStr);
    if (regoleDisp) {
        const mapG = ["DOMENICA", "LUNEDI", "MARTEDI", "MERCOLEDI", "GIOVEDI", "VENERDI", "SABATO"];
        const giorno = creaDataSicura(dStr).getDay();
        let nomeG = mapG[giorno];
        let rGiorno = regoleDisp[nomeG] || regoleDisp[nomeG.toLowerCase()] || regoleDisp[nomeG.charAt(0) + nomeG.slice(1).toLowerCase()] || regoleDisp[giorno.toString()];

        if (rGiorno && Array.isArray(rGiorno)) {
            if (rGiorno.map(x => x.toUpperCase()).includes(t)) {
                t = "DISP";
            }
        }
    }
    return t;
}

// Turno che l'utente ha davvero in quel giorno: variazione manuale se c'e', altrimenti il turno di base
// convertito per la mansione. Non considera le ferie (vedi ferieDelGiorno).
export function turnoEffettivo(dStr, state, dati, mansione) {
    const variazione = state && state.variazioni && state.variazioni[dStr];
    if (variazione) return variazione;
    return convertiTurnoPerMansione(calcolaTurnoBase(dStr, state, dati), mansione);
}

// ==========================================
// 4. FERIE DA ROTAZIONE
// ==========================================
function dentroIntervallo(dStr, startStr, endStr, year) {
    let d = new Date(year, parseInt(dStr.split('-')[1]) - 1, parseInt(dStr.split('-')[2]));
    let s = new Date(year, parseInt(startStr.split('-')[0]) - 1, parseInt(startStr.split('-')[1]));
    let e = new Date(year, parseInt(endStr.split('-')[0]) - 1, parseInt(endStr.split('-')[1]));
    return d >= s && d <= e;
}

// "FEP" se il giorno cade in un periodo di ferie previsto dalla rotazione ferie dell'utente, altrimenti null.
//   ferie = { inv: [...], est: [...] } come restituito da caricaDatiTurni().ferie
export function ferieDelGiorno(state, dStr, ferie) {
    if (!state || !state.ferie || !state.ferie.baseAnno) return null;
    const ROT_INV = (ferie && ferie.inv) || [];
    const ROT_EST = (ferie && ferie.est) || [];
    let year = parseInt(dStr.split('-')[0]);
    let r = [];

    let iEst = state.ferie.baseEstiva;
    if (iEst !== -1 && iEst !== null && iEst !== undefined && ROT_EST.length > 0) {
        let idxEst = (iEst + (year - state.ferie.baseAnno)) % ROT_EST.length;
        if (idxEst < 0) idxEst += ROT_EST.length;

        if (state.ferie.scambi && state.ferie.scambi[year] && state.ferie.scambi[year].estiva !== undefined) {
            idxEst = state.ferie.scambi[year].estiva;
        }
        let pEst = ROT_EST[idxEst];
        if (pEst && dentroIntervallo(dStr, pEst.s, pEst.e, year)) r.push("FEP");
    }

    let iInv = state.ferie.baseInvernale;
    if (iInv !== -1 && iInv !== null && iInv !== undefined && ROT_INV.length > 0) {
        let idxInv = (iInv + (year - state.ferie.baseAnno)) % ROT_INV.length;
        if (idxInv < 0) idxInv += ROT_INV.length;

        if (state.ferie.scambi && state.ferie.scambi[year] && state.ferie.scambi[year].invernale !== undefined) {
            idxInv = state.ferie.scambi[year].invernale;
        }
        let pInv = ROT_INV[idxInv];
        if (pInv && dentroIntervallo(dStr, pInv.s, pInv.e, year)) r.push("FEP");
    }

    let uniqueR = [...new Set(r)];
    return uniqueR.length > 0 ? uniqueR.join(" + ") : null;
}

// ==========================================
// 5. CARICAMENTO DATI (una sola volta, condiviso)
// ==========================================
let _promessaDati = null;

// Scarica una volta sola (anche se chiamata da piu' moduli contemporaneamente) tutti i file dell'albero:
//   { albero, rot, disp, db, varianti, ferie: { versione, inv, est }, incompleto }
// rot/disp/db sono indicizzati per data di inizio del file ("2026-10-01").
// Se qualche file non si scarica, "incompleto" e' true e alla chiamata successiva si riprova.
// Con forza = true si riscarica tutto.
export function caricaDatiTurni({ forza = false } = {}) {
    if (_promessaDati && !forza) return _promessaDati;
    const p = _scarica().then((dati) => {
        if (dati.incompleto && _promessaDati === p) _promessaDati = null;
        return dati;
    }, (e) => {
        if (_promessaDati === p) _promessaDati = null;
        throw e;
    });
    _promessaDati = p;
    return p;
}

async function _scarica() {
    const nocache = "?v=" + Date.now();
    const resMappa = await fetch("mappa_file.json" + nocache);
    if (!resMappa.ok) throw new Error("mappa_file.json non disponibile");
    const mappa = await resMappa.json();
    const albero = mappa.albero || [];

    const dati = { albero, rot: {}, disp: {}, db: {}, varianti: {}, ferie: { versione: null, inv: [], est: [] }, incompleto: false };
    const lavori = [];
    const scarica = (file, dest) => lavori.push(
        fetch(file + nocache)
            .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
            .then(dest)
            .catch((e) => { dati.incompleto = true; console.error("Errore caricamento " + file, e); })
    );

    if (albero.includes("rotazione_ferie.json")) {
        scarica("rotazione_ferie.json", (f) => {
            if (f.versione) dati.ferie.versione = f.versione;
            dati.ferie.inv = f.invernali || [];
            dati.ferie.est = f.estive || [];
        });
    }
    if (albero.includes("presenza_varianti.json")) {
        scarica("presenza_varianti.json", (v) => { dati.varianti = v || {}; });
    }
    for (const file of albero) {
        const data = estraiDataDaNome(file);
        if (!data) continue;
        if (file.startsWith("info_turni_")) scarica(file, (d) => { dati.db[data] = d; });
        else if (file.startsWith("rotazioni_")) scarica(file, (d) => { dati.rot[data] = d; });
        else if (file.startsWith("turni_disp_")) scarica(file, (d) => { dati.disp[data] = d; });
    }
    await Promise.all(lavori);
    return dati;
}

// Il giorno ha varianti di servizio? (true anche se l'elenco delle linee e' vuoto: vuol dire "verificare le DDS")
export function haVarianti(dati, dStr) {
    return !!(dati && dati.varianti && dati.varianti[dStr]);
}
