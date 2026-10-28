/**
 * WYSIWYG formula canvas: renders the formula tree to DOM slots and owns the caret, the selection,
 * keyboard editing (navigation, smart delete, autoformat, script shortcuts, formatting, clipboard)
 * and undo/redo.
 */

import { View } from '../../../ui/view';
import type { Locale } from '../../../utils/locale';
import {
  createFence,
  createFrac,
  createRow,
  createScript,
  createStyle,
  createToken,
  fromJSON,
  getCellCoordinates,
  getPrimarySlot,
  getRootRow,
  getRowPath,
  getSlots,
  indexOf,
  insertChild,
  insertChildren,
  isStruct,
  removeChild,
  renumberTable,
  resolveRowPath,
  toJSON,
  walkTokens,
  type FenceNode,
  type FormulaNode,
  type InlineNode,
  type NodeJSON,
  type Position,
  type RowNode,
  type ScriptNode,
  type StructNode,
  type StyleNode,
  type StyleSize,
  type TableNode,
  type TokenNode,
  type Variant
} from '../model/nodes';
import { parseLatex, rowToLatex, toLatex } from '../model/latex';
import { sizeScale, symbolsByChar } from '../model/symbols';

export interface TemplateResult {
  node: StructNode;
  /** Slot that receives the caret (defaults to the primary slot). */
  focus?: RowNode;
}

export type TemplateFactory = (selected: InlineNode[]) => TemplateResult;

interface Snapshot {
  json: NodeJSON;
  caretPath: Array<number | string>;
  caretOffset: number;
}

/** What the caret is inside of; drives the contextual toolbar. */
export interface CanvasContext {
  table: { table: TableNode; r: number; c: number } | null;
  fence: FenceNode | null;
  style: StyleNode | null;
  /** The single structure selected as a whole, if any. */
  selectedNode: InlineNode | null;
  bold: boolean;
  italic: boolean;
}

const MAX_HISTORY = 200;

/** Converts a typed character into a token. */
export function charToToken(ch: string): TokenNode {
  if (/[0-9]/.test(ch)) return createToken('mn', ch);
  if (/[a-zA-Z]/.test(ch)) return createToken('mi', ch);
  if (ch === '-') return createToken('mo', '−', { latex: '-' });
  if (ch === '*') return createToken('mo', '⋅', { latex: '\\cdot' });
  if (ch === "'") return createToken('mo', '′', { latex: "'" });
  if (ch === '^') return createToken('mo', '^', { latex: '\\^{}' });
  if (ch === '_') return createToken('mo', '_', { latex: '\\_' });
  const info = symbolsByChar.get(ch);
  if (info) return createToken(info.kind, info.char, { latex: info.latex });
  return createToken(ch.trim() ? 'mo' : 'mtext', ch);
}

/* ------------------------------------------------------------------------------------------ */
/* Rendering                                                                                   */
/* ------------------------------------------------------------------------------------------ */

interface RenderContext {
  doc: Document;
  nodeElements: Map<FormulaNode, HTMLElement>;
  elementNodes: WeakMap<HTMLElement, FormulaNode>;
  caret: Position | null;
  selected: Set<InlineNode>;
}

function el(ctx: RenderContext, className: string, node?: FormulaNode): HTMLElement {
  const element = ctx.doc.createElement('span');
  element.className = className;
  if (node) {
    ctx.nodeElements.set(node, element);
    ctx.elementNodes.set(element, node);
  }
  return element;
}

function renderRow(row: RowNode, ctx: RenderContext): HTMLElement {
  const element = el(ctx, 'mf-row', row);
  const caretHere = ctx.caret && ctx.caret.row === row;
  if (row.children.length === 0) {
    const slot = el(ctx, 'mf-slot-empty');
    element.appendChild(slot);
    if (caretHere) element.appendChild(renderCaret(ctx));
    return element;
  }
  row.children.forEach((child, index) => {
    if (caretHere && ctx.caret!.offset === index) element.appendChild(renderCaret(ctx));
    const childElement = renderInline(child, ctx);
    if (ctx.selected.has(child)) childElement.classList.add('mf-selected');
    element.appendChild(childElement);
  });
  if (caretHere && ctx.caret!.offset === row.children.length) element.appendChild(renderCaret(ctx));
  return element;
}

function renderCaret(ctx: RenderContext): HTMLElement {
  const caret = el(ctx, 'mf-caret');
  caret.setAttribute('aria-hidden', 'true');
  return caret;
}

function renderInline(node: InlineNode, ctx: RenderContext): HTMLElement {
  switch (node.type) {
    case 'token': {
      const classes = ['mf-tok', `mf-${node.kind}`];
      const info = symbolsByChar.get(node.text);
      if (node.raw) classes.push('mf-raw');
      else if (node.kind === 'mo' && info && info.spacing && info.spacing !== 'none') classes.push(`mf-${info.spacing}`);
      if (node.kind === 'mi' && (node.text.length > 1 || (node.variant && node.variant !== 'italic' && node.variant !== 'bold-italic'))) classes.push('mf-upright');
      if (node.variant) classes.push(`mf-variant-${node.variant}`);
      if (node.largeop) classes.push('mf-largeop');
      const element = el(ctx, classes.join(' '), node);
      element.textContent = node.text;
      return element;
    }
    case 'space': {
      const element = el(ctx, 'mf-space', node);
      element.style.width = `${Math.max(node.width, 0)}em`;
      return element;
    }
    case 'frac': {
      const element = el(ctx, `mf-frac${node.kind === 'binom' ? ' mf-binom' : ''}${node.kind === 'tfrac' ? ' mf-tfrac' : ''}`, node);
      const num = el(ctx, 'mf-num');
      num.appendChild(renderRow(node.num, ctx));
      const den = el(ctx, 'mf-den');
      den.appendChild(renderRow(node.den, ctx));
      element.append(num, den);
      if (node.kind === 'binom') {
        const wrapper = el(ctx, 'mf-fence');
        const open = el(ctx, 'mf-delim');
        open.textContent = '(';
        const close = el(ctx, 'mf-delim');
        close.textContent = ')';
        const body = el(ctx, 'mf-fence-body');
        body.appendChild(element);
        wrapper.append(open, body, close);
        ctx.nodeElements.set(node, wrapper);
        ctx.elementNodes.set(wrapper, node);
        return wrapper;
      }
      return element;
    }
    case 'root': {
      const element = el(ctx, 'mf-root', node);
      if (node.index) {
        const index = el(ctx, 'mf-root-index');
        index.appendChild(renderRow(node.index, ctx));
        element.appendChild(index);
      }
      const sign = el(ctx, 'mf-radical');
      sign.textContent = '√';
      const base = el(ctx, 'mf-radicand');
      base.appendChild(renderRow(node.base, ctx));
      element.append(sign, base);
      return element;
    }
    case 'script': {
      const element = el(ctx, node.limits ? 'mf-script mf-limits' : node.prescript ? 'mf-script mf-prescript' : 'mf-script', node);
      const base = el(ctx, 'mf-base');
      base.appendChild(renderRow(node.base, ctx));
      if (node.limits) {
        if (node.sup) {
          const sup = el(ctx, 'mf-over');
          sup.appendChild(renderRow(node.sup, ctx));
          element.appendChild(sup);
        }
        element.appendChild(base);
        if (node.sub) {
          const sub = el(ctx, 'mf-under');
          sub.appendChild(renderRow(node.sub, ctx));
          element.appendChild(sub);
        }
        return element;
      }
      const scripts = el(ctx, 'mf-scripts');
      if (node.sup) {
        const sup = el(ctx, 'mf-sup');
        sup.appendChild(renderRow(node.sup, ctx));
        scripts.appendChild(sup);
      }
      if (node.sub) {
        const sub = el(ctx, 'mf-sub');
        sub.appendChild(renderRow(node.sub, ctx));
        scripts.appendChild(sub);
      }
      if (node.prescript) element.append(scripts, base);
      else element.append(base, scripts);
      return element;
    }
    case 'accent': {
      const element = el(ctx, `mf-accent mf-accent-${node.position}${node.stretchy ? ' mf-stretchy' : ''}`, node);
      const mark = el(ctx, 'mf-accent-mark');
      mark.textContent = node.mark;
      const base = el(ctx, 'mf-accent-base');
      base.appendChild(renderRow(node.base, ctx));
      if (node.position === 'over') element.append(mark, base);
      else element.append(base, mark);
      return element;
    }
    case 'fence': {
      const element = el(ctx, `mf-fence${node.stretchy === false ? ' mf-fence-fixed' : ''}`, node);
      const open = el(ctx, 'mf-delim');
      open.textContent = node.open;
      const body = el(ctx, 'mf-fence-body');
      body.appendChild(renderRow(node.body, ctx));
      const close = el(ctx, 'mf-delim');
      close.textContent = node.close;
      element.append(open, body, close);
      return element;
    }
    case 'table': {
      const element = el(ctx, `mf-table mf-table-${node.fence}`, node);
      const open = el(ctx, 'mf-delim');
      const close = el(ctx, 'mf-delim');
      const [o, c] = tableDelims(node);
      open.textContent = o;
      close.textContent = c;
      const grid = el(ctx, 'mf-grid');
      const columns = node.cells[0] ? node.cells[0].length : 1;
      grid.style.gridTemplateColumns = `repeat(${columns}, auto)`;
      if (node.frame) grid.classList.add('mf-grid-frame');
      if (node.rowLines) grid.classList.add('mf-grid-rowlines');
      if (node.columnLines) grid.classList.add('mf-grid-columnlines');
      if (node.columnSpacing) grid.style.columnGap = node.columnSpacing;
      if (node.rowSpacing) grid.style.rowGap = node.rowSpacing;
      if (node.equalColumns) grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
      if (node.equalRows) grid.style.gridAutoRows = '1fr';
      node.cells.forEach((row, r) => {
        row.forEach((cell, ci) => {
          const cellElement = el(ctx, 'mf-cell');
          const align = node.columnAlign ? node.columnAlign[Math.min(ci, node.columnAlign.length - 1)] : node.fence === 'cases' ? 'left' : 'center';
          cellElement.style.textAlign = align;
          if (node.rowAlign) cellElement.style.alignSelf = node.rowAlign === 'top' ? 'start' : node.rowAlign === 'bottom' ? 'end' : node.rowAlign === 'center' ? 'center' : 'baseline';
          cellElement.appendChild(renderRow(cell, ctx));
          grid.appendChild(cellElement);
          void r;
        });
      });
      element.append(open, grid, close);
      if (node.align) element.style.verticalAlign = node.align === 'axis' ? 'middle' : node.align;
      return element;
    }
    case 'style': {
      const element = el(ctx, 'mf-style', node);
      if (node.color) element.style.color = node.color;
      if (node.background) element.style.backgroundColor = node.background;
      if (node.size) element.style.fontSize = `${sizeScale[node.size]}em`;
      if (node.displaystyle !== undefined) element.classList.add(node.displaystyle ? 'mf-displaystyle' : 'mf-textstyle');
      if (node.voffset) element.style.position = 'relative';
      if (node.voffset) element.style.top = `${-node.voffset}em`;
      if (node.hspace) element.style.marginLeft = `${node.hspace}em`;
      element.appendChild(renderRow(node.body, ctx));
      return element;
    }
    case 'enclose': {
      const element = el(ctx, `mf-enclose mf-enclose-${node.notation}`, node);
      element.appendChild(renderRow(node.body, ctx));
      return element;
    }
    case 'xarrow': {
      const element = el(ctx, 'mf-xarrow', node);
      const over = el(ctx, 'mf-over');
      over.appendChild(renderRow(node.over, ctx));
      const arrow = el(ctx, 'mf-xarrow-mark');
      arrow.textContent = node.arrow;
      element.append(over, arrow);
      if (node.under) {
        const under = el(ctx, 'mf-under');
        under.appendChild(renderRow(node.under, ctx));
        element.appendChild(under);
      }
      return element;
    }
  }
}

function tableDelims(table: TableNode): [string, string] {
  switch (table.fence) {
    case 'paren':
      return ['(', ')'];
    case 'bracket':
      return ['[', ']'];
    case 'brace':
      return ['{', '}'];
    case 'bar':
      return ['|', '|'];
    case 'double-bar':
      return ['‖', '‖'];
    case 'cases':
      return ['{', ''];
    default:
      return ['', ''];
  }
}

/** Stretches delimiters and radical signs to the height of their content (needs layout). */
function adjustStretchy(container: HTMLElement): void {
  const stretch = (delim: HTMLElement, body: HTMLElement) => {
    const bodyHeight = body.getBoundingClientRect().height;
    delim.style.transform = '';
    const natural = delim.getBoundingClientRect().height;
    if (!bodyHeight || !natural) return;
    const scale = Math.max(1, bodyHeight / natural);
    if (scale > 1.05) delim.style.transform = `scaleY(${scale.toFixed(3)})`;
  };
  for (const fence of Array.from(container.querySelectorAll<HTMLElement>('.mf-fence:not(.mf-fence-fixed), .mf-table'))) {
    const body = fence.querySelector<HTMLElement>(':scope > .mf-fence-body, :scope > .mf-grid');
    const delims = fence.querySelectorAll<HTMLElement>(':scope > .mf-delim');
    if (body) delims.forEach(delim => stretch(delim, body));
  }
  for (const root of Array.from(container.querySelectorAll<HTMLElement>('.mf-root'))) {
    const body = root.querySelector<HTMLElement>(':scope > .mf-radicand');
    const sign = root.querySelector<HTMLElement>(':scope > .mf-radical');
    if (body && sign) stretch(sign, body);
  }
}

/** Renders nodes read-only (toolbar previews). */
export function renderStatic(nodes: InlineNode[], doc: Document = document): HTMLElement {
  const ctx: RenderContext = { doc, nodeElements: new Map(), elementNodes: new WeakMap(), caret: null, selected: new Set() };
  const row = createRow(nodes.map(node => fromJSON(toJSON(node)) as InlineNode));
  const element = renderRow(row, ctx);
  element.classList.add('mf-static');
  return element;
}

/* ------------------------------------------------------------------------------------------ */
/* Editor view                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** Clipboard shared by all canvases in the page (the system clipboard only gets LaTeX text). */
let internalClipboard: { latex: string; json: NodeJSON[] } | null = null;

export class FormulaEditorView extends View {
  declare public element: HTMLDivElement | null;
  public root: RowNode = createRow();
  public caret: Position = { row: this.root, offset: 0 };
  /** Selection anchor (same row as the caret) or `null` when collapsed. */
  public anchor: Position | null = null;
  /** When on, typed characters become upright text (`\text{}`) instead of math tokens. */
  declare public textMode: boolean;
  /** Autoformat shortcuts (`/`, `^`, `_`, `<=`, brackets). */
  public autoformat = true;
  /** Chemistry typing: letters become upright element symbols (two-letter symbols are merged). */
  declare public chemistryMode: boolean;
  /** Character inserted for the decimal point (`.` or `,`). */
  public decimalSeparator = '.';
  /** Text direction of the formula (`rtl` for Arabic notation). */
  public direction: 'ltr' | 'rtl' = 'ltr';
  private _surface: HTMLElement | null = null;
  private _nodeElements = new Map<FormulaNode, HTMLElement>();
  private _elementNodes = new WeakMap<HTMLElement, FormulaNode>();
  private _undoStack: Snapshot[] = [];
  private _redoStack: Snapshot[] = [];
  private _pendingDelete: StructNode | null = null;

  constructor(locale?: Locale) {
    super(locale);
    const t = locale ? locale.t : (s: string) => s;
    this.set('textMode', false);
    this.set('chemistryMode', false);
    this.setTemplate({
      tag: 'div',
      attributes: {
        class: ['ck', 'ck-math-canvas', 'ck-reset_all-excluded'],
        tabindex: '0',
        role: 'application',
        'aria-label': t('Formula editing area'),
        spellcheck: 'false'
      }
    });
  }

  public override render(): void {
    super.render();
    const element = this.element!;
    this._surface = element.ownerDocument.createElement('span');
    this._surface.className = 'mf-surface';
    element.appendChild(this._surface);
    element.addEventListener('keydown', evt => this._onKeyDown(evt));
    element.addEventListener('mousedown', evt => this._onMouseDown(evt));
    element.addEventListener('copy', evt => this._onCopy(evt, false));
    element.addEventListener('cut', evt => this._onCopy(evt, true));
    element.addEventListener('paste', evt => this._onPaste(evt));
    this.on('change:chemistryMode', (evt, name, value: boolean) => element.classList.toggle('mf-chemistry', value));
    element.addEventListener('focus', () => element.classList.add('mf-focused'));
    element.addEventListener('blur', () => element.classList.remove('mf-focused'));
    this.rerender();
  }

  public focus(): void {
    this.element?.focus();
  }

  /* --------------------------------------------------------------------------------------- */
  /* Public API                                                                                */
  /* --------------------------------------------------------------------------------------- */

  public getLatex(): string {
    return toLatex(this.root);
  }

  public setLatex(latex: string): void {
    this.setTree(parseLatex(latex));
  }

  public setTree(root: RowNode): void {
    this.root = root;
    this.caret = { row: root, offset: root.children.length };
    this.anchor = null;
    this._undoStack = [];
    this._redoStack = [];
    this._pendingDelete = null;
    this.rerender();
  }

  public get hasSelection(): boolean {
    return !!this.anchor && this.anchor.offset !== this.caret.offset;
  }

  /** Selected nodes (always within one row). */
  public getSelectedNodes(): InlineNode[] {
    if (!this.hasSelection) return [];
    const [start, end] = this._selectionBounds();
    return this.caret.row.children.slice(start, end);
  }

  /** Describes the caret context for contextual toolbars. */
  public getContext(): CanvasContext {
    const selected = this.getSelectedNodes();
    const selectedNode = selected.length === 1 ? selected[0] : null;
    let fence: FenceNode | null = null;
    let style: StyleNode | null = null;
    if (selectedNode && selectedNode.type === 'fence') fence = selectedNode;
    if (selectedNode && selectedNode.type === 'style') style = selectedNode;
    let row: RowNode | null = this.caret.row;
    while (row && row.owner) {
      if (!fence && row.owner.type === 'fence') fence = row.owner;
      if (!style && row.owner.type === 'style') style = row.owner;
      row = row.owner.parent;
    }
    const tokens = this._selectedTokens();
    return {
      table: this.getCurrentTable(),
      fence,
      style,
      selectedNode,
      bold: tokens.length > 0 && tokens.every(isBoldToken),
      italic: tokens.length > 0 && tokens.every(isItalicToken)
    };
  }

  /** Inserts nodes at the caret, replacing the selection. */
  public insertNodes(nodes: InlineNode[]): void {
    this._snapshot();
    this._deleteSelection();
    insertChildren(this.caret.row, this.caret.offset, nodes);
    this.caret = { row: this.caret.row, offset: this.caret.offset + nodes.length };
    this._commit();
  }

  /** Inserts a structure built by the factory; the current selection becomes the factory's input. */
  public insertTemplate(factory: TemplateFactory): void {
    this._snapshot();
    const selected = this.getSelectedNodes();
    const row = this.caret.row;
    const offset = this.hasSelection ? this._selectionBounds()[0] : this.caret.offset;
    selected.forEach(node => removeChild(node));
    this.anchor = null;
    const { node, focus } = factory(selected);
    insertChild(row, offset, node);
    const target = focus || getPrimarySlot(node);
    this.caret = { row: target, offset: target.children.length };
    this._commit();
  }

  public insertFraction(): void {
    this.insertTemplate(selected => {
      const node = createFrac(selected, []);
      return { node, focus: selected.length ? node.den : node.num };
    });
  }

  public insertScript(kind: 'sup' | 'sub'): void {
    const row = this.caret.row;
    const previous = row.children[this.caret.offset - 1];
    // Extend an existing script when the caret is right after one.
    if (!this.hasSelection && previous && previous.type === 'script' && !previous.limits && !previous.prescript) {
      this._snapshot();
      const slot = this._ensureScriptSlot(previous, kind);
      this.caret = { row: slot, offset: slot.children.length };
      this._commit();
      return;
    }
    if (!this.hasSelection && previous && !isStruct(previous)) {
      // Wrap the previous token: x then ^ gives x^{}.
      this.anchor = { row, offset: this.caret.offset - 1 };
    }
    this.insertTemplate(selected => {
      const node = createScript(selected, kind === 'sub' ? [] : null, kind === 'sup' ? [] : null, false);
      return { node, focus: kind === 'sup' ? node.sup! : node.sub! };
    });
  }

  public insertFence(open: string, close: string): void {
    this.insertTemplate(selected => ({ node: createFence(open, close, selected) }));
  }

  public insertRaw(latex: string): void {
    const parsed = parseLatex(latex);
    const nodes = parsed.children.slice();
    nodes.forEach(node => removeChild(node));
    this.insertNodes(nodes);
  }

  /** Converts the selection to upright text, or toggles text mode for subsequent typing. */
  public toggleText(): void {
    if (this.hasSelection) {
      this._snapshot();
      const nodes = this.getSelectedNodes();
      const row = this.caret.row;
      const [start] = this._selectionBounds();
      const converted = nodes.map(node => (node.type === 'token' ? createToken(node.kind === 'mtext' ? 'mi' : 'mtext', node.text) : node));
      nodes.forEach(node => removeChild(node));
      insertChildren(row, start, converted);
      this.anchor = { row, offset: start };
      this.caret = { row, offset: start + converted.length };
      this._commit();
      return;
    }
    this.textMode = !this.textMode;
  }

  /* ---- Formatting ------------------------------------------------------------------------ */

  /** Toggles bold (or italic) on every token in the selection. */
  public toggleVariant(which: 'bold' | 'italic'): void {
    const tokens = this._selectedTokens();
    if (!tokens.length) return;
    this._snapshot();
    const context = this.getContext();
    const turnOn = which === 'bold' ? !context.bold : !context.italic;
    for (const token of tokens) {
      const bold = which === 'bold' ? turnOn : isBoldToken(token);
      const italic = which === 'italic' ? turnOn : isItalicToken(token);
      const defaultItalic = token.kind === 'mi' && token.text.length === 1;
      let variant: Variant | undefined;
      if (bold && italic) variant = 'bold-italic';
      else if (bold) variant = 'bold';
      else if (italic) variant = defaultItalic ? undefined : 'italic';
      else variant = defaultItalic ? 'normal' : undefined;
      if (variant) token.variant = variant;
      else delete token.variant;
    }
    this._commit();
  }

  /** Applies a style (colour, background, size, display style) to the selection or the enclosing style node. */
  public applyStyle(style: Partial<Pick<StyleNode, 'color' | 'background' | 'size' | 'displaystyle' | 'voffset' | 'hspace'>>): void {
    const context = this.getContext();
    const existing = context.selectedNode && context.selectedNode.type === 'style' ? context.selectedNode : context.style;
    if (existing && (context.selectedNode === existing || !this.hasSelection)) {
      this._snapshot();
      Object.assign(existing, style);
      for (const key of Object.keys(style) as Array<keyof StyleNode>) {
        if ((existing as any)[key] === undefined || (existing as any)[key] === null || (existing as any)[key] === '') delete (existing as any)[key];
      }
      if (!existing.color && !existing.background && !existing.size && existing.displaystyle === undefined && !existing.voffset && !existing.hspace) {
        this._unwrapStyle(existing);
      }
      this._commit();
      return;
    }
    if (!this.hasSelection) return;
    this.insertTemplate(selected => {
      const node = createStyle(selected, style);
      return { node, focus: node.body };
    });
    // Keep the new style node selected so further formatting applies to it.
    const node = this.caret.row.owner as StyleNode;
    if (node && node.parent) this._selectStructure(node);
  }

  /** Moves the selected structure (or the innermost style wrapper) by the given em offsets. */
  public nudge(dx: number, dy: number): void {
    const context = this.getContext();
    const target = context.selectedNode && context.selectedNode.type === 'style' ? context.selectedNode : null;
    if (target) {
      this.applyStyle({ voffset: round((target.voffset || 0) + dy), hspace: round((target.hspace || 0) + dx) });
      return;
    }
    if (!this.hasSelection) return;
    this.applyStyle({ voffset: dy || undefined, hspace: dx || undefined });
  }

  /* ---- Fences ---------------------------------------------------------------------------- */

  public setFenceDelimiters(open: string | null, close: string | null): void {
    const fence = this.getContext().fence;
    if (!fence) return;
    this._snapshot();
    if (open !== null) fence.open = open;
    if (close !== null) fence.close = close;
    this._commit();
  }

  public toggleFenceStretchy(): void {
    const fence = this.getContext().fence;
    if (!fence) return;
    this._snapshot();
    fence.stretchy = fence.stretchy === false;
    this._commit();
  }

  /* ---- Tables ---------------------------------------------------------------------------- */

  /** The table containing the caret, if any. */
  public getCurrentTable(): { table: TableNode; r: number; c: number } | null {
    const selected = this.getSelectedNodes();
    if (selected.length === 1 && selected[0].type === 'table') return { table: selected[0], r: 0, c: 0 };
    let row: RowNode | null = this.caret.row;
    while (row) {
      const coords = getCellCoordinates(row);
      if (coords) return coords;
      row = row.owner && row.owner.parent ? row.owner.parent : null;
    }
    return null;
  }

  public setTableAttributes(attributes: Partial<Omit<TableNode, 'type' | 'cells' | 'parent'>>): void {
    const current = this.getCurrentTable();
    if (!current) return;
    this._snapshot();
    for (const [key, value] of Object.entries(attributes)) {
      if (value === undefined || value === null || value === '' || value === false) delete (current.table as any)[key];
      else (current.table as any)[key] = value;
    }
    this._commit();
  }

  public setColumnAlign(align: 'left' | 'center' | 'right', column?: number): void {
    const current = this.getCurrentTable();
    if (!current) return;
    this._snapshot();
    const columns = current.table.cells[0].length;
    const aligns = Array.from({ length: columns }, (_, c) => (current.table.columnAlign ? current.table.columnAlign[Math.min(c, current.table.columnAlign.length - 1)] : 'center'));
    if (column === undefined) aligns.fill(align);
    else aligns[column] = align;
    current.table.columnAlign = aligns.every(a => a === 'center') ? undefined : aligns;
    if (!current.table.columnAlign) delete current.table.columnAlign;
    this._commit();
  }

  public tableInsertRow(where: 'above' | 'below'): void {
    const current = this.getCurrentTable();
    if (!current) return;
    this._snapshot();
    const { table, r } = current;
    const columns = table.cells[0].length;
    const newRow = Array.from({ length: columns }, () => createRow([], table, ''));
    table.cells.splice(where === 'above' ? r : r + 1, 0, newRow);
    renumberTable(table);
    this.caret = { row: newRow[0], offset: 0 };
    this.anchor = null;
    this._commit();
  }

  public tableInsertColumn(where: 'left' | 'right'): void {
    const current = this.getCurrentTable();
    if (!current) return;
    this._snapshot();
    const { table, r, c } = current;
    const index = where === 'left' ? c : c + 1;
    table.cells.forEach(row => row.splice(index, 0, createRow([], table, '')));
    if (table.columnAlign) table.columnAlign.splice(index, 0, 'center');
    renumberTable(table);
    this.caret = { row: table.cells[r][index], offset: 0 };
    this.anchor = null;
    this._commit();
  }

  public tableRemoveRow(): void {
    const current = this.getCurrentTable();
    if (!current || current.table.cells.length <= 1) return;
    this._snapshot();
    const { table, r, c } = current;
    table.cells.splice(r, 1);
    renumberTable(table);
    const target = table.cells[Math.min(r, table.cells.length - 1)][c];
    this.caret = { row: target, offset: target.children.length };
    this.anchor = null;
    this._commit();
  }

  public tableRemoveColumn(): void {
    const current = this.getCurrentTable();
    if (!current || current.table.cells[0].length <= 1) return;
    this._snapshot();
    const { table, r, c } = current;
    table.cells.forEach(row => row.splice(c, 1));
    if (table.columnAlign) table.columnAlign.splice(c, 1);
    renumberTable(table);
    const target = table.cells[r][Math.min(c, table.cells[0].length - 1)];
    this.caret = { row: target, offset: target.children.length };
    this.anchor = null;
    this._commit();
  }

  /** Splits single-column multiline tables at the first relation sign so lines align on it. */
  public alignAtRelation(): void {
    const current = this.getCurrentTable();
    if (!current) return;
    const { table } = current;
    if (!table.cells.every(row => row.length === 1)) return;
    this._snapshot();
    for (const row of table.cells) {
      const cell = row[0];
      const index = cell.children.findIndex(node => node.type === 'token' && node.kind === 'mo' && /[=≠≈≤≥<>≡∼≅]/.test(node.text));
      const right = createRow([], table, '');
      if (index > -1) {
        const moved = cell.children.slice(index);
        moved.forEach(node => removeChild(node));
        insertChildren(right, 0, moved);
      }
      row.push(right);
    }
    table.columnAlign = ['right', 'left'];
    renumberTable(table);
    this.caret = { row: table.cells[current.r][1], offset: 0 };
    this.anchor = null;
    this._commit();
  }

  /* ---- Selection, clipboard and history --------------------------------------------------- */

  public selectAll(): void {
    this.anchor = { row: this.caret.row, offset: 0 };
    this.caret = { row: this.caret.row, offset: this.caret.row.children.length };
    this.rerender();
  }

  /** Copies the selection (LaTeX to the system clipboard, structure to the internal one). */
  public copy(cut = false): boolean {
    const nodes = this.getSelectedNodes();
    if (!nodes.length) return false;
    const row = createRow(nodes.map(node => fromJSON(toJSON(node)) as InlineNode));
    internalClipboard = { latex: rowToLatex(row), json: nodes.map(toJSON) };
    if (cut) {
      this._snapshot();
      this._deleteSelection();
      this._commit();
    }
    return true;
  }

  /** Pastes the internal clipboard, or parses pasted LaTeX text. */
  public paste(text?: string): void {
    if (text !== undefined && (!internalClipboard || text.trim() !== internalClipboard.latex)) {
      this.insertRaw(text.trim());
      return;
    }
    if (!internalClipboard) return;
    this.insertNodes(internalClipboard.json.map(json => fromJSON(json) as InlineNode));
  }

  public static get clipboardLatex(): string | null {
    return internalClipboard ? internalClipboard.latex : null;
  }

  public undo(): void {
    const snapshot = this._undoStack.pop();
    if (!snapshot) return;
    this._redoStack.push(this._captureSnapshot());
    this._restore(snapshot);
  }

  public redo(): void {
    const snapshot = this._redoStack.pop();
    if (!snapshot) return;
    this._undoStack.push(this._captureSnapshot());
    this._restore(snapshot);
  }

  public get canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  /* --------------------------------------------------------------------------------------- */
  /* Rendering                                                                                 */
  /* --------------------------------------------------------------------------------------- */

  public rerender(): void {
    if (!this._surface) return;
    const ctx: RenderContext = {
      doc: this._surface.ownerDocument,
      nodeElements: new Map(),
      elementNodes: new WeakMap(),
      caret: this.caret,
      selected: new Set(this.getSelectedNodes())
    };
    const rendered = renderRow(this.root, ctx);
    rendered.classList.add('mf-root');
    rendered.dir = this.direction;
    this._surface.replaceChildren(rendered);
    this._nodeElements = ctx.nodeElements;
    this._elementNodes = ctx.elementNodes;
    adjustStretchy(this._surface);
    this.fire('caretChange');
  }

  /* --------------------------------------------------------------------------------------- */
  /* Editing internals                                                                         */
  /* --------------------------------------------------------------------------------------- */

  private _selectionBounds(): [number, number] {
    const a = this.anchor ? this.anchor.offset : this.caret.offset;
    const b = this.caret.offset;
    return [Math.min(a, b), Math.max(a, b)];
  }

  private _selectedTokens(): TokenNode[] {
    const tokens: TokenNode[] = [];
    for (const node of this.getSelectedNodes()) {
      if (node.type === 'token') tokens.push(node);
      else if (isStruct(node)) for (const slot of getSlots(node)) tokens.push(...walkTokens(slot));
    }
    return tokens.filter(token => token.kind !== 'mo' || token.text.length > 1);
  }

  private _deleteSelection(): boolean {
    if (!this.hasSelection) {
      this.anchor = null;
      return false;
    }
    const [start, end] = this._selectionBounds();
    const row = this.caret.row;
    row.children.slice(start, end).forEach(node => removeChild(node));
    this.caret = { row, offset: start };
    this.anchor = null;
    return true;
  }

  private _unwrapStyle(style: StyleNode): void {
    const row = style.parent;
    if (!row) return;
    const index = indexOf(style);
    const children = style.body.children.slice();
    children.forEach(child => removeChild(child));
    removeChild(style);
    insertChildren(row, index, children);
    this.anchor = { row, offset: index };
    this.caret = { row, offset: index + children.length };
  }

  private _ensureScriptSlot(script: ScriptNode, kind: 'sup' | 'sub'): RowNode {
    if (kind === 'sup') {
      if (!script.sup) script.sup = createRow([], script, 'sup');
      return script.sup;
    }
    if (!script.sub) script.sub = createRow([], script, 'sub');
    return script.sub;
  }

  private _captureSnapshot(): Snapshot {
    return { json: toJSON(this.root), caretPath: getRowPath(this.caret.row), caretOffset: this.caret.offset };
  }

  private _snapshot(): void {
    this._undoStack.push(this._captureSnapshot());
    if (this._undoStack.length > MAX_HISTORY) this._undoStack.shift();
    this._redoStack = [];
  }

  private _restore(snapshot: Snapshot): void {
    this.root = fromJSON(snapshot.json) as RowNode;
    const row = resolveRowPath(this.root, snapshot.caretPath) || this.root;
    this.caret = { row, offset: Math.min(snapshot.caretOffset, row.children.length) };
    this.anchor = null;
    this._pendingDelete = null;
    this.rerender();
    this.fire('change');
  }

  private _commit(): void {
    this._pendingDelete = null;
    this.rerender();
    this.fire('change');
  }

  private _setCaret(position: Position, extend = false): void {
    if (extend) {
      if (!this.anchor) this.anchor = { ...this.caret };
      // Selections stay within one row.
      if (position.row !== this.caret.row) {
        position = { row: this.caret.row, offset: position.offset < this.caret.offset ? 0 : this.caret.row.children.length };
      }
    } else {
      this.anchor = null;
    }
    this.caret = position;
    this._pendingDelete = null;
    this.rerender();
  }

  private _moveRight(pos: Position): Position {
    const { row, offset } = pos;
    if (offset < row.children.length) {
      const node = row.children[offset];
      if (isStruct(node)) return { row: getSlots(node)[0], offset: 0 };
      return { row, offset: offset + 1 };
    }
    if (!row.owner || !row.owner.parent) return pos;
    const slots = getSlots(row.owner);
    const index = slots.indexOf(row);
    if (index < slots.length - 1) return { row: slots[index + 1], offset: 0 };
    return { row: row.owner.parent, offset: indexOf(row.owner) + 1 };
  }

  private _moveLeft(pos: Position): Position {
    const { row, offset } = pos;
    if (offset > 0) {
      const node = row.children[offset - 1];
      if (isStruct(node)) {
        const slots = getSlots(node);
        const last = slots[slots.length - 1];
        return { row: last, offset: last.children.length };
      }
      return { row, offset: offset - 1 };
    }
    if (!row.owner || !row.owner.parent) return pos;
    const slots = getSlots(row.owner);
    const index = slots.indexOf(row);
    if (index > 0) return { row: slots[index - 1], offset: slots[index - 1].children.length };
    return { row: row.owner.parent, offset: indexOf(row.owner) };
  }

  private _moveVertical(pos: Position, direction: 'up' | 'down'): Position {
    let row: RowNode = pos.row;
    while (row.owner) {
      const target = verticalNeighbour(row, direction);
      if (target) return { row: target, offset: Math.min(pos.offset, target.children.length) };
      if (!row.owner.parent) break;
      row = row.owner.parent;
    }
    return pos;
  }

  private _selectStructure(node: StructNode): void {
    const row = node.parent!;
    const index = indexOf(node);
    this.anchor = { row, offset: index };
    this.caret = { row, offset: index + 1 };
    this._pendingDelete = node;
    this.rerender();
  }

  private _backspace(): void {
    if (this.hasSelection) {
      this._snapshot();
      this._deleteSelection();
      this._commit();
      return;
    }
    const { row, offset } = this.caret;
    if (offset > 0) {
      const previous = row.children[offset - 1];
      if (isStruct(previous) && this._pendingDelete !== previous) {
        this._selectStructure(previous);
        return;
      }
      this._snapshot();
      removeChild(previous);
      this.caret = { row, offset: offset - 1 };
      this._commit();
      return;
    }
    if (row.owner && row.owner.parent) {
      this._selectStructure(row.owner);
    }
  }

  private _forwardDelete(): void {
    if (this.hasSelection) {
      this._snapshot();
      this._deleteSelection();
      this._commit();
      return;
    }
    const { row, offset } = this.caret;
    if (offset < row.children.length) {
      const next = row.children[offset];
      if (isStruct(next) && this._pendingDelete !== next) {
        this._selectStructure(next);
        this.caret = { row, offset };
        this.anchor = { row, offset: offset + 1 };
        this.rerender();
        return;
      }
      this._snapshot();
      removeChild(next);
      this._commit();
      return;
    }
    if (row.owner && row.owner.parent) {
      this._selectStructure(row.owner);
    }
  }

  private _typeCharacter(ch: string): void {
    if (this.textMode) {
      this.insertNodes([createToken('mtext', ch)]);
      return;
    }
    const row = this.caret.row;
    const previous = row.children[this.caret.offset - 1];
    if (ch === '.' && this.decimalSeparator === ',') {
      this.insertNodes([createToken('mn', ',', { latex: '{,}' })]);
      return;
    }
    if (this.chemistryMode && /[a-zA-Z]/.test(ch)) {
      // Two-letter element symbols (Na, Cl…) merge with the preceding upright capital.
      if (!this.hasSelection && /[a-z]/.test(ch) && previous && previous.type === 'token' && previous.variant === 'normal' && /^[A-Z]$/.test(previous.text) && isElementSymbol(previous.text + ch)) {
        this._snapshot();
        previous.text = previous.text + ch;
        previous.latex = `\\mathrm{${previous.text}}`;
        this._commit();
        return;
      }
      this.insertNodes([createToken('mi', ch, { variant: 'normal', latex: `\\mathrm{${ch}}` })]);
      return;
    }
    if (this.autoformat) {
      if (ch === '^' || ch === '_') {
        this.insertScript(ch === '^' ? 'sup' : 'sub');
        return;
      }
      if (ch === '/') {
        if (!this.hasSelection && previous && !(previous.type === 'token' && previous.kind === 'mo')) {
          this.anchor = { row, offset: this.caret.offset - 1 };
        }
        if (this.hasSelection || previous) {
          this.insertFraction();
          return;
        }
      }
      if (ch === '(' || ch === '[' || ch === '{') {
        const close = ch === '(' ? ')' : ch === '[' ? ']' : '}';
        this.insertFence(ch, close);
        return;
      }
      if ((ch === ')' || ch === ']' || ch === '}') && !this.hasSelection) {
        // Leave the fence when typing its closing delimiter at the end of the body.
        if (row.owner && row.owner.type === 'fence' && row.owner.close === ch && this.caret.offset === row.children.length) {
          this._setCaret({ row: row.owner.parent!, offset: indexOf(row.owner) + 1 });
          return;
        }
      }
      // `<=`, `>=`, `!=`, `->` and `=>` combine with the previous operator.
      if (!this.hasSelection && previous && previous.type === 'token' && previous.kind === 'mo') {
        const combined: Record<string, string> = { '<=': '≤', '>=': '≥', '!=': '≠', '−>': '→', '=>': '⇒', '<−': '←' };
        const pair = previous.text + (ch === '-' ? '−' : ch);
        if (combined[pair]) {
          this._snapshot();
          removeChild(previous);
          this.caret = { row, offset: this.caret.offset - 1 };
          insertChild(row, this.caret.offset, charToToken(combined[pair]));
          this.caret = { row, offset: this.caret.offset + 1 };
          this._commit();
          return;
        }
      }
    }
    this.insertNodes([charToToken(ch)]);
  }

  private _onEnter(): void {
    const current = this.getCurrentTable();
    if (current) {
      this.tableInsertRow('below');
    }
  }

  /* --------------------------------------------------------------------------------------- */
  /* DOM events                                                                                */
  /* --------------------------------------------------------------------------------------- */

  private _onKeyDown(evt: KeyboardEvent): void {
    const ctrl = evt.ctrlKey || evt.metaKey;
    const key = evt.key;
    const handled = () => {
      evt.preventDefault();
      evt.stopPropagation();
    };
    switch (key) {
      case 'ArrowRight':
        if (ctrl && evt.shiftKey) {
          this.nudge(0.1, 0);
          return handled();
        }
        if (evt.shiftKey) this._setCaret({ row: this.caret.row, offset: Math.min(this.caret.offset + 1, this.caret.row.children.length) }, true);
        else this._setCaret(this._moveRight(this.hasSelection ? { row: this.caret.row, offset: this._selectionBounds()[1] - 1 } : this.caret));
        return handled();
      case 'ArrowLeft':
        if (ctrl && evt.shiftKey) {
          this.nudge(-0.1, 0);
          return handled();
        }
        if (evt.shiftKey) this._setCaret({ row: this.caret.row, offset: Math.max(this.caret.offset - 1, 0) }, true);
        else this._setCaret(this._moveLeft(this.hasSelection ? { row: this.caret.row, offset: this._selectionBounds()[0] + 1 } : this.caret));
        return handled();
      case 'ArrowUp':
        if (ctrl && evt.shiftKey) this.nudge(0, 0.1);
        else if (ctrl) this.insertScript('sup');
        else this._setCaret(this._moveVertical(this.caret, 'up'), evt.shiftKey);
        return handled();
      case 'ArrowDown':
        if (ctrl && evt.shiftKey) this.nudge(0, -0.1);
        else if (ctrl) this.insertScript('sub');
        else this._setCaret(this._moveVertical(this.caret, 'down'), evt.shiftKey);
        return handled();
      case 'Home':
        this._setCaret({ row: this.caret.row, offset: 0 }, evt.shiftKey);
        return handled();
      case 'End':
        this._setCaret({ row: this.caret.row, offset: this.caret.row.children.length }, evt.shiftKey);
        return handled();
      case 'Backspace':
        this._backspace();
        return handled();
      case 'Delete':
        this._forwardDelete();
        return handled();
      case 'Tab':
      case 'Escape':
        return; // Let the dialog handle focus cycling and closing.
      case 'Enter':
        if (ctrl) return; // Ctrl+Enter submits the dialog.
        this._onEnter();
        return handled();
    }
    if (ctrl && (key === 'z' || key === 'Z')) {
      if (evt.shiftKey) this.redo();
      else this.undo();
      return handled();
    }
    if (ctrl && (key === 'y' || key === 'Y')) {
      this.redo();
      return handled();
    }
    if (ctrl && (key === 'a' || key === 'A')) {
      this.selectAll();
      return handled();
    }
    if (ctrl && (key === 'b' || key === 'B')) {
      this.toggleVariant('bold');
      return handled();
    }
    if (ctrl && (key === 'i' || key === 'I')) {
      this.toggleVariant('italic');
      return handled();
    }
    if (ctrl || evt.altKey) return; // Copy, cut and paste arrive as clipboard events.
    if (key.length === 1 && (key !== ' ' || this.textMode)) {
      this._typeCharacter(key);
      return handled();
    }
    if (key === ' ') return handled();
  }

  private _onCopy(evt: ClipboardEvent, cut: boolean): void {
    if (!this.copy(cut)) return;
    evt.preventDefault();
    if (evt.clipboardData && internalClipboard) {
      evt.clipboardData.setData('text/plain', internalClipboard.latex);
    }
  }

  private _onPaste(evt: ClipboardEvent): void {
    evt.preventDefault();
    const text = evt.clipboardData ? evt.clipboardData.getData('text/plain') : '';
    this.paste(text || undefined);
  }

  private _onMouseDown(evt: MouseEvent): void {
    const target = evt.target as HTMLElement | null;
    if (!target) return;
    evt.preventDefault();
    this.focus();
    let element: HTMLElement | null = target;
    while (element && element !== this.element && !this._elementNodes.has(element)) {
      element = element.parentElement;
    }
    const node = element ? this._elementNodes.get(element) : undefined;
    if (!node) {
      this._setCaret({ row: this.root, offset: this.root.children.length });
      return;
    }
    if (node.type === 'row') {
      const offset = offsetFromPoint(node, evt.clientX, this._nodeElements);
      this._setCaret({ row: node, offset });
      return;
    }
    if (node.type === 'token' || node.type === 'space') {
      const rect = element!.getBoundingClientRect();
      const index = indexOf(node);
      const after = evt.clientX > rect.left + rect.width / 2;
      this._setCaret({ row: node.parent!, offset: after ? index + 1 : index });
      return;
    }
    // Structure chrome (fraction bar, delimiters): select the structure.
    this._selectStructure(node);
  }
}

const elementSymbols = new Set(['H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds', 'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og']);

function isElementSymbol(text: string): boolean {
  return elementSymbols.has(text);
}

function isBoldToken(token: TokenNode): boolean {
  return token.variant === 'bold' || token.variant === 'bold-italic';
}

/** Single-letter identifiers are italic by default; explicit variants decide otherwise. */
function isItalicToken(token: TokenNode): boolean {
  if (token.variant === 'italic' || token.variant === 'bold-italic') return true;
  return !token.variant && token.kind === 'mi' && token.text.length === 1;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function verticalNeighbour(row: RowNode, direction: 'up' | 'down'): RowNode | null {
  const owner = row.owner!;
  switch (owner.type) {
    case 'frac':
      if (direction === 'up' && row === owner.den) return owner.num;
      if (direction === 'down' && row === owner.num) return owner.den;
      return null;
    case 'script':
      if (direction === 'up') {
        if (row === owner.base) return owner.sup;
        if (row === owner.sub) return owner.base;
      } else {
        if (row === owner.base) return owner.sub;
        if (row === owner.sup) return owner.base;
      }
      return null;
    case 'root':
      if (direction === 'up' && row === owner.base) return owner.index;
      if (direction === 'down' && row === owner.index) return owner.base;
      return null;
    case 'xarrow':
      if (direction === 'down' && row === owner.over) return owner.under;
      if (direction === 'up' && row === owner.under) return owner.over;
      return null;
    case 'table': {
      const coords = getCellCoordinates(row);
      if (!coords) return null;
      const r = coords.r + (direction === 'up' ? -1 : 1);
      if (r < 0 || r >= owner.cells.length) return null;
      return owner.cells[r][coords.c];
    }
    default:
      return null;
  }
}

function offsetFromPoint(row: RowNode, x: number, nodeElements: Map<FormulaNode, HTMLElement>): number {
  let offset = row.children.length;
  for (let i = 0; i < row.children.length; i++) {
    const element = nodeElements.get(row.children[i]);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (x < rect.left + rect.width / 2) {
      offset = i;
      break;
    }
  }
  return offset;
}

export { getRootRow };
export type { StyleSize };
