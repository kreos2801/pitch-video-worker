/**
 * ORCHESTRATION — d'une ligne PRODUCTION à la demande de rendu vidéo.
 *
 *  1/5 Extraction PDF (+ pseudonymisation Option A)
 *  2/5 Script IA (Gemini, JSON strict) + contrôle des faits
 *  3/5 Diapositives Google Slides + export PNG
 *  4/5 Rendu vidéo : déclenchement du worker (GitHub Actions) via l'API REST GitHub
 *  5/5 Publication : le worker renvoie le MP4 à la web app (08_Delivery.gs)
 *
 * Points d'entrée (menu / déclencheurs) : fonctions SANS « _ » final.
 */

/** Menu : traite les lignes sélectionnées. */
function runSelectedRows() {
  var sh = sheet_(APP.SHEETS.PROD);
  var range = sh.getActiveRange();
  if (!range || range.getSheet().getName() !== APP.SHEETS.PROD) {
    SpreadsheetApp.getUi().alert('Sélectionnez une ou plusieurs lignes dans l\'onglet PRODUCTION.');
    return;
  }
  var start = Date.now();
  for (var r = Math.max(2, range.getRow()); r <= range.getLastRow(); r++) {
    if (Date.now() - start > APP.MAX_RUN_MS - 90000) { log_('WARN', 'PIPELINE', 'Budget de temps atteint : relancez pour les lignes restantes.'); break; }
    processRow_(r, {});
  }
  ss_().toast('Traitement lancé. Le lien vidéo apparaîtra dans URL_Video_Cloud (~2 min).', APP.NAME, 8);
}

/** Menu : reprise après validation humaine (Script_JSON corrigé à la main, sans rappel de l'IA). */
function resumeSelectedFromScript() {
  var range = sheet_(APP.SHEETS.PROD).getActiveRange();
  for (var r = Math.max(2, range.getRow()); r <= range.getLastRow(); r++) processRow_(r, { fromScript: true });
}

/** Menu : relance uniquement le rendu vidéo (diapositives déjà générées). */
function redispatchSelected() {
  var range = sheet_(APP.SHEETS.PROD).getActiveRange();
  var cfg = getConfig_();
  for (var r = Math.max(2, range.getRow()); r <= range.getLastRow(); r++) {
    var id = String(readRow_(r)['ID_Execution'] || '').trim();
    if (!id || !getJobMeta_(id).manifestId) { log_('WARN', 'RENDU', 'Ligne ' + r + ' : aucun job prêt à rendre'); continue; }
    setStatus_(r, APP.STATUS.RENDU_ATTENTE, '4/5 Rendu vidéo relancé');
    dispatchWorker_(id, cfg);
  }
}

/** Menu + déclencheur : traite toutes les lignes « à traiter » (statut vide ou A_TRAITER, 3 URL renseignées). */
function runPendingRows() {
  var start = Date.now();
  var hm = prodHeaderMap_();
  var last = hm.sheet.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (Date.now() - start > APP.MAX_RUN_MS - 90000) break;
    var row = readRow_(r);
    var st = String(row['Statut_Traitement'] || '').trim();
    var ready = row['URL_PDF_1'] && row['URL_PDF_2_ou_Portfolio'] && row['URL_Brief_ou_Offre'] && row['Option_Choisie'];
    if (ready && (st === '' || st === APP.STATUS.A_TRAITER)) processRow_(r, {});
  }
}

/** Déclencheur temporel (mode automatique) : nouvelles lignes + chien de garde. */
function autoTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;          // une exécution est déjà en cours
  try {
    watchdog_();
    runPendingRows();
  } finally { lock.releaseLock(); }
}

/** Traite une ligne de bout en bout jusqu'au déclenchement du rendu. */
function processRow_(rowIndex, opts) {
  opts = opts || {};
  var cfg = getConfig_();
  var row = readRow_(rowIndex);
  var id = String(row['ID_Execution'] || '').trim();
  if (!id) { id = newExecutionId_(); updateRow_(rowIndex, { 'ID_Execution': id }); }
  var option = String(row['Option_Choisie'] || '').trim().toUpperCase();
  var t0 = Date.now();

  try {
    if (option !== 'A' && option !== 'B') throw new Error('Option_Choisie doit valoir A ou B');
    ['URL_PDF_1', 'URL_PDF_2_ou_Portfolio', 'URL_Brief_ou_Offre'].forEach(function (c) {
      if (!String(row[c] || '').trim()) throw new Error('Colonne ' + c + ' vide');
    });
    log_('INFO', 'PIPELINE', id + ' : démarrage (Option ' + option + (opts.fromScript ? ', reprise depuis Script_JSON' : '') + ')');
    var folder = jobFolder_(id, cfg);

    // 1/5 — Extraction
    setStatus_(rowIndex, APP.STATUS.EXTRACTION, '1/5 Extraction des documents');
    var ex = extractAllDocs_(row);

    // 2/5 — Script
    var script, validation;
    if (opts.fromScript) {
      validation = validateScript_(parseJsonLoose_(row['Script_JSON']), ex.corpus, option, ex.maskedNames, extraConstants_(cfg));
      script = validation.script;
    } else {
      setStatus_(rowIndex, APP.STATUS.SCRIPT, '2/5 Script IA + contrôle des faits');
      var gen = generateScript_(option, ex, cfg);
      script = gen.script;
      validation = gen.validation;
      updateRow_(rowIndex, { 'Cout_Estime_USD': Math.round(gen.costUsd * 100000) / 100000 });
      log_('INFO', 'SCRIPT_IA', id + ' : modèle ' + gen.model + ', coût LLM estimé ' + gen.costUsd.toFixed(5) + ' USD');
    }
    updateRow_(rowIndex, {
      'Script_JSON': JSON.stringify(script, null, 1),
      'Nb_Mots_VoixOff': validation.stats.words,
      'Controle_Faits': validation.summary + (validation.errors.length ? '\nErreurs : ' + validation.errors.join(' ; ') : '') +
        (validation.warnings.length ? '\nAvertissements : ' + validation.warnings.join(' ; ') : '')
    });
    if (!validation.ok && cfg.strictFacts) {
      setStatus_(rowIndex, APP.STATUS.A_VERIFIER, 'Contrôle des faits en échec : corrigez Script_JSON puis « Reprendre après validation »');
      log_('ERROR', 'CONTROLE_FAITS', id + ' : rendu bloqué (mode strict). ' + validation.errors.join(' ; '));
      return;
    }
    if (script.email_destinataire && !String(row['Email_Destinataire'] || '').trim()) {
      updateRow_(rowIndex, { 'Email_Destinataire': script.email_destinataire });
    }

    // 3/5 — Visuels
    setStatus_(rowIndex, APP.STATUS.VISUELS, '3/5 Diapositives Google Slides');
    var deck = buildDeck_(id, option, script, folder, cfg);
    var pngs = exportSlidePngs_(deck, folder);
    updateRow_(rowIndex, { 'URL_Slides': deck.url });
    log_('INFO', 'VISUELS', id + ' : ' + pngs.length + ' diapositives exportées en PNG');

    // 4/5 — Manifeste + déclenchement du rendu
    var manifest = buildManifest_(id, option, script, pngs, cfg);
    var mf = folder.createFile(Utilities.newBlob(JSON.stringify(manifest, null, 2), 'application/json', 'job.json'));
    setJobMeta_(id, { folderId: folder.getId(), manifestId: mf.getId(), dispatchedAt: Date.now() });
    setStatus_(rowIndex, APP.STATUS.RENDU_ATTENTE, '4/5 Rendu vidéo (TTS + montage)');
    dispatchWorker_(id, cfg);
    log_('INFO', 'PIPELINE', id + ' : étapes 1-4 terminées en ' + Math.round((Date.now() - t0) / 1000) + ' s');
  } catch (e) {
    setStatus_(rowIndex, APP.STATUS.ERREUR, 'Erreur : ' + e.message);
    log_('ERROR', 'PIPELINE', id + ' : ' + e.message + (e.stack ? '\n' + e.stack : ''));
  }
}

/** Contrat d'interface avec le worker de rendu (lu par worker/render.py). */
function buildManifest_(id, option, script, pngs, cfg) {
  var byScene = {};
  pngs.forEach(function (p) { byScene[p.scene_id] = p.fileId; });
  var theme = APP.THEMES[option];
  return {
    schema: 'pitch-video/1',
    id: id,
    option: option,
    created_at: new Date().toISOString(),
    titre_video: script.titre_video,
    voice: option === 'A' ? cfg.voiceA : cfg.voiceB,
    target_seconds: APP.TARGET_SECONDS,
    disclosure: 'Voix de synthèse',
    theme: { accent: theme.accent, bg: theme.bg, text: theme.text },
    scenes: script.scenes.map(function (sc) {
      return {
        scene_id: sc.scene_id, type: sc.type, titre_ecran: sc.titre_ecran,
        mots_cles_ecran: sc.mots_cles_ecran, texte_voix_off: sc.texte_voix_off,
        slide_file_id: byScene[sc.scene_id]
      };
    })
  };
}

/** Déclenche le workflow GitHub Actions « render.yml » (API REST, workflow_dispatch). */
function dispatchWorker_(id, cfg) {
  if (!cfg.githubRepo || !cfg.githubToken) {
    log_('INFO', 'RENDU', id + ' : GitHub non configuré → en attente d\'un worker en mode polling (Colab / local)');
    return;
  }
  var url = 'https://api.github.com/repos/' + cfg.githubRepo + '/actions/workflows/' +
    encodeURIComponent(cfg.githubWorkflow) + '/dispatches';
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + cfg.githubToken,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    payload: JSON.stringify({ ref: cfg.githubRef, inputs: { job_id: id } }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code !== 204) throw new Error('Déclenchement GitHub Actions refusé (HTTP ' + code + ') : ' + resp.getContentText().slice(0, 300));
  log_('INFO', 'RENDU', id + ' : workflow GitHub Actions déclenché (' + cfg.githubRepo + ')');
}

/** Lignes bloquées en rendu depuis trop longtemps → ERREUR (le worker n'a pas répondu). */
function watchdog_() {
  var hm = prodHeaderMap_();
  var last = hm.sheet.getLastRow();
  for (var r = 2; r <= last; r++) {
    var row = readRow_(r);
    var st = row['Statut_Traitement'];
    if (st !== APP.STATUS.RENDU_ATTENTE && st !== APP.STATUS.RENDU) continue;
    var meta = getJobMeta_(String(row['ID_Execution']));
    if (meta.dispatchedAt && Date.now() - meta.dispatchedAt > APP.WORKER_TIMEOUT_MIN * 60000) {
      setStatus_(r, APP.STATUS.ERREUR, 'Le worker n\'a pas répondu en ' + APP.WORKER_TIMEOUT_MIN + ' min (menu : Relancer le rendu)');
      log_('ERROR', 'RENDU', row['ID_Execution'] + ' : délai du worker dépassé');
    }
  }
}

// ------------------------------------------------------------ dossiers & métadonnées de job

function outputRoot_(cfg) {
  if (cfg.outputFolderId) {
    try { return DriveApp.getFolderById(cfg.outputFolderId); } catch (e) { /* recréé ci-dessous */ }
  }
  var f = DriveApp.createFolder('Pitch Vidéo — Sorties');
  PropertiesService.getScriptProperties().setProperty('OUTPUT_FOLDER_ID', f.getId());
  return f;
}

function jobFolder_(id, cfg) {
  var meta = getJobMeta_(id);
  if (meta.folderId) { try { return DriveApp.getFolderById(meta.folderId); } catch (e) { /* recréé */ } }
  var f = outputRoot_(cfg).createFolder(id);
  setJobMeta_(id, { folderId: f.getId() });
  return f;
}

function getJobMeta_(id) {
  var raw = PropertiesService.getScriptProperties().getProperty('JOB_' + id);
  return raw ? JSON.parse(raw) : {};
}

function setJobMeta_(id, patch) {
  var cur = getJobMeta_(id);
  Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
  PropertiesService.getScriptProperties().setProperty('JOB_' + id, JSON.stringify(cur));
}
