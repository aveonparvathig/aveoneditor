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

function selectAll(canvas: FormulaEditorView): void {
  key(canvas, 'Home');
  key(canvas, 'End', { shiftKey: true });
}

describe('formula canvas: phase 2', () => {
  it('toggles bold and italic with keyboard shortcuts', () => {
    const canvas = createCanvas('ab');
    selectAll(canvas);
    key(canvas, 'b', { ctrlKey: true });
    expect(canvas.getLatex()).toBe('\\mathbf{ab}');
    expect(canvas.getContext().bold).toBe(true);
    key(canvas, 'b', { ctrlKey: true });
    expect(canvas.getLatex()).toBe('ab');
    key(canvas, 'i', { ctrlKey: true });
    expect(canvas.getLatex()).toBe('\\mathrm{ab}');
  });

  it('applies colour, size and display style through style nodes', () => {
    const canvas = createCanvas('x+1');
    selectAll(canvas);
    canvas.applyStyle({ color: 'red' });
    expect(canvas.getLatex()).toBe('\\textcolor{red}{x+1}');
    expect(canvas.getContext().style?.color).toBe('red');
    canvas.applyStyle({ size: 'small' });
    expect(canvas.getLatex()).toBe('\\textcolor{red}{{\\small x+1}}');
    canvas.applyStyle({ color: undefined, size: undefined });
    expect(canvas.getLatex()).toBe('x+1');
  });

  it('combines operators and auto-formats comparisons', () => {
    const canvas = createCanvas();
    type(canvas, 'a<=b');
    expect(canvas.getLatex()).toBe('a\\leq b');
    type(canvas, '->c');
    expect(canvas.getLatex()).toBe('a\\leq b\\rightarrow c');
    canvas.autoformat = false;
    canvas.setLatex('');
    type(canvas, 'x^2');
    expect(canvas.root.children).toHaveLength(3);
    expect(canvas.getLatex()).toBe('x\\^{}2');
  });

  it('copies, cuts and pastes fragments', () => {
    const canvas = createCanvas('\\frac{a}{b}+c');
    key(canvas, 'Home');
    key(canvas, 'ArrowRight', { shiftKey: true });
    expect(canvas.copy(true)).toBe(true);
    expect(canvas.getLatex()).toBe('+c');
    expect(FormulaEditorView.clipboardLatex).toBe('\\frac{a}{b}');
    key(canvas, 'End');
    canvas.paste();
    expect(canvas.getLatex()).toBe('+c\\frac{a}{b}');
    canvas.paste('\\sqrt{2}');
    expect(canvas.getLatex()).toBe('+c\\frac{a}{b}\\sqrt{2}');
  });

  it('edits fences and table attributes from the context', () => {
    const canvas = createCanvas('\\left(x\\right)');
    key(canvas, 'Home');
    key(canvas, 'ArrowRight');
    expect(canvas.getContext().fence).not.toBeNull();
    canvas.setFenceDelimiters('[', null);
    expect(canvas.getLatex()).toBe('\\left[x\\right)');
    canvas.toggleFenceStretchy();
    expect(canvas.getLatex()).toBe('[x)');

    canvas.setLatex('\\begin{pmatrix}1 & 2\\end{pmatrix}');
    key(canvas, 'Home');
    key(canvas, 'ArrowRight');
    canvas.setTableAttributes({ frame: true, rowLines: true });
    canvas.setColumnAlign('left');
    expect(canvas.getLatex()).toBe('\\left(\\begin{array}{|ll|}\\hline 1 & 2 \\\\ \\hline\\end{array}\\right)');
    key(canvas, 'Enter');
    expect(canvas.getCurrentTable()!.table.cells).toHaveLength(2);
  });

  it('nudges a selected structure', () => {
    const canvas = createCanvas('\\sqrt{x}');
    key(canvas, 'End');
    key(canvas, 'ArrowLeft', { shiftKey: true });
    canvas.nudge(0, 0.2);
    expect(canvas.getLatex()).toBe('\\raisebox{0.2em}{$\\sqrt{x}$}');
  });
});

describe('math toolbar: phase 2', () => {
  it('has the phase 2 tabs and contextual sections', () => {
    const canvas = createCanvas('\\left(x\\right)');
    const toolbar = new MathToolbarView(new Locale(), createCatalogue(), canvas);
    toolbar.render();
    document.body.appendChild(toolbar.element!);
    expect(toolbar.tabs.map(tab => tab.id)).toEqual(['general', 'symbols', 'arrows', 'greek', 'matrices', 'layouts', 'decorations', 'operators', 'chemistry', 'contextual']);
    toolbar.activeTab = 'contextual';
    const fenceSection = toolbar.element!.querySelector<HTMLElement>('[data-section="fence-context"]')!;
    expect(fenceSection.hidden).toBe(true);
    key(canvas, 'Home');
    key(canvas, 'ArrowRight');
    expect(fenceSection.hidden).toBe(false);
    const select = fenceSection.querySelector<HTMLSelectElement>('select')!;
    select.value = '[';
    select.dispatchEvent(new Event('change'));
    expect(canvas.getLatex()).toBe('\\left[x\\right)');
  });

  it('applies toolbar customisation', () => {
    const tabs = createCatalogue({ tabs: ['general', 'greek'], removeItems: ['nthRoot'], customButtons: [{ id: 'half', label: 'One half', latex: '\\frac{1}{2}' }, { id: 'power', label: 'Power', latex: '{}^{}' }] });
    expect(tabs.map(tab => tab.id)).toEqual(['general', 'greek']);
    const general = tabs[0];
    expect(general.sections[0].items.map(item => item.id)).toEqual(['fraction', 'squareRoot']);
    const custom = general.sections.find(section => section.id === 'custom-buttons')!;
    expect(custom.items.map(item => item.id)).toEqual(['half', 'power']);
    const canvas = createCanvas('x');
    key(canvas, 'End');
    const power = custom.items[1];
    expect(power.kind).toBe('template');
    if (power.kind === 'template') canvas.insertTemplate(power.build);
    expect(canvas.getLatex()).toBe('x{}^{}');
    expect(canvas.caret.row.slot).toBe('sup');
  });

  it('inserts matrices from the size picker', () => {
    const canvas = createCanvas();
    const toolbar = new MathToolbarView(new Locale(), createCatalogue(), canvas);
    toolbar.render();
    document.body.appendChild(toolbar.element!);
    toolbar.activeTab = 'matrices';
    const picker = toolbar.element!.querySelector<HTMLElement>('.ck-math-toolbar__matrix-picker')!;
    const inputs = picker.querySelectorAll<HTMLInputElement>('input');
    inputs[0].value = '3';
    inputs[1].value = '1';
    picker.querySelector<HTMLSelectElement>('select')!.value = 'bracket';
    picker.querySelector<HTMLElement>('.ck-button')!.click();
    expect(canvas.getLatex()).toBe('\\begin{bmatrix} \\\\  \\\\ \\end{bmatrix}');
  });
});
