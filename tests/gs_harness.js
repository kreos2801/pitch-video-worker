/**
 * Banc de test : charge les fichiers .gs dans un contexte Node isolé (vm) avec des
 * doublures minimales des services Google (SlidesApp, DriveApp…) pour tester la logique
 * pure (validation, anonymisation, prompts) et la mise en page des diapositives.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GS_DIR = path.join(__dirname, '..', 'apps-script');

function makeSlidesMock(record) {
  let counter = 0;
  const textRange = (shape) => {
    const style = {};
    const api = {
      setFontFamily(v) { style.font = v; return api; }, setFontSize(v) { style.size = v; return api; },
      setBold(v) { style.bold = v; return api; }, setForegroundColor(v) { style.color = v; return api; }
    };
    shape.style = style;
    return {
      getTextStyle: () => api,
      getParagraphStyle: () => ({ setParagraphAlignment(a) { shape.align = a; } }),
      setText(t) { shape.text = t; }
    };
  };
  const newSlide = () => {
    const slide = { id: 'p' + (++counter), bg: null, shapes: [], notes: '', removed: false };
    const shapeApi = (shape) => ({
      getFill: () => ({ setSolidFill(c) { shape.fill = c; } }),
      getBorder: () => ({ setTransparent() { shape.border = 'none'; } }),
      getText: () => textRange(shape),
      setContentAlignment(a) { shape.valign = a; }
    });
    return {
      _data: slide,
      getObjectId: () => slide.id,
      remove() { slide.removed = true; },
      getBackground: () => ({ setSolidFill(c) { slide.bg = c; } }),
      insertShape(type, x, y, w, h) { const s = { kind: type, x, y, w, h }; slide.shapes.push(s); return shapeApi(s); },
      insertTextBox(text, x, y, w, h) { const s = { kind: 'TEXT', x, y, w, h, text }; slide.shapes.push(s); const a = shapeApi(s); a.getText().setText(text); return a; },
      getNotesPage: () => ({ getSpeakerNotesShape: () => ({ getText: () => ({ setText(t) { slide.notes = t; } }) }) })
    };
  };
  return {
    PredefinedLayout: { BLANK: 'BLANK' },
    ShapeType: { RECTANGLE: 'RECT', ROUND_RECTANGLE: 'ROUND', ELLIPSE: 'ELLIPSE' },
    ParagraphAlignment: { CENTER: 'CENTER' },
    ContentAlignment: { MIDDLE: 'MIDDLE', TOP: 'TOP' },
    create(name) {
      const slides = [newSlide()];
      record.name = name;
      record.slides = slides;
      return {
        getId: () => 'PRES_ID',
        getSlides: () => slides.slice(),
        appendSlide() { const s = newSlide(); slides.push(s); return s; },
        saveAndClose() {}
      };
    }
  };
}

function loadGs(extraGlobals = {}) {
  const record = {};
  const context = {
    console: { log() {} },
    SlidesApp: makeSlidesMock(record),
    DriveApp: { getFileById: () => ({ moveTo() {} }) },
    ...extraGlobals
  };
  vm.createContext(context);
  const code = fs.readdirSync(GS_DIR).filter(f => f.endsWith('.gs')).sort()
    .map(f => fs.readFileSync(path.join(GS_DIR, f), 'utf8')).join('\n');
  vm.runInContext(code, context, { filename: 'apps-script.gs' });
  context.__slidesRecord = record;
  return context;
}

module.exports = { loadGs };
