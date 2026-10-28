import { describe, it, expect } from 'vitest';
import { FormulaEditorView } from './formulaview';
import { MathToolbarView } from './mathtoolbarview';
import { createCatalogue } from './catalogue';
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

describe('formula canvas', () => {
  it('types tokens, scripts and fractions', () => {
    const canvas = createCanvas();
    type(canvas, 'x^2');
    expect(canvas.getLatex()).toBe('x^{2}');
    key(canvas, 'ArrowRight');
    type(canvas, '+1/2');
    expect(canvas.getLatex()).toBe('x^{2}+\\frac{1}{2}');
    type(canvas, 'y');
    expect(canvas.getLatex()).toBe('x^{2}+\\frac{1}{2y}');
  });

  it('navigates through slots with arrow keys', () => {
    const canvas = createCanvas('\\frac{a}{b}c');
    key(canvas, 'Home');
    expect(canvas.caret.row).toBe(canvas.root);
    key(canvas, 'ArrowRight');
    expect(canvas.caret.row.slot).toBe('num');
    key(canvas, 'ArrowDown');
    expect(canvas.caret.row.slot).toBe('den');
    key(canvas, 'ArrowUp');
    expect(canvas.caret.row.slot).toBe('num');
    key(canvas, 'ArrowRight');
    key(canvas, 'ArrowRight');
    expect(canvas.caret.row.slot).toBe('den');
    key(canvas, 'ArrowRight');
    key(canvas, 'ArrowRight');
    expect(canvas.caret.row).toBe(canvas.root);
    expect(canvas.caret.offset).toBe(1);
  });

  it('smart-deletes structures in two steps and undoes', () => {
    const canvas = createCanvas('a\\sqrt{x}');
    key(canvas, 'End');
    key(canvas, 'Backspace');
    expect(canvas.hasSelection).toBe(true);
    expect(canvas.getLatex()).toBe('a\\sqrt{x}');
    key(canvas, 'Backspace');
    expect(canvas.getLatex()).toBe('a');
    key(canvas, 'z', { ctrlKey: true });
    expect(canvas.getLatex()).toBe('a\\sqrt{x}');
    key(canvas, 'y', { ctrlKey: true });
    expect(canvas.getLatex()).toBe('a');
  });

  it('wraps a selection into a template', () => {
    const canvas = createCanvas('a+b');
    key(canvas, 'Home');
    key(canvas, 'ArrowRight', { shiftKey: true });
    key(canvas, 'ArrowRight', { shiftKey: true });
    key(canvas, 'ArrowRight', { shiftKey: true });
    expect(canvas.getSelectedNodes()).toHaveLength(3);
    canvas.insertFraction();
    expect(canvas.getLatex()).toBe('\\frac{a+b}{}');
    expect(canvas.caret.row.slot).toBe('den');
  });

  it('auto-pairs fences and leaves them on the closing delimiter', () => {
    const canvas = createCanvas();
    type(canvas, '(a)');
    expect(canvas.getLatex()).toBe('\\left(a\\right)');
    expect(canvas.caret.row).toBe(canvas.root);
    type(canvas, 'b');
    expect(canvas.getLatex()).toBe('\\left(a\\right)b');
  });

  it('inserts text in text mode and script slots with Ctrl+arrows', () => {
    const canvas = createCanvas('x');
    key(canvas, 'End');
    key(canvas, 'ArrowDown', { ctrlKey: true });
    type(canvas, 'i');
    expect(canvas.getLatex()).toBe('x_{i}');
    key(canvas, 'ArrowRight');
    canvas.toggleText();
    type(canvas, ' if');
    expect(canvas.getLatex()).toBe('x_{i}\\text{ if}');
  });

  it('edits matrices', () => {
    const canvas = createCanvas('\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}');
    key(canvas, 'Home');
    key(canvas, 'ArrowRight');
    expect(canvas.getCurrentTable()).not.toBeNull();
    canvas.tableInsertRow('below');
    type(canvas, '5');
    expect(canvas.getLatex()).toBe('\\begin{pmatrix}1 & 2 \\\\ 5 &  \\\\ 3 & 4\\end{pmatrix}');
    canvas.tableInsertColumn('right');
    canvas.tableRemoveColumn();
    canvas.tableRemoveRow();
    expect(canvas.getLatex()).toBe('\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}');
  });
});

describe('math toolbar', () => {
  it('renders the phase 1 tabs and inserts items', () => {
    const canvas = createCanvas();
    const toolbar = new MathToolbarView(new Locale(), createCatalogue(), canvas);
    toolbar.render();
    document.body.appendChild(toolbar.element!);
    expect(toolbar.tabs.map(tab => tab.id)).toEqual(['general', 'symbols', 'arrows', 'greek', 'matrices', 'layouts', 'decorations', 'operators', 'chemistry', 'contextual']);
    const fraction = toolbar.element!.querySelector<HTMLElement>('[data-section="fractions"] .ck-button')!;
    fraction.click();
    expect(canvas.getLatex()).toBe('\\frac{}{}');
    toolbar.activeTab = 'greek';
    const alpha = toolbar.element!.querySelector<HTMLElement>('[data-section="lowercase"] .ck-button')!;
    alpha.click();
    expect(canvas.getLatex()).toBe('\\frac{\\alpha}{}');
    toolbar.activeTab = 'operators';
    const sum = toolbar.element!.querySelector<HTMLElement>('[data-section="sums"] .ck-button')!;
    sum.click();
    expect(canvas.getLatex()).toBe('\\frac{\\alpha\\sum_{}^{}}{}');
  });

  it('shows the matrix context section only inside tables', () => {
    const canvas = createCanvas('\\begin{pmatrix}1 & 2\\end{pmatrix}');
    const toolbar = new MathToolbarView(new Locale(), createCatalogue(), canvas);
    toolbar.render();
    document.body.appendChild(toolbar.element!);
    toolbar.activeTab = 'matrices';
    const section = toolbar.element!.querySelector<HTMLElement>('[data-contextual="table"]')!;
    expect(section.hidden).toBe(true);
    key(canvas, 'Home');
    key(canvas, 'ArrowRight');
    expect(section.hidden).toBe(false);
  });
});
