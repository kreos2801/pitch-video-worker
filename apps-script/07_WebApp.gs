/**
 * WEB APP — point de contact du worker de rendu (aucune autre surface exposée).
 *
 *  GET  ?action=ping                         → santé (sans jeton)
 *  GET  ?action=job&id=…&token=…             → manifeste + diapositives PNG (base64)
 *  GET  ?action=next&token=…                 → mode polling : prochain job en attente
 *  POST {action:'status'|'result'|'error', token, id, …}
 *
 * Sécurité : jeton partagé WORKER_TOKEN (Propriétés du script + secret GitHub),
 * comparé en temps constant ; ID validé par regex ; aucune donnée renvoyée sans jeton.
 */

var ID_RE = /^[A-Za-z0-9_-]{3,64}$/;   // ex. EXE-20261120-153012-4F2A

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'ping') return json_({ ok: true, app: APP.NAME, version: APP.VERSION });
    authorize_(p.token);

    if (p.action === 'next') {
      var hm = prodHeaderMap_();
      for (var r = 2; r <= hm.sheet.getLastRow(); r++) {
        var row = readRow_(r);
        if (row['Statut_Traitement'] === APP.STATUS.RENDU_ATTENTE) return json_({ ok: true, id: row['ID_Execution'] });
      }
      return json_({ ok: true, id: null });
    }

    if (p.action === 'job') {
      if (!ID_RE.test(p.id || '')) throw new Error('ID invalide');
      var meta = getJobMeta_(p.id);
      if (!meta.manifestId) throw new Error('Job inconnu : ' + p.id);
      var manifest = JSON.parse(DriveApp.getFileById(meta.manifestId).getBlob().getDataAsString('UTF-8'));
      manifest.scenes.forEach(function (sc) {
        sc.slide_png_b64 = Utilities.base64Encode(DriveApp.getFileById(sc.slide_file_id).getBlob().getBytes());
      });
      var rowIndex = findRowById_(p.id);
      if (rowIndex > 0) setStatus_(rowIndex, APP.STATUS.RENDU, '4/5 Rendu en cours (worker connecté)');
      log_('INFO', 'RENDU', p.id + ' : job remis au worker');
      return json_({ ok: true, job: manifest });
    }
    throw new Error('Action inconnue');
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
    authorize_(body.token);
    if (!ID_RE.test(body.id || '')) throw new Error('ID invalide');
    var rowIndex = findRowById_(body.id);
    if (rowIndex < 0) throw new Error('ID_Execution introuvable : ' + body.id);

    if (body.action === 'status') {
      updateRow_(rowIndex, { 'Derniere_Etape': '4/5 ' + String(body.message || '').slice(0, 200) });
      log_('INFO', 'WORKER', body.id + ' : ' + body.message);
      return json_({ ok: true });
    }
    if (body.action === 'error') {
      setStatus_(rowIndex, APP.STATUS.ERREUR, 'Worker : ' + String(body.message || '').slice(0, 300));
      log_('ERROR', 'WORKER', body.id + ' : ' + body.message + (body.logs ? '\n' + body.logs : ''));
      return json_({ ok: true });
    }
    if (body.action === 'result') {
      var out = deliverResult_(rowIndex, body);
      return json_({ ok: true, video_url: out.videoUrl });
    }
    throw new Error('Action inconnue');
  } catch (err) {
    log_('ERROR', 'WEBAPP', (body && body.id ? body.id + ' : ' : '') + err.message);
    return json_({ ok: false, error: err.message });
  }
}

function authorize_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('WORKER_TOKEN');
  if (!expected || !safeEquals_(token, expected)) throw new Error('Non autorisé');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
