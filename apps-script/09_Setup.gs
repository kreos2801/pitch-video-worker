/**
 * Mise en place : menu, création des 3 onglets, prompts par défaut, configuration
 * des secrets, tests de connexion, mode automatique, import des exemples.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🎬 Pitch Vidéo')
    .addItem('▶ Lancer les lignes sélectionnées', 'runSelectedRows')
    .addItem('▶ Lancer toutes les lignes à traiter', 'runPendingRows')
    .addItem('↻ Reprendre après validation humaine (Script_JSON)', 'resumeSelectedFromScript')
    .addItem('↻ Relancer uniquement le rendu vidéo', 'redispatchSelected')
    .addSeparator()
    .addItem('⏱ Activer le mode automatique (toutes les 5 min)', 'enableAutoMode')
    .addItem('⏹ Désactiver le mode automatique', 'disableAutoMode')
    .addSeparator()
    .addItem('📥 Importer les exemples depuis un dossier Drive', 'importExamples')
    .addItem('⚙ Configurer (clés, Calendly, GitHub)', 'configure')
    .addItem('🔑 Afficher les secrets à copier dans GitHub', 'showWorkerSecrets')
    .addItem('🧪 Tester les connexions', 'testConnections')
    .addItem('🧱 Initialiser la Tour de contrôle', 'setupControlTower')
    .addToUi();
}

/** Crée / répare les 3 onglets imposés et les paramètres internes. Idempotent. */
function setupControlTower() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  if (!props.getProperty('WORKER_TOKEN')) {
    props.setProperty('WORKER_TOKEN', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  }

  var prod = ensureSheet_(ss, APP.SHEETS.PROD, APP.PROD_HEADERS, '#1F4E79');
  var prompts = ensureSheet_(ss, APP.SHEETS.PROMPTS, APP.PROMPT_HEADERS, '#5B2C6F');
  ensureSheet_(ss, APP.SHEETS.LOG, APP.LOG_HEADERS, '#424242');

  // Onglet par défaut vide (« Feuille 1 ») supprimé s'il existe
  ss.getSheets().forEach(function (s) {
    if (Object.keys(APP.SHEETS).map(function (k) { return APP.SHEETS[k]; }).indexOf(s.getName()) < 0 &&
        s.getLastRow() === 0 && ss.getSheets().length > 3) ss.deleteSheet(s);
  });

  // PRODUCTION : validations, largeurs, couleurs de statut
  var optRule = SpreadsheetApp.newDataValidation().requireValueInList(['A', 'B'], true).build();
  prod.getRange('B2:B1000').setDataValidation(optRule);
  var st = Object.keys(APP.STATUS).map(function (k) { return APP.STATUS[k]; });
  prod.getRange('F2:F1000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(st, true).setAllowInvalid(true).build());
  [190, 70, 220, 220, 220, 150, 90, 260, 140, 300, 80, 320, 220, 200, 260, 260, 200, 90]
    .forEach(function (w, i) { prod.setColumnWidth(i + 1, w); });
  prod.getRange('J2:P1000').setWrap(false);
  var rng = prod.getRange('F2:F1000');
  prod.setConditionalFormatRules([
    cf_(rng, APP.STATUS.TERMINE, '#D9F2E3'), cf_(rng, APP.STATUS.ERREUR, '#F8D7DA'),
    cf_(rng, APP.STATUS.A_VERIFIER, '#FFE8CC'), cf_(rng, APP.STATUS.RENDU, '#DCEBFA'),
    cf_(rng, APP.STATUS.RENDU_ATTENTE, '#DCEBFA')
  ]);

  // PROMPTS : prompts par défaut (non écrasés s'ils existent déjà)
  if (prompts.getLastRow() < 2) {
    defaultPrompts_().forEach(function (p) { prompts.appendRow(p); });
    prompts.setColumnWidths(1, 1, 120).setColumnWidth(2, 380).setColumnWidth(3, 700);
    prompts.getRange('B2:C10').setWrap(true).setVerticalAlignment('top');
  }
  outputRoot_(getConfig_());
  log_('INFO', 'SETUP', 'Tour de contrôle initialisée (v' + APP.VERSION + ')');
  SpreadsheetApp.getUi().alert('Tour de contrôle prête.\n\nÉtapes suivantes :\n1. ⚙ Configurer (clé Gemini…)\n' +
    '2. Déployer la web app (Déployer › Nouveau déploiement › Application Web)\n3. 🔑 Copier les secrets dans GitHub\n' +
    '4. 📥 Importer les exemples puis ▶ Lancer.');
}

function ensureSheet_(ss, name, headers, color) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var current = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  headers.forEach(function (h, i) { if (current[i] !== h) sh.getRange(1, i + 1).setValue(h); });
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(color);
  sh.setFrozenRows(1);
  return sh;
}

function cf_(range, text, color) {
  return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(color).setRanges([range]).build();
}

/** Prompts par défaut (modifiables dans l'onglet PROMPTS). */
function defaultPrompts_() {
  var sysCommon =
    'Tu es scénariste de vidéos courtes (45 à 60 secondes) ET vérificateur de faits.\n' +
    'RÈGLE ABSOLUE : tu utilises EXCLUSIVEMENT les faits présents dans les documents fournis. ' +
    'Tu n\'inventes aucun chiffre, aucune expérience, aucun diplôme, aucune certification, aucun nom d\'entreprise ou de client. ' +
    'Si une information manque, tu l\'omets. Tu recopies les chiffres exactement comme dans les documents.\n' +
    'Tu écris pour l\'oral : phrases courtes, rythme dynamique, aucune liste, aucun sigle non prononçable sans le développer une fois.\n' +
    'Tu réponds UNIQUEMENT par un objet JSON valide conforme au format demandé.';

  var format =
    '\nFORMAT JSON ATTENDU\n' +
    '{ "titre_video": "…", "nom_affiche": "…", "destinataire": "…", "email_destinataire": "…",\n' +
    '  "scenes": [ { "scene_id": 1, "type": "intro|profil|competences|preuve|adequation|cta", "titre_ecran": "…",\n' +
    '                "mots_cles_ecran": ["…"], "texte_voix_off": "…", "chiffre_cle": {"valeur": "…", "libelle": "…"}, "sources": ["…"] } ],\n' +
    '  "adequation": [ { "exigence": "…", "couvert_par": ["…"], "preuve": "…" } ],\n' +
    '  "email": { "objet": "…", "corps": "…" } }\n';

  var rulesCommon =
    '- {{SCENES_MIN}} à {{SCENES_MAX}} scènes. Première scène de type intro, dernière de type cta, une scène de type adequation avant la cta.\n' +
    '- Voix-off : entre {{MOTS_MIN}} et {{MOTS_MAX}} mots AU TOTAL (toutes scènes cumulées), soit 45 à 60 secondes. Compte tes mots.\n' +
    '- titre_ecran : {{TITRE_MAX}} caractères maximum. mots_cles_ecran : 2 à 4 éléments de {{MOT_CLE_MAX}} caractères maximum.\n' +
    '- chiffre_cle : un seul chiffre marquant tiré des documents pour les scènes profil/preuve (sinon valeur vide).\n' +
    '- sources : pour chaque scène hors intro et cta, 1 à 3 extraits COPIÉS MOT POUR MOT depuis les documents (20 mots maximum chacun) ' +
    'qui prouvent ce que dit la voix-off.\n' +
    '- adequation : 4 à 5 exigences clés du besoin ; preuve = extrait mot pour mot des documents (vide si non couverte).\n' +
    '- N\'annonce jamais « 100 % » si une exigence de la liste adequation n\'est pas couverte.\n' +
    '- La scène cta invite à prendre rendez-vous{{CTA_DETAIL}}.\n' +
    '- email : objet (80 caractères maximum) et corps (3 à 5 phrases, vouvoiement) pour accompagner la vidéo, mêmes règles de véracité.\n' +
    '- email_destinataire : adresse e-mail de contact présente dans le brief/l\'offre, sinon chaîne vide.\n';

  var tplB =
    'OBJECTIF : script de vidéo de candidature « Candidat augmenté » (personal branding) qui démontre l\'adéquation ' +
    'entre le profil du candidat, ses réalisations et les enjeux du poste.\n\n' +
    'CONTRAINTES\n' + rulesCommon +
    '- Voix-off à la première personne du singulier (« je »), ton enthousiaste mais sobre.\n' +
    '- nom_affiche : prénom et nom du candidat tels qu\'écrits dans le CV. destinataire : entreprise et intitulé du poste.\n' +
    '- adequation.couvert_par : ["CANDIDAT"] si couverte, [] sinon.\n' + format +
    '\nDOCUMENT 1 — CV DU CANDIDAT\n<<<\n{{DOC_1}}\n>>>\n' +
    '\nDOCUMENT 2 — PORTFOLIO / LETTRE\n<<<\n{{DOC_2}}\n>>>\n' +
    '\nDOCUMENT 3 — FICHE DE POSTE\n<<<\n{{DOC_3}}\n>>>\n';

  var tplA =
    'OBJECTIF : script de vidéo de pitch d\'équipe pour un directeur technique client. Angle « matching » : ' +
    'montrer la complémentarité des deux consultants pour couvrir le besoin du brief.\n\n' +
    'CONTRAINTES\n' + rulesCommon +
    '- Voix-off au nom de l\'ESN « {{NOM_ESN}} » (« nous »), ton corporate moderne et factuel.\n' +
    '- Les consultants sont anonymisés : appelle-les uniquement « Consultant 1 » et « Consultant 2 » (jamais de nom propre de personne).\n' +
    '- Une scène par consultant (type profil) puis une scène de complémentarité (type competences).\n' +
    '- nom_affiche : « {{NOM_ESN}} ». destinataire : nom du client et du projet tels qu\'écrits dans le brief.\n' +
    '- adequation.couvert_par : ["C1"], ["C2"], ["C1","C2"] ou [] ; la preuve vient du CV du consultant concerné.\n' + format +
    '\nDOCUMENT 1 — CV CONSULTANT 1 (anonymisé)\n<<<\n{{DOC_1}}\n>>>\n' +
    '\nDOCUMENT 2 — CV CONSULTANT 2 (anonymisé)\n<<<\n{{DOC_2}}\n>>>\n' +
    '\nDOCUMENT 3 — BRIEF TECHNIQUE CLIENT\n<<<\n{{DOC_3}}\n>>>\n';

  return [
    ['SCRIPT_A', sysCommon, tplA, 0.4, APP.DEFAULT_MODEL],
    ['SCRIPT_B', sysCommon, tplB, 0.5, APP.DEFAULT_MODEL]
  ];
}

/** Saisie guidée des paramètres (stockés dans les Propriétés du script, jamais dans la Sheet). */
function configure() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var fields = [
    ['GEMINI_API_KEY', 'Clé API Gemini (Google AI Studio)', true],
    ['GITHUB_REPO', 'Dépôt GitHub du worker (ex. yann/pitch-video-worker)', false],
    ['GITHUB_TOKEN', 'Jeton GitHub fine-grained (permission Actions : Read and write sur ce dépôt)', true],
    ['CALENDLY_URL', 'Lien de prise de rendez-vous (Calendly / Google Agenda) — optionnel', false],
    ['ESN_NAME', 'Nom de l\'ESN (Option A)', false],
    ['SENDER_NAME', 'Signature des e-mails (prénom nom)', false],
    ['CONTACT_EMAIL', 'E-mail de contact affiché en fin de vidéo', false],
    ['TTS_VOICE_A', 'Voix de synthèse Option A (défaut ' + APP.TTS_VOICES.A + ')', false],
    ['TTS_VOICE_B', 'Voix de synthèse Option B (défaut ' + APP.TTS_VOICES.B + ')', false],
    ['STRICT_FACTS', 'Mode strict : bloquer le rendu si le contrôle des faits échoue (true/false)', false],
    ['CREATE_GMAIL_DRAFT', 'Créer un brouillon Gmail à la fin (true/false)', false]
  ];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var cur = props.getProperty(f[0]) || '';
    var shown = f[2] ? (cur ? '•••• ' + cur.slice(-4) : '(vide)') : (cur || '(vide)');
    var r = ui.prompt('Configurer ' + (i + 1) + '/' + fields.length, f[1] + '\nActuel : ' + shown + '\n\nLaisser vide pour conserver.', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) break;
    var v = r.getResponseText().trim();
    if (v) props.setProperty(f[0], v);
  }
  log_('INFO', 'CONFIG', 'Configuration mise à jour (valeurs secrètes non journalisées)');
}

/** Affiche l'URL de la web app et le jeton à copier en secrets GitHub (WEBAPP_URL, WORKER_TOKEN). */
function showWorkerSecrets() {
  var url = ScriptApp.getService().getUrl();
  var token = PropertiesService.getScriptProperties().getProperty('WORKER_TOKEN');
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;font-size:13px">' +
    '<p>Dans GitHub › Settings › Secrets and variables › Actions, créez :</p>' +
    '<p><b>WEBAPP_URL</b><br><textarea style="width:100%" rows="3" readonly>' + (url || 'Web app non déployée : Déployer › Nouveau déploiement › Application Web') + '</textarea></p>' +
    '<p><b>WORKER_TOKEN</b><br><textarea style="width:100%" rows="2" readonly>' + token + '</textarea></p>' +
    '<p>L\'URL doit se terminer par <b>/exec</b>. Si elle se termine par /dev, copiez plutôt celle de ' +
    'Déployer › Gérer les déploiements.</p>' +
    '<p style="color:#a00">Ne partagez jamais ce jeton (il donne accès aux jobs de rendu).</p></div>'
  ).setWidth(520).setHeight(330);
  SpreadsheetApp.getUi().showModalDialog(html, 'Secrets du worker');
}

function testConnections() {
  var cfg = getConfig_();
  var lines = [];
  try {
    var r = callGemini_({ user: 'Réponds exactement : OK', temperature: 0, json: false });
    lines.push('✅ Gemini (' + r.model + ') : ' + r.text.trim().slice(0, 20));
  } catch (e) { lines.push('❌ Gemini : ' + e.message); }

  if (cfg.githubRepo && cfg.githubToken) {
    var resp = UrlFetchApp.fetch('https://api.github.com/repos/' + cfg.githubRepo + '/actions/workflows/' + cfg.githubWorkflow, {
      headers: { Authorization: 'Bearer ' + cfg.githubToken, Accept: 'application/vnd.github+json' }, muteHttpExceptions: true });
    lines.push(resp.getResponseCode() === 200 ? '✅ GitHub : workflow ' + cfg.githubWorkflow + ' trouvé'
      : '❌ GitHub HTTP ' + resp.getResponseCode() + ' (dépôt, jeton ou fichier .github/workflows/' + cfg.githubWorkflow + ' ?)');
  } else lines.push('ℹ️ GitHub non configuré : utilisez le worker en mode polling (Colab).');

  var url = ScriptApp.getService().getUrl();
  lines.push(url ? '✅ Web app déployée' : '❌ Web app non déployée');
  lines.push(cfg.calendlyUrl ? '✅ Lien de rendez-vous : ' + cfg.calendlyUrl : 'ℹ️ Pas de lien de rendez-vous (l\'e-mail de contact sera affiché)');
  log_('INFO', 'TEST', lines.join(' | '));
  SpreadsheetApp.getUi().alert(lines.join('\n'));
}

function enableAutoMode() {
  disableAutoMode();
  ScriptApp.newTrigger('autoTick').timeBased().everyMinutes(5).create();
  log_('INFO', 'CONFIG', 'Mode automatique activé (toutes les 5 min)');
  ss_().toast('Mode automatique activé : toute ligne complète au statut A_TRAITER sera traitée sous 5 min.', APP.NAME, 8);
}

function disableAutoMode() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'autoTick') ScriptApp.deleteTrigger(t);
  });
}

/**
 * Ajoute 3 lignes d'exemple à partir d'un dossier Drive contenant les PDF de /samples :
 * Option A, Option B, et Option A avec le brief SCANNÉ (démonstration du fallback OCR).
 */
function importExamples() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Importer les exemples', 'URL du dossier Drive contenant les PDF d\'exemple (dossiers option_A et option_B, ou tout à plat) :', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var folder = DriveApp.getFolderById(extractDriveId_(r.getResponseText()));
  var files = {};
  (function walk(f) {
    var it = f.getFiles();
    while (it.hasNext()) { var x = it.next(); files[x.getName().replace(/\.pdf$/i, '')] = x.getUrl(); }
    var sub = f.getFolders();
    while (sub.hasNext()) walk(sub.next());
  })(folder);

  var need = ['A_CV_consultant_1', 'A_CV_consultant_2', 'A_Brief_client_Valmora', 'B_CV_candidat', 'B_Portfolio_lettre', 'B_Offre_Orvane'];
  var missing = need.filter(function (n) { return !files[n]; });
  if (missing.length) { ui.alert('Fichiers introuvables : ' + missing.join(', ')); return; }

  var sh = sheet_(APP.SHEETS.PROD);
  var blank = APP.PROD_HEADERS.slice(5).map(function () { return ''; });
  sh.appendRow(['', 'A', files.A_CV_consultant_1, files.A_CV_consultant_2, files.A_Brief_client_Valmora].concat(blank));
  sh.appendRow(['', 'B', files.B_CV_candidat, files.B_Portfolio_lettre, files.B_Offre_Orvane].concat(blank));
  if (files.A_Brief_client_Valmora_SCANNE) {
    sh.appendRow(['', 'A', files.A_CV_consultant_1, files.A_CV_consultant_2, files.A_Brief_client_Valmora_SCANNE].concat(blank));
  }
  var last = sh.getLastRow();
  sh.getRange(last - (files.A_Brief_client_Valmora_SCANNE ? 2 : 1), 6, files.A_Brief_client_Valmora_SCANNE ? 3 : 2, 1).setValue(APP.STATUS.A_TRAITER);
  log_('INFO', 'SETUP', 'Lignes d\'exemple importées');
}
