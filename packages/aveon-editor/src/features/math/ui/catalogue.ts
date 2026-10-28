/**
 * Toolbar catalogue: tabs → sections → items. Items insert symbols, templates, run actions or
 * expose controls (colour pickers, selects, length inputs, the matrix size picker).
 * `createCatalogue()` applies the `math.toolbar` customisation (remove tabs or items, custom buttons,
 * tab order).
 */

import {
  createAccent,
  createEnclose,
  createFence,
  createFrac,
  createRoot,
  createRow,
  createScript,
  createSpace,
  createTable,
  createToken,
  createXArrow,
  getSlots,
  isStruct,
  type InlineNode,
  type RowNode,
  type StructNode,
  type StyleSize,
  type TableFence
} from '../model/nodes';
import { accentCommands, encloseCommands, greekLetters, symbolsByChar, symbolsByLatex, xarrowCommands } from '../model/symbols';
import { parseLatex } from '../model/latex';
import type { FormulaEditorView, TemplateResult } from './formulaview';
import { commonElements, elementBySymbol } from './periodictable';

export interface SymbolItem {
  kind: 'symbol';
  id: string;
  label: string;
  /** Nodes inserted at the caret. */
  nodes: () => InlineNode[];
  /** Nodes rendered on the button (defaults to `nodes()`). */
  preview?: () => InlineNode[];
}

export interface TemplateItem {
  kind: 'template';
  id: string;
  label: string;
  build: (selected: InlineNode[]) => TemplateResult;
  preview: () => InlineNode[];
}

export interface ActionItem {
  kind: 'action';
  id: string;
  label: string;
  icon?: string;
  text?: string;
  run: (canvas: FormulaEditorView) => void;
  isEnabled?: (canvas: FormulaEditorView) => boolean;
  isOn?: (canvas: FormulaEditorView) => boolean;
}

export interface ColorItem {
  kind: 'color';
  id: string;
  label: string;
  target: 'color' | 'background';
}

export interface SelectItem {
  kind: 'select';
  id: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  get: (canvas: FormulaEditorView) => string;
  set: (canvas: FormulaEditorView, value: string) => void;
}

export interface InputItem {
  kind: 'input';
  id: string;
  label: string;
  placeholder?: string;
  get: (canvas: FormulaEditorView) => string;
  set: (canvas: FormulaEditorView, value: string) => void;
}

export interface MatrixPickerItem {
  kind: 'matrix-picker';
  id: string;
  label: string;
}

export interface PeriodicTableItem {
  kind: 'periodic-table';
  id: string;
  label: string;
}

export type CatalogueItem = SymbolItem | TemplateItem | ActionItem | ColorItem | SelectItem | InputItem | MatrixPickerItem | PeriodicTableItem;

export type SectionContext = 'table' | 'fence' | 'selection' | 'style';

export interface CatalogueSection {
  id: string;
  label: string;
  items: CatalogueItem[];
  /** Shown only in the given caret context. */
  contextual?: SectionContext;
}

export interface CatalogueTab {
  id: string;
  label: string;
  sections: CatalogueSection[];
}

/** `math.toolbar` configuration. */
export interface MathToolbarConfig {
  /** `general` (default) or `chemistry` (chemistry tab first, chemistry typing mode on). */
  preset?: 'general' | 'chemistry';
  /** Show the Publishers tab (display attributes, invisible operators, separators, mspace). Default `false`. */
  publishers?: boolean;
  /** Tab ids to show, in order (default: all). */
  tabs?: string[];
  removeTabs?: string[];
  /** Item ids to remove (see the ids in the catalogue). */
  removeItems?: string[];
  /** Extra buttons: a LaTeX template whose empty `{}` groups become slots. */
  customButtons?: Array<{ id: string; label: string; latex: string; tab?: string; section?: string }>;
}

/* ------------------------------------------------------------------------------------------ */
/* Helpers                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export function latexNodes(latex: string): InlineNode[] {
  const row = parseLatex(latex);
  const nodes = row.children.slice();
  nodes.forEach(node => ((node as any).parent = null));
  row.children.length = 0;
  return nodes;
}

function symbol(char: string, label?: string): SymbolItem {
  const info = symbolsByChar.get(char);
  return {
    kind: 'symbol',
    id: info ? info.latex : char,
    label: label || (info ? info.speech : char),
    nodes: () => [info ? createToken(info.kind, info.char, { latex: info.latex }) : createToken('mo', char)]
  };
}

function latexSymbol(latex: string, label?: string): SymbolItem {
  const info = symbolsByLatex.get(latex);
  return {
    kind: 'symbol',
    id: latex,
    label: label || (info ? info.speech : latex),
    nodes: () => latexNodes(latex)
  };
}

function greek(char: string): SymbolItem {
  const letter = greekLetters.find(l => l.char === char)!;
  return { kind: 'symbol', id: letter.latex, label: letter.speech, nodes: () => [createToken('mi', letter.char, { latex: letter.latex })] };
}

function placeholder(): InlineNode[] {
  return [];
}

function template(id: string, label: string, build: (selected: InlineNode[]) => TemplateResult, preview: () => InlineNode[]): TemplateItem {
  return { kind: 'template', id, label, build, preview };
}

function struct(node: StructNode): TemplateResult {
  return { node };
}

const previewLetter = (text: string) => createToken('mi', text);

/** First empty slot of a structure (depth first), used by custom LaTeX templates. */
function firstEmptySlot(node: StructNode): RowNode | null {
  for (const slot of getSlots(node)) {
    if (slot.children.length === 0) return slot;
    for (const child of slot.children) {
      if (isStruct(child)) {
        const found = firstEmptySlot(child);
        if (found) return found;
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------------------------------ */
/* Templates                                                                                   */
/* ------------------------------------------------------------------------------------------ */

const fraction = template(
  'fraction',
  'Fraction',
  selected => {
    const node = createFrac(selected, []);
    return { node, focus: selected.length ? node.den : node.num };
  },
  () => [createFrac(placeholder(), placeholder())]
);

function fractionVariant(kind: 'dfrac' | 'tfrac' | 'binom' | 'cfrac', id: string, label: string): TemplateItem {
  return template(
    id,
    label,
    selected => {
      const node = createFrac(selected, [], kind);
      return { node, focus: selected.length ? node.den : node.num };
    },
    () => [createFrac(kind === 'binom' ? [previewLetter('n')] : placeholder(), kind === 'binom' ? [previewLetter('k')] : placeholder(), kind)]
  );
}

const squareRoot = template('squareRoot', 'Square root', selected => struct(createRoot(selected)), () => [createRoot(placeholder())]);

const nthRoot = template(
  'nthRoot',
  'Root with index',
  selected => {
    const node = createRoot(selected, []);
    return { node, focus: node.index! };
  },
  () => [createRoot(placeholder(), placeholder())]
);

const superscript = template(
  'superscript',
  'Superscript',
  selected => {
    const node = createScript(selected, null, [], false);
    return { node, focus: selected.length ? node.sup! : node.base };
  },
  () => [createScript(placeholder(), null, placeholder(), false)]
);

const subscript = template(
  'subscript',
  'Subscript',
  selected => {
    const node = createScript(selected, [], null, false);
    return { node, focus: selected.length ? node.sub! : node.base };
  },
  () => [createScript(placeholder(), placeholder(), null, false)]
);

const subsup = template(
  'subsup',
  'Subscript and superscript',
  selected => {
    const node = createScript(selected, [], [], false);
    return { node, focus: selected.length ? node.sub! : node.base };
  },
  () => [createScript(placeholder(), placeholder(), placeholder(), false)]
);

function prescript(sub: boolean, sup: boolean, id: string, label: string): TemplateItem {
  return template(
    id,
    label,
    selected => {
      const node = createScript(selected, sub ? [] : null, sup ? [] : null, false, true);
      return { node, focus: sup ? node.sup! : node.sub! };
    },
    () => [createScript([previewLetter('X')], sub ? placeholder() : null, sup ? placeholder() : null, false, true)]
  );
}

function overUnder(position: 'over' | 'under' | 'both', id: string, label: string): TemplateItem {
  return template(
    id,
    label,
    selected => {
      const node = createScript(selected, position !== 'over' ? [] : null, position !== 'under' ? [] : null, true);
      return { node, focus: position === 'under' ? node.sub! : node.sup! };
    },
    () => [createScript([previewLetter('x')], position !== 'over' ? placeholder() : null, position !== 'under' ? placeholder() : null, true)]
  );
}

function fence(id: string, label: string, open: string, close: string): TemplateItem {
  return template(id, label, selected => struct(createFence(open, close, selected)), () => [createFence(open, close, placeholder())]);
}

function accent(command: string): TemplateItem {
  const def = accentCommands[command];
  return template(command, def.speech, selected => struct(createAccent(selected, def.mark, command, def.position, def.stretchy)), () => [createAccent([previewLetter('x')], def.mark, command, def.position, def.stretchy)]);
}

function braceAnnotation(command: '\\overbrace' | '\\underbrace'): TemplateItem {
  const def = accentCommands[command];
  const over = command === '\\overbrace';
  return template(
    `${command}-label`,
    over ? 'Overbrace with label' : 'Underbrace with label',
    selected => {
      const brace = createAccent(selected, def.mark, command, def.position, def.stretchy);
      const node = createScript([brace], over ? null : [], over ? [] : null, true);
      return { node, focus: over ? node.sup! : node.sub! };
    },
    () => [createScript([createAccent([previewLetter('x'), createToken('mo', '+'), previewLetter('y')], def.mark, command, def.position, def.stretchy)], over ? null : placeholder(), over ? placeholder() : null, true)]
  );
}

function xarrow(command: string, withUnder: boolean): TemplateItem {
  const def = xarrowCommands[command];
  return template(
    `${command}${withUnder ? '-under' : ''}`,
    withUnder ? `${def.speech} with text above and below` : `${def.speech} with text above`,
    selected => {
      const node = createXArrow(def.arrow, command, selected, withUnder ? [] : null);
      return { node, focus: node.over };
    },
    () => [createXArrow(def.arrow, command, placeholder(), withUnder ? placeholder() : null)]
  );
}

function enclosure(command: string, label: string): TemplateItem {
  const notation = encloseCommands[command];
  return template(command, label, selected => struct(createEnclose(selected, notation)), () => [createEnclose([previewLetter('x')], notation)]);
}

function bigOperator(latex: string, label: string, limits: boolean, withLimits: boolean): TemplateItem {
  const makeOp = () => {
    const info = symbolsByLatex.get(latex)!;
    return createToken(info.kind, info.char, { latex: info.latex, largeop: true });
  };
  return template(
    `${latex}${withLimits ? '-limits' : ''}`,
    withLimits ? `${label} with limits` : label,
    selected => {
      const node = createScript([makeOp()], withLimits ? [] : null, withLimits ? [] : null, limits);
      if (selected.length) {
        selected.forEach(n => ((n as any).parent = null));
        node.base.children.push(...selected);
        selected.forEach(n => ((n as any).parent = node.base));
      }
      return { node, focus: withLimits ? node.sub! : node.base };
    },
    () => [createScript([makeOp()], withLimits ? placeholder() : null, withLimits ? placeholder() : null, limits)]
  );
}

function limit(): TemplateItem {
  return template(
    'lim',
    'Limit',
    () => {
      const node = createScript([createToken('mi', 'lim', { variant: 'normal', latex: '\\lim', largeop: true })], [], null, true);
      return { node, focus: node.sub! };
    },
    () => [createScript([createToken('mi', 'lim', { variant: 'normal', latex: '\\lim', largeop: true })], placeholder(), null, true)]
  );
}

function derivative(partial: boolean): TemplateItem {
  const d = () => (partial ? createToken('mi', '∂', { latex: '\\partial' }) : createToken('mi', 'd', { variant: 'normal', latex: '\\mathrm{d}' }));
  return template(
    partial ? 'partial-derivative' : 'derivative',
    partial ? 'Partial derivative' : 'Derivative',
    selected => {
      const node = createFrac([d(), ...selected], [d(), createToken('mi', 'x')]);
      return { node, focus: node.num };
    },
    () => [createFrac([d(), previewLetter('y')], [d(), previewLetter('x')])]
  );
}

function matrix(rows: number, columns: number, fenceType: TableFence, label: string): TemplateItem {
  return template(`matrix-${rows}x${columns}-${fenceType}`, label, () => struct(createTable(rows, columns, fenceType)), () => [createTable(rows, columns, fenceType)]);
}

function identity(size: number): TemplateItem {
  const build = () => {
    const table = createTable(size, size, 'paren');
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) table.cells[r][c].children.push(Object.assign(createToken('mn', r === c ? '1' : '0'), { parent: table.cells[r][c] }));
    return table;
  };
  return template(`identity-${size}`, `${size}×${size} identity matrix`, () => struct(build()), () => [build()]);
}

function functionItem(name: string): SymbolItem {
  return { kind: 'symbol', id: `\\${name}`, label: name, nodes: () => [createToken('mi', name, { variant: 'normal', latex: `\\${name}` })] };
}

function spaceItem(latex: string, width: number, label: string, previewText: string): SymbolItem {
  return { kind: 'symbol', id: latex, label, nodes: () => [createSpace(width, latex)], preview: () => [createToken('mtext', previewText)] };
}

const textItem: ActionItem = { kind: 'action', id: 'text', label: 'Text', text: 'Tt', run: canvas => canvas.toggleText(), isOn: canvas => canvas.textMode };

const sizeOptions: Array<{ value: StyleSize | ''; label: string }> = [
  { value: '', label: 'Size' },
  { value: 'tiny', label: 'Tiny' },
  { value: 'scriptsize', label: 'Script size' },
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
  { value: 'Large', label: 'Larger' },
  { value: 'huge', label: 'Huge' }
];

const formattingItems: CatalogueItem[] = [
  { kind: 'action', id: 'bold', label: 'Bold', text: 'B', run: canvas => canvas.toggleVariant('bold'), isEnabled: canvas => canvas.hasSelection, isOn: canvas => canvas.getContext().bold },
  { kind: 'action', id: 'italic', label: 'Italic', text: 'I', run: canvas => canvas.toggleVariant('italic'), isEnabled: canvas => canvas.hasSelection, isOn: canvas => canvas.getContext().italic },
  { kind: 'color', id: 'color', label: 'Text colour', target: 'color' },
  { kind: 'color', id: 'background', label: 'Background colour', target: 'background' },
  {
    kind: 'select',
    id: 'size',
    label: 'Size',
    options: sizeOptions,
    get: canvas => canvas.getContext().style?.size || '',
    set: (canvas, value) => canvas.applyStyle({ size: (value || undefined) as StyleSize | undefined })
  },
  {
    kind: 'action',
    id: 'displaystyle',
    label: 'Display style',
    text: '∑↕',
    run: canvas => {
      const style = canvas.getContext().style;
      canvas.applyStyle({ displaystyle: style && style.displaystyle ? undefined : true });
    },
    isEnabled: canvas => canvas.hasSelection || !!canvas.getContext().style,
    isOn: canvas => !!canvas.getContext().style?.displaystyle
  }
];

/** Upright chemical element symbol. */
export function elementToken(symbolText: string): InlineNode {
  return createToken('mi', symbolText, { variant: 'normal', latex: `\\mathrm{${symbolText}}` });
}

function elementItem(symbolText: string): SymbolItem {
  const element = elementBySymbol.get(symbolText);
  return { kind: 'symbol', id: `element-${symbolText}`, label: element ? `${element.name} (${symbolText})` : symbolText, nodes: () => [elementToken(symbolText)] };
}

function stateItem(state: string, label: string): SymbolItem {
  return { kind: 'symbol', id: `state-${state}`, label, nodes: () => latexNodes(`(\\mathrm{${state}})`), preview: () => latexNodes(`(\\mathrm{${state}})`) };
}

function chargeItem(charge: string, label: string): TemplateItem {
  return template(
    `charge-${charge}`,
    label,
    selected => {
      const node = createScript(selected, null, latexNodes(charge === '+' || charge === '-' ? (charge === '+' ? '+' : '-') : charge), false);
      return { node, focus: selected.length ? node.sup! : node.base };
    },
    () => [createScript([elementToken('X')], null, latexNodes(charge === '+' ? '+' : charge === '-' ? '-' : charge), false)]
  );
}

const isotopeItem = template(
  'isotope',
  'Isotope (mass and atomic number)',
  selected => {
    const node = createScript(selected, [], [], false, true);
    return { node, focus: node.sup! };
  },
  () => [createScript([elementToken('C')], latexNodes('6'), latexNodes('14'), false, true)]
);

const chemistryModeItem: ActionItem = {
  kind: 'action',
  id: 'chemistry-mode',
  label: 'Chemistry typing (upright element symbols)',
  text: 'Ch',
  run: canvas => {
    canvas.chemistryMode = !canvas.chemistryMode;
  },
  isOn: canvas => canvas.chemistryMode
};

function buildChemistryTab(): CatalogueTab {
  return {
    id: 'chemistry',
    label: 'Chemistry',
    sections: [
      { id: 'chem-mode', label: 'Mode', items: [chemistryModeItem] },
      { id: 'elements', label: 'Common elements', items: commonElements.map(elementItem) },
      { id: 'periodic', label: 'Periodic table', items: [{ kind: 'periodic-table', id: 'periodic-table', label: 'Periodic table' }] },
      { id: 'chem-scripts', label: 'Subscripts and charges', items: [subscript, chargeItem('+', 'Positive charge'), chargeItem('-', 'Negative charge'), chargeItem('2+', 'Double positive charge'), chargeItem('2-', 'Double negative charge'), chargeItem('3+', 'Triple positive charge'), isotopeItem] },
      { id: 'states', label: 'States of matter', items: [stateItem('s', 'Solid'), stateItem('l', 'Liquid'), stateItem('g', 'Gas'), stateItem('aq', 'Aqueous')] },
      { id: 'reactions', label: 'Reaction arrows', items: [symbol('→', 'Yields'), symbol('⇌', 'Equilibrium'), symbol('⇄', 'Reversible'), symbol('←', 'Reverse'), symbol('↑', 'Gas evolved'), symbol('↓', 'Precipitate'), xarrow('\\xrightarrow', false), xarrow('\\xrightarrow', true), xarrow('\\xrightleftharpoons', false)] },
      { id: 'bonds', label: 'Bonds and misc', items: [symbol('−', 'Single bond'), symbol('=', 'Double bond'), symbol('≡', 'Triple bond'), symbol('⋅', 'Hydrate dot'), { kind: 'symbol', id: 'delta', label: 'Heat (delta)', nodes: () => latexNodes('\\Delta') }, { kind: 'symbol', id: 'electron', label: 'Electron', nodes: () => latexNodes('\\mathrm{e}^{-}') }, { kind: 'symbol', id: 'radical', label: 'Radical', nodes: () => latexNodes('\\cdot') }]
      }
    ]
  };
}

function arithmetic(kind: 'add' | 'subtract' | 'multiply', label: string): TemplateItem {
  const op = kind === 'add' ? '+' : kind === 'subtract' ? '−' : '×';
  const build = (digits: [string, string, string] | null) => {
    const table = createTable(3, 2, 'none', digits ? [[[], latexNodes(digits[0])], [latexNodes(op), latexNodes(digits[1])], [[], latexNodes(digits[2])]] : undefined);
    if (!digits) {
      table.cells[1][0].children.push(Object.assign(createToken('mo', op, { latex: op === '−' ? '-' : op === '×' ? '\\times' : '+' }), { parent: table.cells[1][0] }));
    }
    table.columnAlign = ['right', 'right'];
    table.lineBelow = [1];
    return table;
  };
  return template(`arith-${kind}`, label, () => {
    const node = build(null);
    return { node, focus: node.cells[0][1] };
  }, () => [build(['12', '34', '46'])]);
}

const longDivision = template(
  'long-division',
  'Long division',
  () => {
    const node = createTable(2, 2, 'none');
    node.columnAlign = ['right', 'left'];
    node.lineBelow = [0];
    node.cells[1][0].children.push(Object.assign(createToken('mo', ')', { latex: ')' }), { parent: node.cells[1][0] }));
    return { node, focus: node.cells[1][1] };
  },
  () => {
    const node = createTable(2, 2, 'none', [[[], latexNodes('12')], [latexNodes('7)'), latexNodes('84')]]);
    node.columnAlign = ['right', 'left'];
    node.lineBelow = [0];
    return [node];
  }
);

const carryItem = template(
  'carry',
  'Carry digit',
  selected => {
    const node = createScript(selected, null, [], false, true);
    return { node, focus: node.sup! };
  },
  () => [createScript([createToken('mn', '4')], null, [createToken('mn', '1')], false, true)]
);

const relationAlignItem: ActionItem = {
  kind: 'action',
  id: 'relation-align',
  label: 'Align lines at the relation sign',
  text: '=|',
  run: canvas => canvas.alignAtRelation(),
  isEnabled: canvas => !!canvas.getCurrentTable()
};

function buildPublishersTab(): CatalogueTab {
  return {
    id: 'publishers',
    label: 'Publishers',
    sections: [
      { id: 'display', label: 'Equation display', items: [formattingItems[5]] },
      {
        id: 'invisible',
        label: 'Invisible operators',
        items: [
          { kind: 'symbol', id: 'invisible-times', label: 'Invisible times', nodes: () => [createToken('mo', '\u2062', { latex: '{}' })], preview: () => [createToken('mtext', '×̸')] },
          { kind: 'symbol', id: 'apply-function', label: 'Function application', nodes: () => [createToken('mo', '\u2061', { latex: '{}' })], preview: () => [createToken('mtext', 'ƒ()')] },
          { kind: 'symbol', id: 'invisible-comma', label: 'Invisible separator', nodes: () => [createToken('mo', '\u2063', { latex: '{}' })], preview: () => [createToken('mtext', ',̸')] }
        ]
      },
      { id: 'separators', label: 'Number separators', items: [spaceItem('\\,', 0.17, 'Thin space between digit groups', '1␣000'), { kind: 'symbol', id: 'decimal-comma', label: 'Decimal comma', nodes: () => [createToken('mn', ',', { latex: '{,}' })] }] },
      { id: 'monospace', label: 'Monospace variants', items: [{ kind: 'symbol', id: 'mathtt-x', label: 'Monospace letter', nodes: () => [createToken('mi', 'x', { variant: 'monospace' })] }] },
      { id: 'mspace', label: 'Space dimensions', items: [{ kind: 'input', id: 'mspace-width', label: 'Insert space of width', placeholder: '1em', get: () => '', set: (canvas, value) => { if (value) canvas.insertNodes([createSpace(parseFloat(value) || 0, `\\hspace{${value}}`)]); } }] }
    ]
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Tabs                                                                                        */
/* ------------------------------------------------------------------------------------------ */

const fenceOptions = [
  { value: '', label: 'None' },
  { value: '(', label: '(' },
  { value: ')', label: ')' },
  { value: '[', label: '[' },
  { value: ']', label: ']' },
  { value: '{', label: '{' },
  { value: '}', label: '}' },
  { value: '|', label: '|' },
  { value: '‖', label: '‖' },
  { value: '⟨', label: '⟨' },
  { value: '⟩', label: '⟩' },
  { value: '⌊', label: '⌊' },
  { value: '⌋', label: '⌋' },
  { value: '⌈', label: '⌈' },
  { value: '⌉', label: '⌉' }
];

function buildDefaultTabs(): CatalogueTab[] {
  return [
    {
      id: 'general',
      label: 'General',
      sections: [
        { id: 'fractions', label: 'Fractions and roots', items: [fraction, squareRoot, nthRoot] },
        { id: 'scripts', label: 'Scripts', items: [superscript, subscript, subsup] },
        {
          id: 'fences',
          label: 'Paired fences',
          items: [fence('parens', 'Parentheses', '(', ')'), fence('brackets', 'Brackets', '[', ']'), fence('braces', 'Braces', '{', '}'), fence('bars', 'Absolute value', '|', '|'), fence('norm', 'Norm', '‖', '‖'), fence('angles', 'Angle brackets', '⟨', '⟩'), fence('floor', 'Floor', '⌊', '⌋'), fence('ceil', 'Ceiling', '⌈', '⌉')]
        },
        { id: 'common', label: 'Common symbols', items: ['+', '−', '±', '×', '÷', '⋅', '=', '≠', '<', '>', '≤', '≥', '∞', 'π'].map(ch => (ch === 'π' ? greek('π') : symbol(ch))) },
        { id: 'accents', label: 'Accents', items: [accent('\\hat'), accent('\\bar'), accent('\\vec'), accent('\\dot'), accent('\\tilde'), accent('\\overline')] },
        { id: 'formatting', label: 'Formatting', items: formattingItems },
        {
          id: 'editing',
          label: 'Editing',
          items: [
            { kind: 'action', id: 'undo', label: 'Undo', text: '↶', run: canvas => canvas.undo(), isEnabled: canvas => canvas.canUndo },
            { kind: 'action', id: 'redo', label: 'Redo', text: '↷', run: canvas => canvas.redo(), isEnabled: canvas => canvas.canRedo },
            { kind: 'action', id: 'cut', label: 'Cut', text: '✂', run: canvas => canvas.copy(true), isEnabled: canvas => canvas.hasSelection },
            { kind: 'action', id: 'copy', label: 'Copy', text: '⧉', run: canvas => canvas.copy(false), isEnabled: canvas => canvas.hasSelection },
            { kind: 'action', id: 'paste', label: 'Paste', text: '📋', run: canvas => canvas.paste() },
            textItem,
            spaceItem('\\,', 0.17, 'Thin space', '␣')
          ]
        }
      ]
    },
    {
      id: 'symbols',
      label: 'Symbols',
      sections: [
        { id: 'arithmetic', label: 'Arithmetic', items: ['+', '−', '±', '∓', '×', '÷', '⋅', '∘', '∗', '⋆', '∖', '!', '%'].map(ch => symbol(ch)) },
        { id: 'relations', label: 'Relations', items: ['=', '≠', '≈', '≡', '≃', '≅', '∼', '∝', '<', '>', '≤', '≥', '≪', '≫', '≺', '≻', '∣', '∤', '∥', '⊥', '≐', '≔'].map(ch => symbol(ch)) },
        { id: 'sets', label: 'Sets', items: ['∈', '∉', '∋', '⊂', '⊃', '⊆', '⊇', '∪', '∩', '∅', 'ℕ', 'ℤ', 'ℚ', 'ℝ', 'ℂ'].map(ch => symbol(ch)) },
        { id: 'logic', label: 'Logic', items: ['¬', '∧', '∨', '⊕', '⊗', '⊙', '∀', '∃', '∄', '∴', '∵', '⊢', '⊨', '⊤'].map(ch => symbol(ch)) },
        { id: 'geometry', label: 'Geometry and shapes', items: ['∠', '∡', '△', '□', '◇', '○', '∥', '⊥', '°', '′', '″'].map(ch => symbol(ch)) },
        { id: 'misc', label: 'Miscellaneous', items: ['∞', '∂', '∇', '…', '⋯', '⋮', '⋱', 'ħ', 'ℓ', 'ℵ', 'ℜ', 'ℑ', '∁', '℘'].map(ch => symbol(ch)) }
      ]
    },
    {
      id: 'arrows',
      label: 'Arrows',
      sections: [
        { id: 'arrows', label: 'Arrows', items: ['→', '←', '↔', '⇒', '⇐', '⇔', '⟶', '⟵', '⟷', '⟹', '⟸', '⟺', '↦', '⟼', '↑', '↓', '↕', '⇑', '⇓', '⇕', '↗', '↘', '↖', '↙', '↪', '↩', '↠', '↞', '⇝', '⤳', '↶', '↷'].map(ch => symbol(ch)) },
        { id: 'harpoons', label: 'Harpoons', items: ['⇀', '⇁', '↼', '↽', '⇌', '⇄', '⇆'].map(ch => symbol(ch)) },
        { id: 'dots', label: 'Dots', items: ['…', '⋯', '⋮', '⋱'].map(ch => symbol(ch)) },
        { id: 'labelled', label: 'Labelled arrows', items: [xarrow('\\xrightarrow', false), xarrow('\\xrightarrow', true), xarrow('\\xleftarrow', false), xarrow('\\xleftarrow', true), xarrow('\\xleftrightarrow', false), xarrow('\\xRightarrow', false), xarrow('\\xLeftarrow', false), xarrow('\\xLeftrightarrow', false), xarrow('\\xmapsto', false), xarrow('\\xrightleftharpoons', false), xarrow('\\xlongequal', false)] },
        { id: 'arrow-accents', label: 'Arrow and bar accents', items: [accent('\\vec'), accent('\\overrightarrow'), accent('\\overleftarrow'), accent('\\overleftrightarrow'), accent('\\underrightarrow'), accent('\\underleftarrow'), accent('\\underleftrightarrow'), accent('\\overline'), accent('\\underline'), accent('\\bar')] }
      ]
    },
    {
      id: 'greek',
      label: 'Greek',
      sections: [
        { id: 'lowercase', label: 'Lowercase', items: greekLetters.filter(l => l.char === l.char.toLowerCase()).map(l => greek(l.char)) },
        { id: 'uppercase', label: 'Uppercase', items: greekLetters.filter(l => l.char !== l.char.toLowerCase()).map(l => greek(l.char)) },
        {
          id: 'letterlike',
          label: 'Letter styles',
          items: [
            { kind: 'symbol', id: 'mathbb', label: 'Double-struck letter', nodes: () => [createToken('mi', 'A', { variant: 'double-struck' })], preview: () => [createToken('mi', '𝔸', { variant: 'double-struck' })] },
            { kind: 'symbol', id: 'mathcal', label: 'Script letter', nodes: () => [createToken('mi', 'A', { variant: 'script' })], preview: () => [createToken('mi', '𝒜', { variant: 'script' })] },
            { kind: 'symbol', id: 'mathfrak', label: 'Fraktur letter', nodes: () => [createToken('mi', 'A', { variant: 'fraktur' })], preview: () => [createToken('mi', '𝔄', { variant: 'fraktur' })] },
            { kind: 'symbol', id: 'mathbf', label: 'Bold letter', nodes: () => [createToken('mi', 'A', { variant: 'bold' })], preview: () => [createToken('mi', 'A', { variant: 'bold' })] },
            { kind: 'symbol', id: 'mathsf', label: 'Sans-serif letter', nodes: () => [createToken('mi', 'A', { variant: 'sans-serif' })], preview: () => [createToken('mi', 'A', { variant: 'sans-serif' })] },
            { kind: 'symbol', id: 'mathtt', label: 'Monospace letter', nodes: () => [createToken('mi', 'A', { variant: 'monospace' })], preview: () => [createToken('mi', 'A', { variant: 'monospace' })] }
          ]
        },
        { id: 'numerals', label: 'Numeral systems', items: [latexSymbol('\\infty'), { kind: 'symbol', id: 'roman', label: 'Roman numeral', nodes: () => [createToken('mi', 'X', { variant: 'normal' })], preview: () => [createToken('mi', 'Ⅹ', { variant: 'normal' })] }, { kind: 'symbol', id: 'binary', label: 'Binary subscript', nodes: () => latexNodes('_{2}'), preview: () => latexNodes('1_{2}') }, { kind: 'symbol', id: 'hex', label: 'Hexadecimal subscript', nodes: () => latexNodes('_{16}'), preview: () => latexNodes('F_{16}') }] }
      ]
    },
    {
      id: 'matrices',
      label: 'Matrices',
      sections: [
        { id: 'custom', label: 'Custom matrix', items: [{ kind: 'matrix-picker', id: 'matrix-picker', label: 'Insert matrix' }] },
        {
          id: 'predefined',
          label: 'Matrices',
          items: [matrix(2, 2, 'paren', '2×2 matrix'), matrix(3, 3, 'paren', '3×3 matrix'), matrix(2, 2, 'bracket', '2×2 matrix with brackets'), matrix(3, 3, 'bracket', '3×3 matrix with brackets'), matrix(2, 2, 'bar', '2×2 determinant'), matrix(3, 3, 'bar', '3×3 determinant'), matrix(2, 1, 'paren', 'Column vector'), matrix(1, 2, 'paren', 'Row vector'), matrix(2, 2, 'none', 'Plain 2×2 table'), identity(2), identity(3)]
        },
        { id: 'piecewise', label: 'Piecewise and multiline', items: [matrix(2, 2, 'cases', 'Piecewise function'), matrix(3, 2, 'cases', 'Piecewise function, 3 cases'), matrix(2, 1, 'none', 'Two-line equation'), matrix(3, 1, 'none', 'Three-line equation'), relationAlignItem] },
        { id: 'arithmetic', label: 'Elementary arithmetic', items: [arithmetic('add', 'Stacked addition'), arithmetic('subtract', 'Stacked subtraction'), arithmetic('multiply', 'Stacked multiplication'), longDivision, carryItem] },
        { id: 'dots', label: 'Dots', items: ['…', '⋯', '⋮', '⋱'].map(ch => symbol(ch)) },
        {
          id: 'table-context',
          label: 'Rows and columns',
          contextual: 'table',
          items: [
            { kind: 'action', id: 'row-above', label: 'Insert row above', text: '⤒', run: canvas => canvas.tableInsertRow('above') },
            { kind: 'action', id: 'row-below', label: 'Insert row below', text: '⤓', run: canvas => canvas.tableInsertRow('below') },
            { kind: 'action', id: 'column-left', label: 'Insert column left', text: '⇤', run: canvas => canvas.tableInsertColumn('left') },
            { kind: 'action', id: 'column-right', label: 'Insert column right', text: '⇥', run: canvas => canvas.tableInsertColumn('right') },
            { kind: 'action', id: 'remove-row', label: 'Delete row', text: '⊟', run: canvas => canvas.tableRemoveRow() },
            { kind: 'action', id: 'remove-column', label: 'Delete column', text: '⊠', run: canvas => canvas.tableRemoveColumn() }
          ]
        }
      ]
    },
    {
      id: 'layouts',
      label: 'Scripts and layouts',
      sections: [
        { id: 'fraction-variants', label: 'Fraction variants', items: [fraction, fractionVariant('dfrac', 'dfrac', 'Display-size fraction'), fractionVariant('tfrac', 'tfrac', 'Text-size fraction'), fractionVariant('cfrac', 'cfrac', 'Continued fraction'), fractionVariant('binom', 'binom', 'Binomial coefficient')] },
        { id: 'roots', label: 'Roots', items: [squareRoot, nthRoot] },
        { id: 'right-scripts', label: 'Right scripts', items: [superscript, subscript, subsup] },
        { id: 'left-scripts', label: 'Left scripts', items: [prescript(false, true, 'presup', 'Left superscript'), prescript(true, false, 'presub', 'Left subscript'), prescript(true, true, 'presubsup', 'Left subscript and superscript')] },
        { id: 'above-below', label: 'Content above and below', items: [overUnder('over', 'overset', 'Content above'), overUnder('under', 'underset', 'Content below'), overUnder('both', 'overunder', 'Content above and below')] },
        { id: 'brace-annotations', label: 'Brace annotations', items: [accent('\\overbrace'), accent('\\underbrace'), braceAnnotation('\\overbrace'), braceAnnotation('\\underbrace')] },
        { id: 'operator-layouts', label: 'Generic big-operator layouts', items: [bigOperator('\\sum', 'Sum', true, true), bigOperator('\\int', 'Integral', false, true), overUnder('both', 'operator-limits', 'Operator with limits')] },
        { id: 'spacing', label: 'Spacing', items: [spaceItem('\\!', -0.17, 'Negative thin space', '⁃'), spaceItem('\\,', 0.17, 'Thin space', '␣'), spaceItem('\\:', 0.22, 'Medium space', '␣␣'), spaceItem('\\;', 0.28, 'Thick space', '␣␣␣'), spaceItem('\\quad', 1, 'Quad space', '⎵'), spaceItem('\\qquad', 2, 'Double quad space', '⎵⎵')] }
      ]
    },
    {
      id: 'decorations',
      label: 'Decorations',
      sections: [
        {
          id: 'fences',
          label: 'Fences',
          items: [fence('parens', 'Parentheses', '(', ')'), fence('brackets', 'Brackets', '[', ']'), fence('braces', 'Braces', '{', '}'), fence('bars', 'Absolute value', '|', '|'), fence('norm', 'Norm', '‖', '‖'), fence('angles', 'Angle brackets', '⟨', '⟩'), fence('floor', 'Floor', '⌊', '⌋'), fence('ceil', 'Ceiling', '⌈', '⌉'), fence('open-paren', 'Left parenthesis only', '(', ''), fence('close-paren', 'Right parenthesis only', '', ')'), fence('left-brace', 'Left brace only', '{', ''), fence('mixed', 'Half-open interval', '(', ']')]
        },
        { id: 'bars-braces', label: 'Bars and braces', items: [accent('\\overline'), accent('\\underline'), accent('\\overbrace'), accent('\\underbrace'), accent('\\overgroup'), accent('\\undergroup'), accent('\\overlinesegment'), accent('\\underlinesegment')] },
        { id: 'accents', label: 'Accents', items: ['\\hat', '\\widehat', '\\bar', '\\vec', '\\tilde', '\\widetilde', '\\dot', '\\ddot', '\\dddot', '\\breve', '\\check', '\\acute', '\\grave', '\\mathring'].map(accent) },
        { id: 'enclosures', label: 'Enclosures', items: [enclosure('\\boxed', 'Box')] },
        { id: 'crossing-out', label: 'Crossing-out marks', items: [enclosure('\\cancel', 'Cancel (up diagonal)'), enclosure('\\bcancel', 'Cancel (down diagonal)'), enclosure('\\xcancel', 'Cross out'), enclosure('\\sout', 'Strike through')] }
      ]
    },
    {
      id: 'operators',
      label: 'Big operators',
      sections: [
        { id: 'sums', label: 'Sums and products', items: [bigOperator('\\sum', 'Sum', true, true), bigOperator('\\sum', 'Sum', true, false), bigOperator('\\prod', 'Product', true, true), bigOperator('\\prod', 'Product', true, false), bigOperator('\\coprod', 'Coproduct', true, true), bigOperator('\\bigcup', 'Union', true, true), bigOperator('\\bigcap', 'Intersection', true, true), bigOperator('\\bigoplus', 'Direct sum', true, true), bigOperator('\\bigotimes', 'Tensor product', true, true), bigOperator('\\bigvee', 'Logical or', true, true), bigOperator('\\bigwedge', 'Logical and', true, true)] },
        { id: 'integrals', label: 'Integrals', items: [bigOperator('\\int', 'Integral', false, true), bigOperator('\\int', 'Integral', false, false), bigOperator('\\iint', 'Double integral', false, false), bigOperator('\\iiint', 'Triple integral', false, false), bigOperator('\\oint', 'Contour integral', false, true)] },
        { id: 'calculus', label: 'Calculus', items: [limit(), derivative(false), derivative(true), latexSymbol('\\nabla', 'Nabla'), latexSymbol('\\partial', 'Partial'), latexSymbol('\\infty', 'Infinity')] },
        { id: 'functions', label: 'Functions', items: ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp', 'max', 'min', 'det', 'gcd'].map(functionItem) }
      ]
    },
    {
      id: 'contextual',
      label: 'Contextual',
      sections: [
        {
          id: 'table-structure',
          label: 'Matrix rows and columns',
          contextual: 'table',
          items: [
            { kind: 'action', id: 'ctx-row-above', label: 'Insert row above', text: '⤒', run: canvas => canvas.tableInsertRow('above') },
            { kind: 'action', id: 'ctx-row-below', label: 'Insert row below', text: '⤓', run: canvas => canvas.tableInsertRow('below') },
            { kind: 'action', id: 'ctx-column-left', label: 'Insert column left', text: '⇤', run: canvas => canvas.tableInsertColumn('left') },
            { kind: 'action', id: 'ctx-column-right', label: 'Insert column right', text: '⇥', run: canvas => canvas.tableInsertColumn('right') },
            { kind: 'action', id: 'ctx-remove-row', label: 'Delete row', text: '⊟', run: canvas => canvas.tableRemoveRow() },
            { kind: 'action', id: 'ctx-remove-column', label: 'Delete column', text: '⊠', run: canvas => canvas.tableRemoveColumn() }
          ]
        },
        {
          id: 'table-lines',
          label: 'Frames and lines',
          contextual: 'table',
          items: [
            { kind: 'action', id: 'table-frame', label: 'Outer frame', text: '▣', run: canvas => canvas.setTableAttributes({ frame: !canvas.getCurrentTable()!.table.frame }), isOn: canvas => !!canvas.getCurrentTable()?.table.frame },
            { kind: 'action', id: 'table-rowlines', label: 'Lines between rows', text: '☰', run: canvas => canvas.setTableAttributes({ rowLines: !canvas.getCurrentTable()!.table.rowLines }), isOn: canvas => !!canvas.getCurrentTable()?.table.rowLines },
            { kind: 'action', id: 'table-columnlines', label: 'Lines between columns', text: '∥', run: canvas => canvas.setTableAttributes({ columnLines: !canvas.getCurrentTable()!.table.columnLines }), isOn: canvas => !!canvas.getCurrentTable()?.table.columnLines },
            { kind: 'action', id: 'table-equal-rows', label: 'Equal row heights', text: '⇕', run: canvas => canvas.setTableAttributes({ equalRows: !canvas.getCurrentTable()!.table.equalRows }), isOn: canvas => !!canvas.getCurrentTable()?.table.equalRows },
            { kind: 'action', id: 'table-equal-columns', label: 'Equal column widths', text: '⇔', run: canvas => canvas.setTableAttributes({ equalColumns: !canvas.getCurrentTable()!.table.equalColumns }), isOn: canvas => !!canvas.getCurrentTable()?.table.equalColumns }
          ]
        },
        {
          id: 'table-alignment',
          label: 'Alignment',
          contextual: 'table',
          items: [
            { kind: 'action', id: 'align-left', label: 'Align cells left', text: '⇤≡', run: canvas => canvas.setColumnAlign('left'), isOn: canvas => (canvas.getCurrentTable()?.table.columnAlign || []).every(a => a === 'left') && !!canvas.getCurrentTable()?.table.columnAlign },
            { kind: 'action', id: 'align-center', label: 'Align cells center', text: '≡', run: canvas => canvas.setColumnAlign('center'), isOn: canvas => !canvas.getCurrentTable()?.table.columnAlign },
            { kind: 'action', id: 'align-right', label: 'Align cells right', text: '≡⇥', run: canvas => canvas.setColumnAlign('right'), isOn: canvas => (canvas.getCurrentTable()?.table.columnAlign || []).every(a => a === 'right') && !!canvas.getCurrentTable()?.table.columnAlign },
            { kind: 'action', id: 'align-column-left', label: 'Align this column left', text: '⇤', run: canvas => canvas.setColumnAlign('left', canvas.getCurrentTable()!.c) },
            { kind: 'action', id: 'align-column-right', label: 'Align this column right', text: '⇥', run: canvas => canvas.setColumnAlign('right', canvas.getCurrentTable()!.c) },
            {
              kind: 'select',
              id: 'row-align',
              label: 'Row alignment',
              options: [{ value: '', label: 'Rows: baseline' }, { value: 'top', label: 'Rows: top' }, { value: 'center', label: 'Rows: center' }, { value: 'bottom', label: 'Rows: bottom' }, { value: 'axis', label: 'Rows: axis' }],
              get: canvas => canvas.getCurrentTable()?.table.rowAlign || '',
              set: (canvas, value) => canvas.setTableAttributes({ rowAlign: (value || undefined) as any })
            },
            {
              kind: 'select',
              id: 'table-baseline',
              label: 'Baseline position',
              options: [{ value: '', label: 'Baseline: middle' }, { value: 'baseline', label: 'Baseline: baseline' }, { value: 'top', label: 'Baseline: top' }, { value: 'bottom', label: 'Baseline: bottom' }, { value: 'axis', label: 'Baseline: axis' }],
              get: canvas => canvas.getCurrentTable()?.table.align || '',
              set: (canvas, value) => canvas.setTableAttributes({ align: (value || undefined) as any })
            }
          ]
        },
        {
          id: 'table-spacing',
          label: 'Spacing',
          contextual: 'table',
          items: [
            { kind: 'input', id: 'column-spacing', label: 'Column spacing', placeholder: '0.8em', get: canvas => canvas.getCurrentTable()?.table.columnSpacing || '', set: (canvas, value) => canvas.setTableAttributes({ columnSpacing: value || undefined }) },
            { kind: 'input', id: 'row-spacing', label: 'Row spacing', placeholder: '0.2em', get: canvas => canvas.getCurrentTable()?.table.rowSpacing || '', set: (canvas, value) => canvas.setTableAttributes({ rowSpacing: value || undefined }) }
          ]
        },
        {
          id: 'fence-context',
          label: 'Fences',
          contextual: 'fence',
          items: [
            { kind: 'select', id: 'fence-open', label: 'Opening delimiter', options: fenceOptions.map(o => ({ ...o, label: o.value ? `Open: ${o.label}` : 'Open: none' })), get: canvas => canvas.getContext().fence?.open || '', set: (canvas, value) => canvas.setFenceDelimiters(value, null) },
            { kind: 'select', id: 'fence-close', label: 'Closing delimiter', options: fenceOptions.map(o => ({ ...o, label: o.value ? `Close: ${o.label}` : 'Close: none' })), get: canvas => canvas.getContext().fence?.close || '', set: (canvas, value) => canvas.setFenceDelimiters(null, value) },
            { kind: 'action', id: 'fence-stretchy', label: 'Stretch delimiters to content', text: '⟮⟯', run: canvas => canvas.toggleFenceStretchy(), isOn: canvas => canvas.getContext().fence?.stretchy !== false }
          ]
        },
        {
          id: 'selection-context',
          label: 'Selected element',
          contextual: 'selection',
          items: [
            { kind: 'action', id: 'nudge-up', label: 'Move up', text: '△', run: canvas => canvas.nudge(0, 0.1) },
            { kind: 'action', id: 'nudge-down', label: 'Move down', text: '▽', run: canvas => canvas.nudge(0, -0.1) },
            { kind: 'action', id: 'nudge-left', label: 'Move left', text: '◁', run: canvas => canvas.nudge(-0.1, 0) },
            { kind: 'action', id: 'nudge-right', label: 'Move right', text: '▷', run: canvas => canvas.nudge(0.1, 0) },
            { kind: 'action', id: 'space-before', label: 'Add space before', text: '⇤␣', run: canvas => canvas.insertTemplate(selected => ({ node: Object.assign(createFence('', '', [createSpace(0.28, '\\;'), ...selected], false), {}) })) },
            ...formattingItems
          ]
        }
      ]
    }
  ];
}

/* ------------------------------------------------------------------------------------------ */
/* Customisation                                                                               */
/* ------------------------------------------------------------------------------------------ */

function customButton(definition: { id: string; label: string; latex: string }): TemplateItem | SymbolItem {
  const nodes = latexNodes(definition.latex);
  const structure = nodes.length === 1 && isStruct(nodes[0]) ? (nodes[0] as StructNode) : null;
  if (structure && firstEmptySlot(structure)) {
    return template(
      definition.id,
      definition.label,
      selected => {
        const node = latexNodes(definition.latex)[0] as StructNode;
        const slot = firstEmptySlot(node)!;
        selected.forEach(n => ((n as any).parent = slot));
        slot.children.push(...selected);
        return { node, focus: slot };
      },
      () => latexNodes(definition.latex)
    );
  }
  return { kind: 'symbol', id: definition.id, label: definition.label, nodes: () => latexNodes(definition.latex) };
}

export function createCatalogue(config: MathToolbarConfig = {}): CatalogueTab[] {
  let tabs = buildDefaultTabs();
  if (config.preset === 'chemistry') tabs = [buildChemistryTab(), ...tabs];
  else tabs.splice(tabs.findIndex(tab => tab.id === 'operators') + 1, 0, buildChemistryTab());
  if (config.publishers) tabs.push(buildPublishersTab());
  if (config.removeTabs) tabs = tabs.filter(tab => !config.removeTabs!.includes(tab.id));
  if (config.tabs) {
    const byId = new Map(tabs.map(tab => [tab.id, tab]));
    tabs = config.tabs.map(id => byId.get(id)).filter((tab): tab is CatalogueTab => !!tab);
  }
  if (config.removeItems) {
    const removed = new Set(config.removeItems);
    for (const tab of tabs) {
      for (const section of tab.sections) section.items = section.items.filter(item => !removed.has(item.id));
      tab.sections = tab.sections.filter(section => section.items.length);
    }
  }
  for (const definition of config.customButtons || []) {
    const tab = tabs.find(t => t.id === (definition.tab || 'general')) || tabs[0];
    if (!tab) continue;
    let section = definition.section ? tab.sections.find(s => s.id === definition.section) : null;
    if (!section) {
      section = tab.sections.find(s => s.id === 'custom-buttons');
      if (!section) {
        section = { id: 'custom-buttons', label: 'Custom', items: [] };
        tab.sections.push(section);
      }
    }
    section.items.push(customButton(definition));
  }
  return tabs.filter(tab => tab.sections.length);
}

export { createRow as _createRow };
