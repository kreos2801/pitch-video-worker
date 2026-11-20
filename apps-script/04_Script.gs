/**
 * ÉTAPE 2 — Génération du script scène par scène (JSON strict) + contrôle anti-hallucination.
 *
 * Garde-fous « zéro hallucination » (le LLM n'est jamais cru sur parole) :
 *  1. Chaque chiffre du script (voix-off, titres, mots-clés, chiffre clé, e-mail) doit
 *     exister dans les documents sources (ou être le taux de couverture calculé par le code).
 *  2. Chaque scène factuelle cite des extraits « mot pour mot » ; ils sont retrouvés dans
 *     les sources (correspondance exacte ou ≥ 85 % des mots).
 *  3. Le graphique d'adéquation n'affiche une exigence comme couverte que si sa preuve
 *     est retrouvée dans les sources ; le pourcentage est calculé par le code, pas par l'IA.
 *  4. Option A : aucun nom réel de consultant ne doit apparaître (fuite RGPD).
 *  5. Calibrage : 120 à 145 mots de voix-off au total (45-60 s).
 * En cas d'écart : nouvelle tentative avec la liste des erreurs (auto-correction), puis
 * statut A_VERIFIER (validation humaine) si les erreurs persistent.
 */

/** Lit un prompt de l'onglet PROMPTS. */
function getPrompt_(id) {
  var sh = sheet_(APP.SHEETS.PROMPTS);
  var values = sh.getDataRange().getValues();
  var h = values[0].map(function (x) { return String(x).trim(); });
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][h.indexOf('ID_Prompt')]).trim() === id) {
      return {
        id: id,
        system: values[i][h.indexOf('Role_Systeme')],
        template: values[i][h.indexOf('Template_Prompt_User')],
        temperature: values[i][h.indexOf('Temperature')] === '' ? 0.4 : Number(values[i][h.indexOf('Temperature')]),
        model: String(values[i][h.indexOf('Model_Name')] || '').trim() || APP.DEFAULT_MODEL
      };
    }
  }
  throw new Error('Prompt introuvable dans PROMPTS : ' + id);
}

/** Variables injectées dans le template de prompt. */
function promptVars_(option, extraction, cfg) {
  var d = extraction.docs;
  var cta = cfg.calendlyUrl ? ' via le lien de prise de rendez-vous affiché à l\'écran' : ' par e-mail';
  return {
    DOC_1: d[0].text, DOC_2: d[1].text, DOC_3: d[2].text,
    MOTS_MIN: APP.WORDS_MIN, MOTS_MAX: APP.WORDS_MAX,
    SCENES_MIN: APP.SCENES_MIN, SCENES_MAX: APP.SCENES_MAX,
    TITRE_MAX: APP.TITLE_MAX, MOT_CLE_MAX: APP.KEYWORD_MAX,
    NOM_ESN: cfg.esnName,
    CTA_DETAIL: cta
  };
}

/**
 * Génère et valide le script. Retourne { script, validation, attempts, model, costUsd }.
 * Ne lève pas d'exception si le contrôle échoue : validation.ok = false.
 */
function generateScript_(option, extraction, cfg) {
  var prompt = getPrompt_('SCRIPT_' + option);
  var userMsg = fillTemplate_(prompt.template, promptVars_(option, extraction, cfg));
  var history = [];
  var best = null;
  var cost = 0;
  var model = prompt.model;

  for (var attempt = 1; attempt <= APP.MAX_SCRIPT_ATTEMPTS; attempt++) {
    var res = callGemini_({
      system: prompt.system, user: userMsg, history: history,
      temperature: attempt === 1 ? prompt.temperature : Math.max(0.1, prompt.temperature - 0.2),
      model: prompt.model, json: true, schema: scriptSchema_()
    });
    cost += res.costUsd;
    model = res.model;

    var script;
    try {
      script = parseJsonLoose_(res.text);
    } catch (e) {
      log_('WARN', 'SCRIPT_IA', 'Tentative ' + attempt + ' : JSON invalide — ' + e.message);
      history.push({ role: 'user', text: userMsg }, { role: 'model', text: res.text });
      userMsg = 'Ta réponse n\'était pas un JSON valide. Renvoie UNIQUEMENT l\'objet JSON demandé.';
      continue;
    }

    var v = validateScript_(script, extraction.corpus, option, extraction.maskedNames, extraConstants_(cfg));
    log_(v.ok ? 'INFO' : 'WARN', 'CONTROLE_FAITS',
      'Tentative ' + attempt + ' (' + res.model + ') : ' + v.summary + (v.errors.length ? ' | Erreurs : ' + v.errors.join(' ; ') : ''));

    if (!best || v.errors.length < best.validation.errors.length) best = { script: v.script, validation: v };
    if (v.ok) break;

    history.push({ role: 'user', text: userMsg }, { role: 'model', text: res.text });
    userMsg = 'Le contrôle automatique a rejeté ton script pour ces raisons :\n- ' + v.errors.join('\n- ') +
      '\n\nCorrige UNIQUEMENT ces points en respectant toutes les règles initiales ' +
      '(faits issus des documents, ' + APP.WORDS_MIN + ' à ' + APP.WORDS_MAX + ' mots au total) ' +
      'et renvoie l\'objet JSON complet.';
  }
  if (!best) throw new Error('Gemini n\'a renvoyé aucun JSON exploitable après ' + APP.MAX_SCRIPT_ATTEMPTS + ' tentatives.');
  return { script: best.script, validation: best.validation, model: model, costUsd: cost };
}

/** Constantes autorisées en plus des documents (paramètres saisis par l'utilisateur). */
function extraConstants_(cfg) {
  return [cfg.esnName, cfg.calendlyUrl, cfg.contactEmail].join(' ');
}

/**
 * Valide (et normalise) un script. Fonction pure : testable hors Apps Script.
 * @return {{ok:boolean, errors:string[], warnings:string[], summary:string, stats:Object, script:Object}}
 */
function validateScript_(script, corpus, option, maskedNames, extra) {
  var errors = [];
  var warnings = [];
  var s = JSON.parse(JSON.stringify(script || {}));   // copie de travail
  var corpusNorm = normalizeText_(corpus + ' ' + (extra || ''));
  var corpusWords = {};
  corpusNorm.split(' ').forEach(function (w) { corpusWords[w] = true; });
  var corpusNumbers = {};
  extractNumbers_(corpus + ' ' + (extra || '')).forEach(function (n) { corpusNumbers[n] = true; });

  // --- Structure ----------------------------------------------------------
  if (!Array.isArray(s.scenes)) { s.scenes = []; errors.push('Champ "scenes" absent'); }
  if (s.scenes.length < APP.SCENES_MIN || s.scenes.length > APP.SCENES_MAX) {
    errors.push('Nombre de scènes = ' + s.scenes.length + ' (attendu ' + APP.SCENES_MIN + ' à ' + APP.SCENES_MAX + ')');
  }
  s.scenes.forEach(function (sc, i) {
    sc.scene_id = i + 1;   // renumérotation séquentielle
    sc.type = String(sc.type || 'profil');
    sc.titre_ecran = String(sc.titre_ecran || '').trim();
    sc.texte_voix_off = String(sc.texte_voix_off || '').trim();
    sc.mots_cles_ecran = (Array.isArray(sc.mots_cles_ecran) ? sc.mots_cles_ecran : [])
      .map(function (k) { return String(k).trim(); }).filter(String).slice(0, 4);
    sc.sources = (Array.isArray(sc.sources) ? sc.sources : []).map(String).filter(String);
    if (!sc.titre_ecran) errors.push('Scène ' + sc.scene_id + ' : titre_ecran vide');
    if (sc.titre_ecran.length > APP.TITLE_MAX) errors.push('Scène ' + sc.scene_id + ' : titre_ecran > ' + APP.TITLE_MAX + ' caractères');
    if (!sc.texte_voix_off) errors.push('Scène ' + sc.scene_id + ' : texte_voix_off vide');
    if (!sc.mots_cles_ecran.length) errors.push('Scène ' + sc.scene_id + ' : mots_cles_ecran vide');
    sc.mots_cles_ecran.forEach(function (k) {
      if (k.length > APP.KEYWORD_MAX) warnings.push('Scène ' + sc.scene_id + ' : mot-clé long « ' + k + ' »');
    });
  });
  if (s.scenes.length && s.scenes[s.scenes.length - 1].type !== 'cta') warnings.push('La dernière scène n\'est pas un appel à l\'action');

  // --- Calibrage de la durée -------------------------------------------------
  var words = s.scenes.reduce(function (acc, sc) { return acc + countWords_(sc.texte_voix_off); }, 0);
  if (words < APP.WORDS_MIN || words > APP.WORDS_MAX) {
    errors.push('Voix-off = ' + words + ' mots (attendu ' + APP.WORDS_MIN + ' à ' + APP.WORDS_MAX + ')');
  }

  // --- Adéquation : preuves vérifiées, taux calculé par le code -------------
  var adequation = Array.isArray(s.adequation) ? s.adequation : [];
  var covered = 0;
  adequation.forEach(function (a) {
    a.exigence = String(a.exigence || '').trim();
    a.preuve = String(a.preuve || '').trim();
    a.couvert_par = (Array.isArray(a.couvert_par) ? a.couvert_par : []).map(function (x) { return String(x).toUpperCase().trim(); });
    var grounded = a.preuve && isGrounded_(a.preuve, corpusNorm, corpusWords);
    if (a.couvert_par.length && !grounded) {
      warnings.push('Exigence « ' + a.exigence + ' » : preuve introuvable dans les sources → marquée non couverte');
      a.couvert_par = [];
    }
    a.verifie = !!(a.couvert_par.length && grounded);
    if (a.verifie) covered++;
  });
  if (adequation.length < 3) errors.push('Liste "adequation" trop courte (' + adequation.length + ' exigences)');
  var coveragePct = adequation.length ? Math.round(100 * covered / adequation.length) : 0;
  s.adequation = adequation;
  s.couverture_pct = coveragePct;

  // --- Chiffres : tous doivent venir des sources -----------------------------
  var allowed = {};
  allowed[String(coveragePct)] = true;
  if (option === 'A') { allowed['1'] = true; allowed['2'] = true; }   // « Consultant 1 / 2 », « 2 experts »
  var checkedNumbers = 0;
  var unsupported = [];
  function checkNumbers(text, where) {
    extractNumbers_(text).forEach(function (n) {
      checkedNumbers++;
      if (!corpusNumbers[n] && !allowed[n]) unsupported.push(n + ' (' + where + ')');
    });
  }
  s.scenes.forEach(function (sc) {
    var w = 'scène ' + sc.scene_id;
    checkNumbers(sc.texte_voix_off, w);
    checkNumbers(sc.titre_ecran, w + ' titre');
    checkNumbers(sc.mots_cles_ecran.join(' '), w + ' mots-clés');
    if (sc.chiffre_cle && sc.chiffre_cle.valeur) checkNumbers(sc.chiffre_cle.valeur + ' ' + (sc.chiffre_cle.libelle || ''), w + ' chiffre clé');
  });
  if (s.email) checkNumbers((s.email.objet || '') + ' ' + (s.email.corps || ''), 'e-mail');
  if (unsupported.length) errors.push('Chiffres absents des documents : ' + unsupported.join(', '));

  // --- Extraits sources ------------------------------------------------------
  var excerptsTotal = 0;
  var excerptsOk = 0;
  s.scenes.forEach(function (sc) {
    var ok = 0;
    sc.sources.forEach(function (ex) {
      excerptsTotal++;
      if (isGrounded_(ex, corpusNorm, corpusWords)) { ok++; excerptsOk++; }
      else warnings.push('Scène ' + sc.scene_id + ' : extrait non retrouvé « ' + ex.slice(0, 60) + ' »');
    });
    sc.sources_verifiees = ok;
    var factual = ['intro', 'cta'].indexOf(sc.type) < 0;
    if (factual && ok === 0) errors.push('Scène ' + sc.scene_id + ' (' + sc.type + ') : aucun extrait source vérifiable');
  });

  // --- Fuite de données nominatives (Option A) -------------------------------
  if (option === 'A' && maskedNames && maskedNames.length) {
    var scriptNorm = normalizeText_(JSON.stringify(s));
    maskedNames.forEach(function (full) {
      full.split(/\s+/).filter(function (p) { return p.length >= 3; }).forEach(function (part) {
        if ((' ' + scriptNorm + ' ').indexOf(' ' + normalizeText_(part) + ' ') >= 0) {
          errors.push('Donnée nominative détectée dans le script (anonymisation)');
        }
      });
    });
  }

  // --- E-mail destinataire : accepté seulement s'il figure dans les sources --
  var to = String(s.email_destinataire || '').trim();
  if (to && String(corpus).indexOf(to) < 0) { warnings.push('E-mail destinataire non trouvé dans les sources → ignoré'); to = ''; }
  s.email_destinataire = to;

  var estSec = Math.round(words / APP.WORDS_PER_SEC);
  var summary = (errors.length ? 'ÉCHEC' : 'OK') + ' — ' + words + ' mots (~' + estSec + ' s), ' +
    (checkedNumbers - unsupported.length) + '/' + checkedNumbers + ' chiffres sourcés, ' +
    excerptsOk + '/' + excerptsTotal + ' extraits retrouvés, couverture ' + coveragePct + ' %';

  return {
    ok: errors.length === 0,
    errors: dedupe_(errors),
    warnings: dedupe_(warnings),
    summary: summary,
    stats: { words: words, estSeconds: estSec, coverage: coveragePct, excerptsOk: excerptsOk, excerptsTotal: excerptsTotal },
    script: s
  };
}

/** Un extrait est « ancré » s'il est présent tel quel, ou si ≥ 85 % de ses mots (≥ 3 lettres) sont dans les sources. */
function isGrounded_(excerpt, corpusNorm, corpusWords) {
  var e = normalizeText_(excerpt);
  if (!e) return false;
  if (corpusNorm.indexOf(e) >= 0) return true;
  var words = e.split(' ').filter(function (w) { return w.length >= 3; });
  if (words.length < 3) return false;
  var hit = words.filter(function (w) { return corpusWords[w]; }).length;
  return hit / words.length >= 0.85;
}

function dedupe_(arr) {
  var seen = {};
  return arr.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; });
}
