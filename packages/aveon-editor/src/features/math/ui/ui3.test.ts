import { describe, it, expect } from 'vitest';
import { FormulaEditorView } from './formulaview';
import { MathToolbarView } from './mathtoolbarview';
import { createCatalogue } from './catalogue';
import { createBasicRecognizer, isScribble, type Stroke } from './handwriting/recognizer';
import { HandwritingView } from './handwriting/handwritingview';
import { periodicTable, splitElementSymbols } from './periodictable';
import { toSpeech, addSpeechDictionary } from '../model/speech';
import { parseLatex, toLatex } from '../model/latex';
import { toMathML, parseMathML, domToMathMLLike } from '../model/mathml';
import { Locale } from '../../../utils/locale';

function createCanvas(latex = ''): FormulaEditorView {
  const canvas = new FormulaEditorView(new Locale());
  canvas.render();
  document.body.appendChild(canvas.element!);
  canvas.setLatex(latex);
  return canvas;
}

function key(canvas: FormulaEditorView, key: string, init: KeyboardEventInit = {}): void {
  canvas.element!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

function type(canvas: FormulaEditorView, text: string): void {
  for (const ch of text) key(canvas, ch);
}

/** Straight-line stroke between points. */
function line(x1: number, y1: number, x2: number, y2: number, steps = 20): Stroke {
  return Array.from({ length: steps + 1 }, (_, i) => ({ x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps, t: i }));
}

function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps = 32): Stroke {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a), t: i };
  });
}

describe('chemistry', () => {
  it('lists the periodic table and splits formulas into element symbols', () => {
    expect(periodicTable).toHaveLength(118);
    expect(periodicTable[0].symbol).toBe('H');
    expect(periodicTable[117].symbol).toBe('Og');
    expect(splitElementSymbols('NaCl')).toEqual(['Na', 'Cl']);
    expect(splitElementSymbols('H2O')).toBeNull();
  });

  it('types upright element symbols in chemistry mode', () => {
    const canvas = createCanvas();
    canvas.chemistryMode = true;
    type(canvas, 'NaCl');
    expect(canvas.getLatex()).toBe('\\mathrm{Na}\\mathrm{Cl}');
    type(canvas, '_2');
    expect(canvas.getLatex()).toBe('\\mathrm{Na}\\mathrm{Cl}_{2}');
  });

  it('offers the chemistry tab and preset', () => {
    const tabs = createCatalogue();
    expect(tabs.map(tab => tab.id)).toContain('chemistry');
    const chemistryFirst = createCatalogue({ preset: 'chemistry' });
    expect(chemistryFirst[0].id).toBe('chemistry');
    const canvas = createCanvas();
    const toolbar = new MathToolbarView(new Locale(), chemistryFirst, canvas);
    toolbar.render();
    document.body.appendChild(toolbar.element!);
    const elements = toolbar.element!.querySelectorAll('.ck-math-toolbar__element');
    expect(elements).toHaveLength(118);
    (elements[25] as HTMLElement).click();
    expect(canvas.getLatex()).toBe('\\mathrm{Fe}');
    const states = toolbar.element!.querySelector<HTMLElement>('[data-section="states"] .ck-button')!;
    states.click();
    expect(canvas.getLatex()).toBe('\\mathrm{Fe}(\\mathrm{s})');
  });
});

describe('arithmetic layouts and publishers tab', () => {
  it('inserts stacked arithmetic with a line below the operands', () => {
    const canvas = createCanvas();
    const tabs = createCatalogue();
    const matrices = tabs.find(tab => tab.id === 'matrices')!;
    const add = matrices.sections.find(section => section.id === 'arithmetic')!.items[0];
    if (add.kind === 'template') canvas.insertTemplate(add.build);
    type(canvas, '12');
    key(canvas, 'ArrowDown');
    type(canvas, '34');
    key(canvas, 'ArrowDown');
    type(canvas, '46');
    const latex = canvas.getLatex();
    expect(latex).toBe('\\begin{array}{rr} & 12 \\\\ + & 34 \\\\ \\hline  & 46\\end{array}');
    const reparsed = parseLatex(latex).children[0] as any;
    expect(reparsed.lineBelow).toEqual([1]);
    expect(toMathML(parseLatex(latex))).toContain('rowlines="none solid"');
    const tree = parseMathML(domToMathMLLike(new DOMParser().parseFromString(toMathML(parseLatex(latex)), 'text/html').body.firstElementChild!));
    expect(toLatex(tree)).toBe(latex);
  });

  it('aligns multiline equations at the relation sign', () => {
    const canvas = createCanvas('\\begin{matrix}x+1=2 \\\\ 2x=4\\end{matrix}');
    key(canvas, 'Home');
    key(canvas, 'ArrowRight');
    canvas.alignAtRelation();
    expect(canvas.getLatex()).toBe('\\begin{array}{rl}x+1 & =2 \\\\ 2x & =4\\end{array}');
  });

  it('shows the publishers tab on request', () => {
    expect(createCatalogue().map(tab => tab.id)).not.toContain('publishers');
    const tabs = createCatalogue({ publishers: true });
    expect(tabs[tabs.length - 1].id).toBe('publishers');
  });
});

describe('speech languages', () => {
  it('describes formulas in Spanish, French and German', () => {
    const half = parseLatex('\\frac{1}{2}+\\sqrt{x}=y^2');
    expect(toSpeech(half, 'es')).toBe('1 medio más raíz cuadrada de x igual a y al cuadrado');
    expect(toSpeech(half, 'fr')).toBe('1 demi plus racine carrée de x égale y au carré');
    expect(toSpeech(half, 'de')).toBe('1 Halb plus Quadratwurzel aus x gleich y Quadrat');
    expect(toSpeech(half, 'en-US')).toBe('1 half plus the square root of x equals y squared');
  });

  it('accepts registered dictionaries', () => {
    addSpeechDictionary('xx', { over: '{num} OVER {den}', symbols: { '+': 'PLUS' } });
    expect(toSpeech(parseLatex('\\frac{a}{b}+c'), 'xx')).toBe('a OVER b PLUS c');
  });
});

describe('handwriting', () => {
  it('recognises simple symbols and layouts', () => {
    const recognizer = createBasicRecognizer();
    const one = recognizer.recognize([line(50, 10, 50, 60)]) as any;
    expect(one.latex).toBe('1');
    const plus = recognizer.recognize([line(100, 35, 140, 35), line(120, 15, 120, 55)]) as any;
    expect(plus.latex).toBe('+');
    const seven = recognizer.recognize([[...line(10, 10, 50, 10), ...line(50, 10, 25, 60)]]) as any;
    expect(seven.latex).toBe('7');
    const fraction = recognizer.recognize([line(100, 20, 100, 50), line(80, 60, 120, 60), line(100, 70, 100, 100)]) as any;
    expect(fraction.latex).toBe('\\frac{1}{1}');
    const squared = recognizer.recognize([line(100, 30, 100, 80), line(120, 10, 120, 30)]) as any;
    expect(squared.latex).toBe('1^{1}');
    const zero = recognizer.recognize([arc(50, 50, 20, 30, -90, 270)]) as any;
    expect(['0', 'o']).toContain(zero.latex);
  });

  it('detects deletion scribbles', () => {
    const scribble: Stroke = [];
    for (let i = 0; i < 40; i++) scribble.push({ x: 20 + (i % 2 === 0 ? 0 : 60) + i, y: 30 + (i % 3), t: i });
    expect(isScribble(scribble)).toBe(true);
    expect(isScribble(line(0, 0, 100, 0))).toBe(false);
  });

  it('renders the handwriting view and reports recognised LaTeX', async () => {
    const view = new HandwritingView(new Locale(), { recognitionDelay: 0 });
    view.render();
    document.body.appendChild(view.element!);
    expect(view.element!.querySelector('canvas')).not.toBeNull();
    let recognised = '';
    view.on('recognized', (evt, result: { latex: string }) => (recognised = result.latex));
    view.setStrokes([line(50, 10, 50, 60)]);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(recognised).toBe('1');
    expect(view.latex).toBe('1');
    view.undo();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(view.strokes).toHaveLength(0);
    view.redo();
    expect(view.strokes).toHaveLength(1);
  });
});

describe('locale conventions and direction', () => {
  it('types a decimal comma and renders right-to-left', () => {
    const canvas = createCanvas();
    canvas.decimalSeparator = ',';
    type(canvas, '3.5');
    expect(canvas.getLatex()).toBe('3{,}5');
    canvas.direction = 'rtl';
    canvas.rerender();
    expect(canvas.element!.querySelector('.mf-root')!.getAttribute('dir')).toBe('rtl');
  });
});
