/**
 * ÉTAPE 5 — Hébergement cloud, traçabilité et restitution.
 *  - MP4 + GIF enregistrés dans le dossier Drive du job, partage « tous les utilisateurs
 *    disposant du lien » (lecture seule) : lien lisible derrière un pare-feu d'entreprise.
 *  - Écriture automatique de l'URL, de la durée audio et de la date dans PRODUCTION.
 *  - Bonus : brouillon Gmail pré-rédigé (GIF cliquable → vidéo, lien de rendez-vous).
 *    Le brouillon n'est JAMAIS envoyé automatiquement : relecture humaine obligatoire.
 */

function deliverResult_(rowIndex, body) {
  var id = body.id;
  var cfg = getConfig_();
  var folder = jobFolder_(id, cfg);
  var row = readRow_(rowIndex);
  var script = {};
  try { script = parseJsonLoose_(row['Script_JSON']); } catch (e) { script = {}; }

  var mp4 = Utilities.newBlob(Utilities.base64Decode(body.mp4_b64), 'video/mp4', 'pitch_' + id + '.mp4');
  var videoFile = folder.createFile(mp4);
  var shareMode = shareByLink_(videoFile);
  var videoUrl = driveFileUrl_(videoFile.getId());

  var gifBlob = null, gifUrl = '';
  if (body.gif_b64) {
    gifBlob = Utilities.newBlob(Utilities.base64Decode(body.gif_b64), 'image/gif', 'apercu_' + id + '.gif');
    var gifFile = folder.createFile(gifBlob);
    shareByLink_(gifFile);
    gifUrl = driveFileUrl_(gifFile.getId());
  }

  updateRow_(rowIndex, {
    'Statut_Traitement': APP.STATUS.TERMINE,
    'Duree_Audio_Sec': Math.round(Number(body.audio_seconds || 0) * 10) / 10,
    'URL_Video_Cloud': videoUrl,
    'URL_GIF': gifUrl,
    'Date_Generation': new Date(),
    'Derniere_Etape': '5/5 Vidéo publiée (' + shareMode + ')'
  });
  log_('INFO', 'PUBLICATION', id + ' : vidéo ' + Math.round(mp4.getBytes().length / 1024) + ' Ko, audio ' +
    body.audio_seconds + ' s, vidéo ' + body.video_seconds + ' s, voix ' + body.voice + ', débit ' + body.rate + ' → ' + videoUrl);
  if (body.logs) log_('INFO', 'WORKER', id + ' : ' + body.logs);

  if (cfg.createDraft) {
    try {
      var draftInfo = createGmailDraft_(row, script, videoUrl, gifBlob, cfg);
      updateRow_(rowIndex, { 'Brouillon_Gmail': draftInfo });
      log_('INFO', 'GMAIL', id + ' : ' + draftInfo);
    } catch (e) {
      log_('WARN', 'GMAIL', id + ' : brouillon non créé — ' + e.message);
    }
  }
  return { videoUrl: videoUrl };
}

/** Partage par lien en lecture ; repli sur le domaine si la politique Workspace l'interdit. */
function shareByLink_(file) {
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'lien public en lecture';
  } catch (e) {
    try {
      file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
      log_('WARN', 'PUBLICATION', 'Partage public refusé par l\'organisation → partage limité au domaine');
      return 'lien limité au domaine';
    } catch (e2) {
      log_('WARN', 'PUBLICATION', 'Partage par lien impossible : ' + e2.message);
      return 'privé';
    }
  }
}

function createGmailDraft_(row, script, videoUrl, gifBlob, cfg) {
  var to = String(row['Email_Destinataire'] || '').trim();
  var email = script.email || {};
  var subject = email.objet || (row['Option_Choisie'] === 'A' ? 'Proposition d\'équipe en vidéo' : 'Ma candidature en vidéo (1 min)');
  var paragraphs = String(email.corps || '').split(/\n+/).filter(String);

  var htmlParts = paragraphs.map(function (p) { return '<p style="margin:0 0 12px">' + escapeHtml_(p) + '</p>'; });
  htmlParts.push(
    '<p style="margin:16px 0 6px"><a href="' + videoUrl + '">' +
    (gifBlob ? '<img src="cid:apercu" alt="Voir la vidéo" width="480" style="border-radius:8px;display:block">' : '') +
    '</a></p>',
    '<p style="margin:0 0 16px"><a href="' + videoUrl + '"><b>▶ Voir la vidéo (moins d\'une minute)</b></a></p>'
  );
  if (cfg.calendlyUrl) {
    htmlParts.push('<p style="margin:0 0 16px">Pour échanger de vive voix, vous pouvez réserver un créneau ici : ' +
      '<a href="' + cfg.calendlyUrl + '">' + escapeHtml_(cfg.calendlyUrl) + '</a></p>');
  }
  if (cfg.senderName) htmlParts.push('<p style="margin:0">' + escapeHtml_(cfg.senderName) + '</p>');
  htmlParts.push('<p style="color:#888;font-size:11px;margin-top:18px">Vidéo générée automatiquement à partir de mes documents, avec une voix de synthèse.</p>');

  var plain = paragraphs.join('\n\n') + '\n\nVidéo : ' + videoUrl + (cfg.calendlyUrl ? '\nRendez-vous : ' + cfg.calendlyUrl : '');
  var options = { htmlBody: '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">' + htmlParts.join('') + '</div>' };
  if (gifBlob) options.inlineImages = { apercu: gifBlob };
  if (cfg.senderName) options.name = cfg.senderName;

  var draft = GmailApp.createDraft(to, subject, plain, options);
  return 'Brouillon créé' + (to ? ' pour ' + to : ' (destinataire à compléter)') + ' — objet : « ' + subject + ' » — ' +
    'https://mail.google.com/mail/u/0/#drafts?compose=' + draft.getMessage().getId();
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
