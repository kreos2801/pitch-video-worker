/**
 * Client Gemini (API REST generateContent) — appels directs, sans SDK ni iPaaS.
 *  - mode JSON strict (responseMimeType + responseSchema)
 *  - bascule automatique de modèle si 404 (modèle retiré)
 *  - retries exponentiels sur 429 / 5xx
 *  - comptage des tokens → coût estimé par vidéo
 */

/**
 * @param {Object} o { system, user, history:[{role,text}], temperature, model, json, schema, inlineData }
 * @return {{text:string, model:string, tokensIn:number, tokensOut:number, costUsd:number}}
 */
function callGemini_(o) {
  var cfg = getConfig_();
  if (!cfg.geminiKey) throw new Error('GEMINI_API_KEY manquante (menu Pitch Vidéo › Configurer).');

  var first = o.model || APP.DEFAULT_MODEL;
  var models = [first].concat(APP.MODEL_FALLBACKS.filter(function (m) { return m !== first; }));

  var contents = [];
  (o.history || []).forEach(function (h) { contents.push({ role: h.role, parts: [{ text: h.text }] }); });
  var userParts = [];
  if (o.inlineData) userParts.push({ inline_data: { mime_type: o.inlineData.mimeType, data: o.inlineData.data } });
  userParts.push({ text: o.user });
  contents.push({ role: 'user', parts: userParts });

  var generationConfig = { temperature: o.temperature == null ? 0.4 : Number(o.temperature) };
  if (o.json) {
    generationConfig.responseMimeType = 'application/json';
    if (o.schema) generationConfig.responseSchema = o.schema;
  }

  var body = { contents: contents, generationConfig: generationConfig };
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };

  var lastErr = null;
  for (var mi = 0; mi < models.length; mi++) {
    var model = models[mi];
    for (var attempt = 0; attempt < 4; attempt++) {
      var resp = UrlFetchApp.fetch(APP.GEMINI_BASE + '/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': cfg.geminiKey },   // clé en en-tête, jamais dans l'URL (pas de fuite dans les logs)
        payload: JSON.stringify(body),
        muteHttpExceptions: true
      });
      var code = resp.getResponseCode();
      var txt = resp.getContentText();

      if (code === 200) {
        var data = JSON.parse(txt);
        var cand = (data.candidates || [])[0];
        if (!cand || !cand.content || !cand.content.parts) {
          throw new Error('Réponse Gemini vide (finishReason=' + (cand && cand.finishReason) + ')');
        }
        var out = cand.content.parts.map(function (p) { return p.text || ''; }).join('');
        var u = data.usageMetadata || {};
        var tin = u.promptTokenCount || 0;
        var tout = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
        return {
          text: out, model: model, tokensIn: tin, tokensOut: tout,
          costUsd: tin / 1e6 * APP.PRICE_IN_PER_M + tout / 1e6 * APP.PRICE_OUT_PER_M
        };
      }
      if (code === 400 && generationConfig.responseSchema && /schema/i.test(txt)) {
        // Certains modèles refusent le schéma : on garde le mode JSON, le schéma est aussi décrit dans le prompt.
        delete generationConfig.responseSchema;
        log_('WARN', 'GEMINI', model + ' refuse responseSchema → mode JSON simple');
        continue;
      }
      if (code === 404) { lastErr = new Error('Modèle indisponible : ' + model); break; }
      if (code === 429 || code >= 500) {
        lastErr = new Error('Gemini HTTP ' + code + ' : ' + txt.slice(0, 300));
        Utilities.sleep(Math.min(30000, 2000 * Math.pow(2, attempt)));
        continue;
      }
      throw new Error('Gemini HTTP ' + code + ' : ' + txt.slice(0, 500));
    }
    log_('WARN', 'GEMINI', 'Bascule de modèle après échec de ' + model + ' : ' + (lastErr && lastErr.message));
  }
  throw lastErr || new Error('Aucun modèle Gemini disponible');
}

/** Schéma de sortie du script (sous-ensemble OpenAPI accepté par Gemini). */
function scriptSchema_() {
  var S = 'STRING', A = 'ARRAY', O = 'OBJECT', I = 'INTEGER';
  return {
    type: O,
    properties: {
      titre_video: { type: S },
      nom_affiche: { type: S },
      destinataire: { type: S },
      email_destinataire: { type: S },
      scenes: {
        type: A,
        items: {
          type: O,
          properties: {
            scene_id: { type: I },
            type: { type: S, enum: ['intro', 'profil', 'competences', 'preuve', 'adequation', 'cta'] },
            titre_ecran: { type: S },
            mots_cles_ecran: { type: A, items: { type: S } },
            texte_voix_off: { type: S },
            chiffre_cle: { type: O, properties: { valeur: { type: S }, libelle: { type: S } } },
            sources: { type: A, items: { type: S } }
          },
          required: ['scene_id', 'type', 'titre_ecran', 'mots_cles_ecran', 'texte_voix_off', 'sources']
        }
      },
      adequation: {
        type: A,
        items: {
          type: O,
          properties: {
            exigence: { type: S },
            couvert_par: { type: A, items: { type: S } },
            preuve: { type: S }
          },
          required: ['exigence', 'couvert_par', 'preuve']
        }
      },
      email: { type: O, properties: { objet: { type: S }, corps: { type: S } } }
    },
    required: ['titre_video', 'nom_affiche', 'destinataire', 'scenes', 'adequation', 'email']
  };
}
