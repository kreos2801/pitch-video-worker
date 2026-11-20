/**
 * Utilitaires : accès Sheet, journalisation CONFIG_LOG, texte, JSON.
 */

/** Classeur « Tour de contrôle » (fonctionne aussi depuis la web app, où il n'y a pas de classeur actif). */
function ss_() {
  var active = null;
  try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { active = null; }
  if (active) return active;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID inconnu : lancez « Initialiser la Tour de contrôle » depuis la Sheet.');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Onglet introuvable : ' + name + ' (lancez « Initialiser la Tour de contrôle »).');
  return sh;
}

/** Écrit une ligne dans CONFIG_LOG (et dans les logs Apps Script). Ne lève jamais d'exception. */
function log_(level, step, message) {
  var msg = String(message == null ? '' : message);
  if (msg.length > 45000) msg = msg.slice(0, 45000) + '…';
  try { console.log('[' + level + '] ' + step + ' — ' + msg); } catch (e) { /* hors GAS */ }
  try {
    var sh = sheet_(APP.SHEETS.LOG);
    sh.appendRow([new Date(), level, step, msg]);
  } catch (e) { /* journalisation best-effort */ }
}

/** Retourne { headers, map(nom → index 0-based) } de l'onglet PRODUCTION. */
function prodHeaderMap_() {
  var sh = sheet_(APP.SHEETS.PROD);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var map = {};
  headers.forEach(function (h, i) { map[String(h).trim()] = i; });
  return { sheet: sh, headers: headers, map: map };
}

/** Lit une ligne de PRODUCTION sous forme d'objet { colonne: valeur }. */
function readRow_(rowIndex) {
  var hm = prodHeaderMap_();
  var values = hm.sheet.getRange(rowIndex, 1, 1, hm.headers.length).getValues()[0];
  var obj = { _row: rowIndex };
  hm.headers.forEach(function (h, i) { obj[String(h).trim()] = values[i]; });
  return obj;
}

/** Met à jour certaines colonnes d'une ligne (par nom de colonne). */
function updateRow_(rowIndex, patch) {
  var hm = prodHeaderMap_();
  Object.keys(patch).forEach(function (k) {
    var idx = hm.map[k];
    if (idx === undefined) return;
    var v = patch[k];
    if (typeof v === 'string' && v.length > 49000) v = v.slice(0, 49000) + '…';
    hm.sheet.getRange(rowIndex, idx + 1).setValue(v);
  });
  SpreadsheetApp.flush();
}

/** Trouve le numéro de ligne d'un ID_Execution (ou -1). */
function findRowById_(id) {
  var hm = prodHeaderMap_();
  var last = hm.sheet.getLastRow();
  if (last < 2) return -1;
  var col = hm.map['ID_Execution'] + 1;
  var ids = hm.sheet.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) return i + 2;
  }
  return -1;
}

function setStatus_(rowIndex, status, step) {
  var patch = { 'Statut_Traitement': status };
  if (step) patch['Derniere_Etape'] = step;
  updateRow_(rowIndex, patch);
}

/** Génère un identifiant d'exécution lisible : EXE-20261120-153012-4F2A */
function newExecutionId_() {
  var d = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyyMMdd-HHmmss');
  var rnd = Utilities.getUuid().replace(/-/g, '').slice(0, 4).toUpperCase();
  return 'EXE-' + d + '-' + rnd;
}

/** Extrait l'ID Drive d'une URL (fichier, Doc, dossier) ou renvoie la chaîne si c'est déjà un ID. */
function extractDriveId_(url) {
  if (!url) return '';
  var s = String(url).trim();
  var m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/) ||
          s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/) ||
          s.match(/\/folders\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  return '';
}

/** Normalisation pour comparaisons : minuscules, sans accents, ponctuation → espace. */
function normalizeText_(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nombre de mots « parlés » (les jetons sans lettre ni chiffre, ex. « % » ou « — », ne comptent pas). */
function countWords_(text) {
  return String(text || '').split(/\s+/).filter(function (t) { return /[A-Za-zÀ-ÿ0-9]/.test(t); }).length;
}

/**
 * Extrait les nombres d'un texte, normalisés : « 2 000 » → « 2000 », « 3,5 » → « 3.5 ».
 * Sert au contrôle anti-hallucination : tout chiffre du script doit exister dans les sources.
 */
function extractNumbers_(text) {
  var s = String(text || '');
  var re = /\d+(?:[   ]\d{3})*(?:[.,]\d+)?/g;
  var out = [];
  var m;
  while ((m = re.exec(s)) !== null) {
    out.push(m[0].replace(/[   ]/g, '').replace(',', '.'));
  }
  return out;
}

/** Remplace les {{VARIABLES}} d'un template. Les variables inconnues sont laissées vides. */
function fillTemplate_(tpl, vars) {
  return String(tpl || '').replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, function (_, k) {
    return vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : '';
  });
}

/** Parse un JSON renvoyé par un LLM (tolère ```json … ``` et du texte autour). */
function parseJsonLoose_(text) {
  var s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch (e) { /* on tente l'extraction du premier objet */ }
  var start = s.indexOf('{');
  var end = s.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
  throw new Error('Réponse non JSON : ' + s.slice(0, 200));
}

function truncate_(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '\n[… document tronqué …]' : s;
}

/** Comparaison en temps constant (jeton du worker). */
function safeEquals_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || !b || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function driveFileUrl_(id) { return 'https://drive.google.com/file/d/' + id + '/view'; }
