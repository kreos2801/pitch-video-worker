/**
 * Tests unitaires de la logique Apps Script (node --test tests/run.test.js).
 * Le texte des PDF est obtenu avec pdftotext (équivalent de la conversion Drive).
 */
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadGs } = require('./gs_harness');

const ROOT = path.join(__dirname, '..');
const pdf = (p) => execFileSync('pdftotext', ['-layout', path.join(ROOT, 'samples', p), '-'], { encoding: 'utf8' });
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const gs = loadGs();
const EXTRA = 'Néotek Conseil https://calendly.com/demo contact@example.com';

function corpusB() { return [pdf('option_B/B_CV_candidat.pdf'), pdf('option_B/B_Portfolio_lettre.pdf'), pdf('option_B/B_Offre_Orvane.pdf')].join('\n'); }
function extractionA() {
  const c1 = gs.anonymizeCv_(pdf('option_A/A_CV_consultant_1.pdf'), 'Consultant 1');
  const c2 = gs.anonymizeCv_(pdf('option_A/A_CV_consultant_2.pdf'), 'Consultant 2');
  return { corpus: [c1.text, c2.text, pdf('option_A/A_Brief_client_Valmora.pdf')].join('\n'), names: c1.names.concat(c2.names), c1, c2 };
}

test('extractDriveId_ reconnaît les formats d\'URL Drive', () => {
  assert.strictEqual(gs.extractDriveId_('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing'), '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  assert.strictEqual(gs.extractDriveId_('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345'), '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  assert.strictEqual(gs.extractDriveId_('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345'), '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  assert.strictEqual(gs.extractDriveId_('pas une url'), '');
});

test('countWords_ et extractNumbers_', () => {
  assert.strictEqual(gs.countWords_('Bonjour ! Je réduis de 35 % le délai.'), 7);
  assert.deepStrictEqual(Array.from(gs.extractNumbers_('2 000 salariés, 3,5 ans, -35 %, AZ-305')), ['2000', '3.5', '35', '305']);
});

test('parseJsonLoose_ tolère les blocs ```json', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(gs.parseJsonLoose_('```json\n{"a":1}\n```'))), { a: 1 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(gs.parseJsonLoose_('Voici : {"a":2} merci'))), { a: 2 });
});

test('anonymizeCv_ masque nom, e-mail, téléphone et lien (Option A)', () => {
  const { c1, c2 } = extractionA();
  assert.deepStrictEqual(Array.from(c1.names), ['Julien MARCHAND']);
  assert.deepStrictEqual(Array.from(c2.names), ['Sarah BENALI']);
  for (const [r, bad] of [[c1, ['Julien', 'MARCHAND', 'julien.marchand', '06 12 34 56 78', 'linkedin']], [c2, ['Sarah', 'BENALI', '07 98 76 54 32']]]) {
    bad.forEach(b => assert.ok(!r.text.toLowerCase().includes(b.toLowerCase()), 'fuite : ' + b));
  }
  assert.ok(c1.text.startsWith('Consultant 1'));
  assert.ok(c1.text.includes('Migration de 85 applications'), 'le contenu métier doit être conservé');
});

test('validateScript_ accepte un script B fidèle aux sources', () => {
  const v = gs.validateScript_(fixture('script_B.json'), corpusB(), 'B', [], EXTRA);
  assert.ok(v.ok, v.errors.join(' | '));
  assert.ok(v.stats.words >= 120 && v.stats.words <= 145, 'mots : ' + v.stats.words);
  assert.strictEqual(v.stats.coverage, 100);
  assert.strictEqual(v.script.email_destinataire, 'recrutement@orvane-conseil.example');
});

test('validateScript_ accepte un script A anonymisé', () => {
  const ex = extractionA();
  const v = gs.validateScript_(fixture('script_A.json'), ex.corpus, 'A', ex.names, EXTRA);
  assert.ok(v.ok, v.errors.join(' | '));
  assert.strictEqual(v.stats.coverage, 100);
});

test('validateScript_ rejette un chiffre inventé (hallucination)', () => {
  const s = fixture('script_B.json');
  s.scenes[2].texte_voix_off = s.scenes[2].texte_voix_off.replace('35 %', '50 %');
  const v = gs.validateScript_(s, corpusB(), 'B', [], EXTRA);
  assert.ok(!v.ok);
  assert.ok(v.errors.some(e => e.includes('50')), v.errors.join(' | '));
});

test('validateScript_ rejette une preuve inventée et recalcule la couverture', () => {
  const s = fixture('script_B.json');
  s.adequation[4].preuve = 'Certifiée CISSP depuis plusieurs années';
  s.scenes[1].sources = ['A dirigé une équipe internationale de pentesteurs'];
  s.scenes[3].texte_voix_off += ' Je couvre 100 % de vos exigences.';
  const v = gs.validateScript_(s, corpusB(), 'B', [], EXTRA);
  assert.strictEqual(v.stats.coverage, 80);                       // 4/5 exigences prouvées
  assert.ok(v.errors.some(e => e.includes('aucun extrait source')));
  assert.ok(v.errors.some(e => e.includes('100')), '« 100 % » interdit quand la couverture vérifiée est de 80 %');
});

test('validateScript_ détecte une fuite de nom réel (RGPD Option A)', () => {
  const ex = extractionA();
  const s = fixture('script_A.json');
  s.scenes[1].texte_voix_off = s.scenes[1].texte_voix_off.replace('Le Consultant 1', 'Julien');
  const v = gs.validateScript_(s, ex.corpus, 'A', ex.names, EXTRA);
  assert.ok(v.errors.some(e => e.includes('nominative')), v.errors.join(' | '));
});

test('validateScript_ impose la fenêtre 120-145 mots', () => {
  const s = fixture('script_B.json');
  s.scenes[3].texte_voix_off = 'Vos missions sont au cœur de mon parcours.';
  const v = gs.validateScript_(s, corpusB(), 'B', [], EXTRA);
  assert.ok(v.errors.some(e => e.startsWith('Voix-off')), v.errors.join(' | '));
});

test('les prompts par défaut n\'ont aucune variable non résolue', () => {
  const docs = [{ text: 'D1' }, { text: 'D2' }, { text: 'D3' }];
  const cfg = { calendlyUrl: 'https://calendly.com/demo', esnName: 'Néotek Conseil' };
  gs.defaultPrompts_().forEach(p => {
    const filled = gs.fillTemplate_(p[2], gs.promptVars_(p[0].slice(-1), { docs }, cfg));
    assert.ok(!/\{\{/.test(filled), p[0] + ' contient encore une variable');
    assert.ok(filled.includes('D1') && filled.includes('D3'));
    assert.ok(filled.includes('120') && filled.includes('145'));
  });
});

test('buildDeck_ : une diapositive par scène, zone des sous-titres libre, notes = voix-off', () => {
  for (const [opt, file] of [['A', 'script_A.json'], ['B', 'script_B.json']]) {
    const g = loadGs();
    const corpus = opt === 'B' ? corpusB() : extractionA().corpus;
    const v = g.validateScript_(fixture(file), corpus, opt, [], EXTRA);
    const deck = g.buildDeck_('EXE-TEST', opt, v.script, {}, { calendlyUrl: 'https://calendly.com/demo', contactEmail: 'contact@example.com' });
    const slides = g.__slidesRecord.slides.map(s => s._data).filter(s => !s.removed);
    assert.strictEqual(deck.pages.length, v.script.scenes.length);
    assert.strictEqual(slides.length, v.script.scenes.length);
    slides.forEach((s, i) => {
      assert.strictEqual(s.notes, v.script.scenes[i].texte_voix_off);
      s.shapes.forEach(sh => {
        assert.ok(sh.y + sh.h <= 312 + 0.5, `${opt} diapo ${i + 1} : élément dans la zone des sous-titres (${sh.text || sh.kind}, y+h=${sh.y + sh.h})`);
        assert.ok(sh.x >= 0 && sh.x + sh.w <= 720 + 0.5, `${opt} diapo ${i + 1} : élément hors cadre`);
      });
    });
    fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'out', `deck_${opt}.json`), JSON.stringify({ theme: g.APP.THEMES[opt], slides }, null, 1));
  }
});
