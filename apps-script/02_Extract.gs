/**
 * ÉTAPE 1 — Extraction du texte des documents sources (PDF hébergés sur Drive).
 *
 *  Niveau 1 : conversion Drive → Google Docs (couche texte + OCR intégré de Drive).
 *             Fonctionne pour les PDF « natifs » ET les PDF scannés.
 *  Niveau 2 : fallback Gemini multimodal (le PDF est envoyé en inline_data et
 *             transcrit mot pour mot) si le niveau 1 échoue ou renvoie trop peu de texte.
 *  Formats acceptés aussi : Google Docs, .txt, .docx (converti par Drive).
 *
 *  + Anonymisation (Option A, RGPD) : noms, e-mails, téléphones, URL, adresses
 *    des consultants remplacés AVANT tout envoi au LLM.
 */

function extractDocument_(url, label) {
  var id = extractDriveId_(url);
  if (!id) throw new Error(label + ' : URL Drive invalide (' + url + ')');

  var file;
  try { file = DriveApp.getFileById(id); }
  catch (e) { throw new Error(label + ' : fichier inaccessible (droits ?) — ' + e.message); }

  var mime = file.getMimeType();
  var name = file.getName();

  if (mime === MimeType.GOOGLE_DOCS) {
    return { text: DocumentApp.openById(id).getBody().getText(), method: 'GOOGLE_DOC', name: name };
  }
  if (mime === MimeType.PLAIN_TEXT) {
    return { text: file.getBlob().getDataAsString('UTF-8'), method: 'TXT', name: name };
  }

  // PDF, DOCX, images… → conversion Drive (OCR)
  var text = '';
  try {
    text = convertWithDriveOcr_(id);
    if (isUsableText_(text)) return { text: text, method: 'DRIVE_OCR', name: name };
    log_('WARN', 'EXTRACTION', label + ' : conversion Drive insuffisante (' + text.length + ' car.) → fallback Gemini');
  } catch (e) {
    log_('WARN', 'EXTRACTION', label + ' : conversion Drive en échec (' + e.message + ') → fallback Gemini');
  }

  if (mime === MimeType.PDF || /^image\//.test(mime)) {
    var t2 = transcribeWithGemini_(file.getBlob(), label);
    if (isUsableText_(t2)) return { text: t2, method: 'GEMINI_OCR', name: name };
  }
  throw new Error(label + ' : impossible d\'extraire un texte exploitable de « ' + name + ' ».');
}

/** Copie le fichier en Google Docs (déclenche l'OCR Drive), lit le texte, supprime la copie. */
function convertWithDriveOcr_(fileId) {
  var copy = Drive.Files.copy(
    { name: '_tmp_ocr_' + fileId, mimeType: MimeType.GOOGLE_DOCS },
    fileId,
    { ocrLanguage: 'fr', fields: 'id' }
  );
  try {
    return DocumentApp.openById(copy.id).getBody().getText();
  } finally {
    try { Drive.Files.remove(copy.id); } catch (e) { DriveApp.getFileById(copy.id).setTrashed(true); }
  }
}

/** Fallback : transcription fidèle d'un PDF/image par Gemini (pas de résumé, pas de reformulation). */
function transcribeWithGemini_(blob, label) {
  var res = callGemini_({
    system: 'Tu es un moteur OCR. Tu recopies le texte du document mot pour mot, sans résumer, ' +
            'sans corriger, sans rien ajouter. Conserve les chiffres exactement.',
    user: 'Transcris intégralement le texte de ce document (' + label + ').',
    inlineData: { mimeType: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) },
    temperature: 0,
    json: false
  });
  return res.text || '';
}

/** Un texte est exploitable s'il est assez long et composé majoritairement de lettres. */
function isUsableText_(text) {
  var t = String(text || '').trim();
  if (t.length < APP.MIN_DOC_CHARS) return false;
  var letters = (t.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  return letters / t.length > 0.5;
}

/**
 * Pseudonymisation d'un CV (Option A). Retourne { text, names:[…], counts:{…} }.
 * - Nom : détecté dans les premières lignes (« Prénom NOM » ou « NOM Prénom »),
 *   remplacé partout (nom complet ET chaque partie) par l'alias.
 * - E-mails, téléphones, URL/LinkedIn, adresses postales : masqués.
 * Les valeurs masquées ne sont JAMAIS journalisées (seulement des compteurs).
 */
function anonymizeCv_(text, alias) {
  var t = String(text || '');
  var counts = { noms: 0, emails: 0, telephones: 0, urls: 0, adresses: 0 };

  // 1) Coordonnées (en premier : l'e-mail contient souvent le nom)
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, function () { counts.emails++; return '[email masqué]'; });
  t = t.replace(/(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/g, function () { counts.telephones++; return '[téléphone masqué]'; });
  t = t.replace(/\b(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)?linkedin\.com\/\S+/gi, function () { counts.urls++; return '[lien masqué]'; });
  t = t.replace(/\b\d{1,4}(?:\s?(?:bis|ter))?,?\s+(?:rue|avenue|av\.|boulevard|bd|chemin|allée|impasse|place|route|quai)\b[^\n·|]*/gi,
    function () { counts.adresses++; return '[adresse masquée]'; });


  // 2) Nom dans l'en-tête (après les coordonnées, pour ne pas casser les e-mails)
  var names = detectPersonName_(t);
  names.forEach(function (full) {
    var parts = [full].concat(full.split(/[\s]+/).filter(function (p) { return p.length >= 3; }));
    parts.forEach(function (p) {
      var re = new RegExp('(^|[^A-Za-zÀ-ÿ])' + escapeRegex_(p) + '(?=$|[^A-Za-zÀ-ÿ])', 'gi');
      t = t.replace(re, function (m, pre) { counts.noms++; return pre + alias; });
    });
  });
  // « Consultant 1 Consultant 1 » → « Consultant 1 »
  t = t.replace(new RegExp('(' + escapeRegex_(alias) + ')(\\s+' + escapeRegex_(alias) + ')+', 'g'), '$1');

  return { text: t, names: names, counts: counts };
}

/** Détecte « Prénom NOM » / « NOM Prénom » dans les 4 premières lignes non vides. */
function detectPersonName_(text) {
  var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); })
    .filter(function (l) { return l.length > 0; }).slice(0, 4);
  var found = [];
  var upper = "[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'\\-]+";
  var cap = "[A-ZÀ-ÖØ-Þ][a-zß-öø-ÿ'\\-]+";
  var reA = new RegExp('^(' + cap + '(?:[ \\-]' + cap + ')?)\\s+(' + upper + '(?:\\s' + upper + ')?)$');
  var reB = new RegExp('^(' + upper + '(?:\\s' + upper + ')?)\\s+(' + cap + '(?:[ \\-]' + cap + ')?)$');
  lines.forEach(function (l) {
    if (l.length > 40) return;
    if (reA.test(l) || reB.test(l)) found.push(l);
  });
  return found;
}

function escapeRegex_(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Extrait les 3 documents d'une ligne. Option A : les 2 CV sont pseudonymisés.
 * Retourne { docs:[{label,text,method}], corpus, maskedNames, report }.
 */
function extractAllDocs_(row) {
  var option = String(row['Option_Choisie']).trim().toUpperCase();
  var specs = option === 'A'
    ? [['CV consultant 1', row['URL_PDF_1']], ['CV consultant 2', row['URL_PDF_2_ou_Portfolio']], ['Brief client', row['URL_Brief_ou_Offre']]]
    : [['CV candidat', row['URL_PDF_1']], ['Portfolio / lettre', row['URL_PDF_2_ou_Portfolio']], ['Fiche de poste', row['URL_Brief_ou_Offre']]];

  var docs = [];
  var maskedNames = [];
  var report = [];
  specs.forEach(function (spec, i) {
    var r = extractDocument_(spec[1], spec[0]);
    var text = r.text;
    if (option === 'A' && i < 2) {
      var alias = 'Consultant ' + (i + 1);
      var an = anonymizeCv_(text, alias);
      text = an.text;
      maskedNames = maskedNames.concat(an.names);
      report.push(spec[0] + ' → ' + alias + ' (masqués : ' + JSON.stringify(an.counts) + ')');
    }
    text = truncate_(text, APP.MAX_DOC_CHARS);
    docs.push({ label: spec[0], text: text, method: r.method, name: r.name });
    log_('INFO', 'EXTRACTION', spec[0] + ' : ' + r.method + ', ' + text.length + ' caractères');
  });
  if (report.length) log_('INFO', 'RGPD', 'Pseudonymisation : ' + report.join(' | '));

  return {
    docs: docs,
    corpus: docs.map(function (d) { return d.text; }).join('\n\n'),
    maskedNames: maskedNames
  };
}
