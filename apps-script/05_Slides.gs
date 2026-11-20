/**
 * ÉTAPE 3a — Visuels : génération automatique d'une présentation Google Slides
 * (une diapositive par scène, gabarits par type de scène) puis export PNG.
 *
 *  - Option A : style corporate moderne (cartes de compétences, graphique d'adéquation C1/C2).
 *  - Option B : style personal branding dynamique (réalisations, chiffre clé).
 *  - Le texte de voix-off est placé dans les notes du présentateur : la présentation
 *    peut aussi être importée telle quelle dans Google Vids (« notes → script »).
 *  - Le bas de chaque diapositive (≈ 22 %) est laissé libre pour les sous-titres
 *    incrustés par le worker.
 */

var W = 720, H = 405;          // taille d'une diapositive 16:9 en points
var SAFE_BOTTOM = 312;         // au-delà : zone des sous-titres

function buildDeck_(jobId, option, script, folder, cfg) {
  var theme = APP.THEMES[option];
  var title = (option === 'A' ? 'Pitch équipe' : 'Pitch candidature') + ' — ' + (script.destinataire || '') + ' — ' + jobId;
  var pres = SlidesApp.create(title);
  DriveApp.getFileById(pres.getId()).moveTo(folder);

  var defaults = pres.getSlides();
  var n = script.scenes.length;
  var pages = [];

  script.scenes.forEach(function (sc, i) {
    var slide = pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    slide.getBackground().setSolidFill(theme.bg);
    drawChrome_(slide, theme, script, option, i, n);

    if (sc.type === 'intro') drawIntro_(slide, theme, sc, script, option);
    else if (sc.type === 'adequation') drawAdequation_(slide, theme, sc, script, option);
    else if (sc.type === 'cta') drawCta_(slide, theme, sc, cfg);
    else drawStandard_(slide, theme, sc);

    slide.getNotesPage().getSpeakerNotesShape().getText().setText(sc.texte_voix_off);
    pages.push({ scene_id: sc.scene_id, pageId: slide.getObjectId() });
  });
  defaults.forEach(function (s) { s.remove(); });   // diapositive de titre créée par défaut
  pres.saveAndClose();

  return { presentationId: pres.getId(), url: 'https://docs.google.com/presentation/d/' + pres.getId() + '/edit', pages: pages };
}

/** Exporte chaque diapositive en PNG (1600 px) dans le dossier du job. */
function exportSlidePngs_(deck, folder) {
  return deck.pages.map(function (p) {
    var thumb = Slides.Presentations.Pages.getThumbnail(deck.presentationId, p.pageId, {
      'thumbnailProperties.mimeType': 'PNG',
      'thumbnailProperties.thumbnailSize': 'LARGE'
    });
    var blob = UrlFetchApp.fetch(thumb.contentUrl).getBlob().setName('scene_' + pad2_(p.scene_id) + '.png');
    var file = folder.createFile(blob);
    return { scene_id: p.scene_id, fileId: file.getId() };
  });
}

// ---------------------------------------------------------------- gabarits

function drawChrome_(slide, t, script, option, i, n) {
  var who = script.nom_affiche || '';
  text_(slide, t.label.toUpperCase() + (who ? '  ·  ' + who : ''), 36, 16, 420, 20, { size: 9, color: t.muted, bold: true });
  // Indicateur de progression : une pastille par scène
  for (var k = 0; k < n; k++) {
    var dot = slide.insertShape(SlidesApp.ShapeType.ELLIPSE, W - 36 - (n - k) * 14, 22, 8, 8);
    dot.getFill().setSolidFill(k === i ? t.accent : t.none);
    dot.getBorder().setTransparent();
  }
}

function drawIntro_(slide, t, sc, script, option) {
  rect_(slide, 36, 78, 6, 150, t.accent);
  var kicker = option === 'A' ? (script.nom_affiche || 'Notre équipe') : (script.nom_affiche || '');
  text_(slide, kicker, 54, 72, 600, 24, { size: 14, color: t.accent, bold: true });
  var len = sc.titre_ecran.length;
  var size = len > 44 ? 24 : (len > 30 ? 28 : 34);
  text_(slide, sc.titre_ecran, 54, 96, 620, 96, { size: size, color: t.text, bold: true, valign: 'MIDDLE' });
  text_(slide, script.destinataire || '', 54, 198, 620, 28, { size: 15, color: t.muted });
  chipsRow_(slide, t, sc.mots_cles_ecran, 54, 242, 620);
  text_(slide, APP.DISCLOSURE, 36, 292, 648, 16, { size: 8, color: t.muted });
}

function drawStandard_(slide, t, sc) {
  titleBlock_(slide, t, sc.titre_ecran);
  var hasFigure = sc.chiffre_cle && String(sc.chiffre_cle.valeur || '').trim();
  var areaW = hasFigure ? 410 : 648;
  chipsGrid_(slide, t, sc.mots_cles_ecran, 36, 122, areaW);
  if (hasFigure) {
    rect_(slide, 470, 118, 214, 172, t.panel, SlidesApp.ShapeType.ROUND_RECTANGLE);
    var v = String(sc.chiffre_cle.valeur);
    text_(slide, v, 470, 134, 214, 70, { size: v.length > 6 ? 30 : 42, color: t.accent, bold: true, align: 'CENTER', valign: 'MIDDLE' });
    text_(slide, String(sc.chiffre_cle.libelle || ''), 482, 206, 190, 74, { size: 12, color: t.text, align: 'CENTER' });
  }
}

function drawAdequation_(slide, t, sc, script, option) {
  titleBlock_(slide, t, sc.titre_ecran, 560);
  rect_(slide, 584, 52, 100, 46, t.accent, SlidesApp.ShapeType.ROUND_RECTANGLE);
  text_(slide, script.couverture_pct + ' %', 584, 49, 100, 34, { size: 20, color: t.bg, bold: true, align: 'CENTER', valign: 'MIDDLE' });
  text_(slide, 'couverture', 584, 78, 100, 18, { size: 9, color: t.bg, bold: true, align: 'CENTER' });

  var rows = (script.adequation || []).slice(0, 5);
  var y = 116;
  rows.forEach(function (a) {
    text_(slide, a.exigence, 36, y, 340, 30, { size: 11, color: t.text, valign: 'MIDDLE' });
    rect_(slide, 384, y + 10, 220, 10, t.none, SlidesApp.ShapeType.ROUND_RECTANGLE);
    var tag = '—', color = t.none;
    if (a.verifie) {
      var by = a.couvert_par.join('+');
      if (option === 'A') {
        color = by.indexOf('C1') >= 0 && by.indexOf('C2') >= 0 ? t.both : (by.indexOf('C2') >= 0 ? t.c2 : t.c1);
        tag = by.replace('+', ' + ');
      } else { color = t.accent; tag = '✓'; }
      rect_(slide, 384, y + 10, 220, 10, color, SlidesApp.ShapeType.ROUND_RECTANGLE);
    }
    text_(slide, tag, 612, y, 72, 30, { size: 11, color: a.verifie ? color : t.muted, bold: true, valign: 'MIDDLE' });
    y += 34;
  });
  var legend = option === 'A'
    ? 'C1 = Consultant 1   ·   C2 = Consultant 2   ·   preuves vérifiées dans les CV'
    : 'Chaque exigence cochée est justifiée par un extrait du CV ou du portfolio';
  text_(slide, legend, 36, 290, 648, 16, { size: 8, color: t.muted });
}

function drawCta_(slide, t, sc, cfg) {
  text_(slide, sc.titre_ecran, 36, 62, 648, 60, { size: 30, color: t.text, bold: true, align: 'CENTER', valign: 'MIDDLE' });
  text_(slide, sc.mots_cles_ecran.join('   ·   '), 36, 128, 648, 26, { size: 14, color: t.muted, align: 'CENTER' });
  rect_(slide, 220, 170, 280, 50, t.accent, SlidesApp.ShapeType.ROUND_RECTANGLE);
  text_(slide, 'Prendre rendez-vous', 220, 170, 280, 50, { size: 17, color: t.bg, bold: true, align: 'CENTER', valign: 'MIDDLE' });
  var contact = cfg.calendlyUrl || cfg.contactEmail || '';
  text_(slide, contact, 36, 230, 648, 22, { size: 12, color: t.accent2, align: 'CENTER' });
  text_(slide, APP.DISCLOSURE, 36, 292, 648, 16, { size: 8, color: t.muted, align: 'CENTER' });
}

function titleBlock_(slide, t, title, width) {
  var w = width || 648;
  text_(slide, title, 36, 44, w - 24, 58, { size: title.length > 42 ? 21 : 26, color: t.text, bold: true, valign: 'MIDDLE' });
  rect_(slide, 36, 104, 56, 4, t.accent);
}

function chipsGrid_(slide, t, items, x, y, areaW) {
  var cols = 2, gap = 12;
  var cw = (areaW - gap) / cols, ch = 66;
  (items || []).slice(0, 4).forEach(function (k, i) {
    var cx = x + (i % cols) * (cw + gap);
    var cy = y + Math.floor(i / cols) * (ch + gap);
    rect_(slide, cx, cy, cw, ch, t.chipBg, SlidesApp.ShapeType.ROUND_RECTANGLE);
    rect_(slide, cx, cy + 12, 4, ch - 24, t.accent);
    text_(slide, k, cx + 14, cy, cw - 22, ch, { size: k.length > 24 ? 12 : 14, color: t.chipText, bold: true, valign: 'MIDDLE' });
  });
}

function chipsRow_(slide, t, items, x, y, maxW) {
  var cx = x;
  (items || []).slice(0, 4).forEach(function (k) {
    var w = Math.min(200, 26 + k.length * 7);
    if (cx + w > x + maxW) return;
    rect_(slide, cx, y, w, 30, t.chipBg, SlidesApp.ShapeType.ROUND_RECTANGLE);
    text_(slide, k, cx, y, w, 30, { size: 11, color: t.chipText, bold: true, align: 'CENTER', valign: 'MIDDLE' });
    cx += w + 10;
  });
}

function rect_(slide, x, y, w, h, color, shapeType) {
  var s = slide.insertShape(shapeType || SlidesApp.ShapeType.RECTANGLE, x, y, w, h);
  s.getFill().setSolidFill(color);
  s.getBorder().setTransparent();
  return s;
}

function text_(slide, str, x, y, w, h, o) {
  var box = slide.insertTextBox(String(str || ' '), x, y, w, h);
  var range = box.getText();
  range.getTextStyle()
    .setFontFamily(o.font || 'Montserrat')
    .setFontSize(o.size || 14)
    .setBold(!!o.bold)
    .setForegroundColor(o.color || '#FFFFFF');
  if (o.align === 'CENTER') range.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  box.setContentAlignment(o.valign === 'MIDDLE' ? SlidesApp.ContentAlignment.MIDDLE : SlidesApp.ContentAlignment.TOP);
  return box;
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }
