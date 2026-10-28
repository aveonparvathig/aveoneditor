/**
 * Structured formula model. The tree mirrors MathML presentation markup:
 * rows hold inline nodes; structures (fractions, roots, scripts, fences, tables, accents, styles,
 * enclosures, labelled arrows) own named row slots. Every node knows its parent row, every row
 * knows its owner structure.
 */

export type TokenKind = 'mi' | 'mn' | 'mo' | 'mtext';
export type Variant = 'normal' | 'bold' | 'italic' | 'bold-italic' | 'double-struck' | 'script' | 'fraktur' | 'sans-serif' | 'monospace';

export interface TokenNode {
  type: 'token';
  kind: TokenKind;
  text: string;
  /** Explicit font variant (`normal` for function names and upright text). */
  variant?: Variant;
  /** LaTeX command producing this token (e.g. `\alpha`, `\sin`). Defaults to the text itself. */
  latex?: string;
  /** Large operator (∑, ∫) that takes limits. */
  largeop?: boolean;
  /** Unknown LaTeX command kept verbatim so no data is lost. */
  raw?: boolean;
  parent: RowNode | null;
}

export interface SpaceNode {
  type: 'space';
  /** Width in em. */
  width: number;
  latex: string;
  parent: RowNode | null;
}

export interface FracNode {
  type: 'frac';
  num: RowNode;
  den: RowNode;
  /** `frac` (default), `dfrac` (display), `tfrac` (text), `binom` (binomial), `cfrac` (continued). */
  kind?: 'frac' | 'dfrac' | 'tfrac' | 'binom' | 'cfrac';
  bevelled?: boolean;
  parent: RowNode | null;
}

export interface RootNode {
  type: 'root';
  base: RowNode;
  /** Index slot (`null` for a square root). */
  index: RowNode | null;
  parent: RowNode | null;
}

export interface ScriptNode {
  type: 'script';
  base: RowNode;
  sub: RowNode | null;
  sup: RowNode | null;
  /** Render scripts as limits above/below (sum, lim, overset/underset). */
  limits: boolean;
  /** Scripts placed before the base (isotopes, tensors). */
  prescript?: boolean;
  parent: RowNode | null;
}

export interface AccentNode {
  type: 'accent';
  base: RowNode;
  /** Accent character, e.g. `^`, `→`, `‾`. */
  mark: string;
  position: 'over' | 'under';
  stretchy: boolean;
  /** LaTeX command, e.g. `\hat`, `\overline`, `\vec`. */
  latex: string;
  parent: RowNode | null;
}

export interface FenceNode {
  type: 'fence';
  open: string;
  close: string;
  body: RowNode;
  /** Delimiters grow with the content (`\left … \right`). Default `true`. */
  stretchy?: boolean;
  parent: RowNode | null;
}

export type TableFence = 'none' | 'paren' | 'bracket' | 'brace' | 'bar' | 'double-bar' | 'cases';
export type ColumnAlign = 'left' | 'center' | 'right';
export type RowAlign = 'top' | 'center' | 'bottom' | 'baseline' | 'axis';

export interface TableNode {
  type: 'table';
  /** cells[row][column] */
  cells: RowNode[][];
  fence: TableFence;
  /** Outer frame (MathML `frame`, LaTeX `array` with `|` and `\hline`). */
  frame?: boolean;
  /** Lines between rows / columns. */
  rowLines?: boolean;
  columnLines?: boolean;
  /** Alignment per column (last value repeats). */
  columnAlign?: ColumnAlign[];
  rowAlign?: RowAlign;
  equalRows?: boolean;
  equalColumns?: boolean;
  /** CSS lengths such as `0.5em`. */
  columnSpacing?: string;
  rowSpacing?: string;
  /** Vertical alignment of the whole table (MathML `align`). */
  align?: RowAlign;
  /** Row indexes that get a line below them (stacked arithmetic). */
  lineBelow?: number[];
  parent: RowNode | null;
}

export type StyleSize = 'tiny' | 'scriptsize' | 'small' | 'normal' | 'large' | 'Large' | 'huge';

/** Styling wrapper (`mstyle` / `mpadded`): colour, background, size, display style and nudging. */
export interface StyleNode {
  type: 'style';
  body: RowNode;
  color?: string;
  background?: string;
  size?: StyleSize;
  displaystyle?: boolean;
  /** Vertical nudge in em (positive moves up). */
  voffset?: number;
  /** Horizontal nudge in em (positive moves right). */
  hspace?: number;
  parent: RowNode | null;
}

export type EncloseNotation = 'box' | 'updiagonalstrike' | 'downdiagonalstrike' | 'crossout' | 'horizontalstrike';

export interface EncloseNode {
  type: 'enclose';
  body: RowNode;
  notation: EncloseNotation;
  parent: RowNode | null;
}

/** Labelled (extensible) arrow such as `\xrightarrow[under]{over}`. */
export interface XArrowNode {
  type: 'xarrow';
  arrow: string;
  latex: string;
  over: RowNode;
  under: RowNode | null;
  parent: RowNode | null;
}

export type StructNode = FracNode | RootNode | ScriptNode | AccentNode | FenceNode | TableNode | StyleNode | EncloseNode | XArrowNode;
export type InlineNode = TokenNode | SpaceNode | StructNode;

export interface RowNode {
  type: 'row';
  children: InlineNode[];
  owner: StructNode | null;
  /** Slot name inside the owner (e.g. `num`, `den`, `cell:1:2`). */
  slot: string | null;
}

export type FormulaNode = RowNode | InlineNode;

export interface Position {
  row: RowNode;
  offset: number;
}

/* ------------------------------------------------------------------------------------------ */
/* Construction                                                                                */
/* ------------------------------------------------------------------------------------------ */

export function createRow(children: InlineNode[] = [], owner: StructNode | null = null, slot: string | null = null): RowNode {
  const row: RowNode = { type: 'row', children: [], owner, slot };
  for (const child of children) appendChild(row, child);
  return row;
}

export function createToken(kind: TokenKind, text: string, extra: Partial<Omit<TokenNode, 'type' | 'kind' | 'text' | 'parent'>> = {}): TokenNode {
  return { type: 'token', kind, text, parent: null, ...extra };
}

export function createSpace(width: number, latex: string): SpaceNode {
  return { type: 'space', width, latex, parent: null };
}

export function createFrac(num: InlineNode[] = [], den: InlineNode[] = [], kind: FracNode['kind'] = 'frac'): FracNode {
  const node: FracNode = { type: 'frac', num: null as any, den: null as any, kind, parent: null };
  node.num = createRow(num, node, 'num');
  node.den = createRow(den, node, 'den');
  return node;
}

export function createRoot(base: InlineNode[] = [], index: InlineNode[] | null = null): RootNode {
  const node: RootNode = { type: 'root', base: null as any, index: null, parent: null };
  node.base = createRow(base, node, 'base');
  if (index) node.index = createRow(index, node, 'index');
  return node;
}

export function createScript(base: InlineNode[] = [], sub: InlineNode[] | null = null, sup: InlineNode[] | null = null, limits = false, prescript = false): ScriptNode {
  const node: ScriptNode = { type: 'script', base: null as any, sub: null, sup: null, limits, prescript, parent: null };
  node.base = createRow(base, node, 'base');
  if (sub) node.sub = createRow(sub, node, 'sub');
  if (sup) node.sup = createRow(sup, node, 'sup');
  return node;
}

export function createAccent(base: InlineNode[], mark: string, latex: string, position: 'over' | 'under' = 'over', stretchy = false): AccentNode {
  const node: AccentNode = { type: 'accent', base: null as any, mark, position, stretchy, latex, parent: null };
  node.base = createRow(base, node, 'base');
  return node;
}

export function createFence(open: string, close: string, body: InlineNode[] = [], stretchy = true): FenceNode {
  const node: FenceNode = { type: 'fence', open, close, body: null as any, stretchy, parent: null };
  node.body = createRow(body, node, 'body');
  return node;
}

export function createTable(rows: number, columns: number, fence: TableFence = 'paren', cells?: InlineNode[][][]): TableNode {
  const node: TableNode = { type: 'table', cells: [], fence, parent: null };
  for (let r = 0; r < rows; r++) {
    const row: RowNode[] = [];
    for (let c = 0; c < columns; c++) {
      row.push(createRow(cells && cells[r] && cells[r][c] ? cells[r][c] : [], node, `cell:${r}:${c}`));
    }
    node.cells.push(row);
  }
  return node;
}

export function createStyle(body: InlineNode[], style: Partial<Omit<StyleNode, 'type' | 'body' | 'parent'>> = {}): StyleNode {
  const node: StyleNode = { type: 'style', body: null as any, parent: null, ...style };
  node.body = createRow(body, node, 'body');
  return node;
}

export function createEnclose(body: InlineNode[], notation: EncloseNotation): EncloseNode {
  const node: EncloseNode = { type: 'enclose', body: null as any, notation, parent: null };
  node.body = createRow(body, node, 'body');
  return node;
}

export function createXArrow(arrow: string, latex: string, over: InlineNode[] = [], under: InlineNode[] | null = null): XArrowNode {
  const node: XArrowNode = { type: 'xarrow', arrow, latex, over: null as any, under: null, parent: null };
  node.over = createRow(over, node, 'over');
  if (under) node.under = createRow(under, node, 'under');
  return node;
}

/* ------------------------------------------------------------------------------------------ */
/* Tree manipulation                                                                           */
/* ------------------------------------------------------------------------------------------ */

export function appendChild(row: RowNode, child: InlineNode): void {
  insertChild(row, row.children.length, child);
}

export function insertChild(row: RowNode, index: number, child: InlineNode): void {
  if (child.parent) removeChild(child);
  child.parent = row;
  row.children.splice(index, 0, child);
}

export function insertChildren(row: RowNode, index: number, children: InlineNode[]): void {
  children.forEach((child, i) => insertChild(row, index + i, child));
}

export function removeChild(child: InlineNode): number {
  const row = child.parent;
  if (!row) return -1;
  const index = row.children.indexOf(child);
  if (index > -1) row.children.splice(index, 1);
  child.parent = null;
  return index;
}

export function indexOf(child: InlineNode): number {
  return child.parent ? child.parent.children.indexOf(child) : -1;
}

/** Row slots of a structure in navigation order. */
export function getSlots(node: StructNode): RowNode[] {
  switch (node.type) {
    case 'frac':
      return [node.num, node.den];
    case 'root':
      return node.index ? [node.index, node.base] : [node.base];
    case 'script':
      if (node.prescript) return [...(node.sup ? [node.sup] : []), ...(node.sub ? [node.sub] : []), node.base];
      return node.limits ? [node.base, ...(node.sub ? [node.sub] : []), ...(node.sup ? [node.sup] : [])] : [node.base, ...(node.sup ? [node.sup] : []), ...(node.sub ? [node.sub] : [])];
    case 'accent':
      return [node.base];
    case 'fence':
      return [node.body];
    case 'table':
      return node.cells.flat();
    case 'style':
    case 'enclose':
      return [node.body];
    case 'xarrow':
      return node.under ? [node.over, node.under] : [node.over];
  }
}

/** The slot that receives the selection or caret when the structure is inserted. */
export function getPrimarySlot(node: StructNode): RowNode {
  switch (node.type) {
    case 'frac':
      return node.num;
    case 'table':
      return node.cells[0][0];
    case 'xarrow':
      return node.over;
    case 'root':
    case 'script':
    case 'accent':
      return node.base;
    case 'fence':
    case 'style':
    case 'enclose':
      return node.body;
  }
}

export function isStruct(node: FormulaNode): node is StructNode {
  return node.type !== 'row' && node.type !== 'token' && node.type !== 'space';
}

export function isEmptyRow(row: RowNode): boolean {
  return row.children.length === 0;
}

export function getRootRow(row: RowNode): RowNode {
  let current = row;
  while (current.owner && current.owner.parent) current = current.owner.parent;
  return current;
}

/** Table cell coordinates of a row that is a table cell. */
export function getCellCoordinates(row: RowNode): { table: TableNode; r: number; c: number } | null {
  if (!row.owner || row.owner.type !== 'table') return null;
  const table = row.owner;
  for (let r = 0; r < table.cells.length; r++) {
    const c = table.cells[r].indexOf(row);
    if (c > -1) return { table, r, c };
  }
  return null;
}

export function renumberTable(table: TableNode): void {
  table.cells.forEach((row, r) => row.forEach((cell, c) => (cell.slot = `cell:${r}:${c}`)));
}

/** Walks every token under a row (depth first). */
export function* walkTokens(row: RowNode): IterableIterator<TokenNode> {
  for (const child of row.children) {
    if (child.type === 'token') yield child;
    else if (isStruct(child)) for (const slot of getSlots(child)) yield* walkTokens(slot);
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Cloning and snapshots                                                                       */
/* ------------------------------------------------------------------------------------------ */

export function cloneNode<T extends InlineNode>(node: T): T {
  return fromJSON(toJSON(node)) as T;
}

export function cloneRowChildren(row: RowNode): InlineNode[] {
  return row.children.map(child => cloneNode(child));
}

export type NodeJSON = Record<string, unknown>;

const tableAttributeKeys: Array<keyof TableNode> = ['frame', 'rowLines', 'columnLines', 'columnAlign', 'rowAlign', 'equalRows', 'equalColumns', 'columnSpacing', 'rowSpacing', 'align', 'lineBelow'];
const styleAttributeKeys: Array<keyof StyleNode> = ['color', 'background', 'size', 'displaystyle', 'voffset', 'hspace'];

/** Plain-object snapshot (used for undo and tests). */
export function toJSON(node: FormulaNode): NodeJSON {
  switch (node.type) {
    case 'row':
      return { type: 'row', children: node.children.map(toJSON) };
    case 'token': {
      const json: NodeJSON = { type: 'token', kind: node.kind, text: node.text };
      if (node.variant) json.variant = node.variant;
      if (node.latex) json.latex = node.latex;
      if (node.largeop) json.largeop = true;
      if (node.raw) json.raw = true;
      return json;
    }
    case 'space':
      return { type: 'space', width: node.width, latex: node.latex };
    case 'frac':
      return { type: 'frac', num: toJSON(node.num), den: toJSON(node.den), ...(node.kind && node.kind !== 'frac' ? { kind: node.kind } : {}), ...(node.bevelled ? { bevelled: true } : {}) };
    case 'root':
      return { type: 'root', base: toJSON(node.base), index: node.index ? toJSON(node.index) : null };
    case 'script':
      return { type: 'script', base: toJSON(node.base), sub: node.sub ? toJSON(node.sub) : null, sup: node.sup ? toJSON(node.sup) : null, limits: node.limits, ...(node.prescript ? { prescript: true } : {}) };
    case 'accent':
      return { type: 'accent', base: toJSON(node.base), mark: node.mark, position: node.position, stretchy: node.stretchy, latex: node.latex };
    case 'fence':
      return { type: 'fence', open: node.open, close: node.close, body: toJSON(node.body), ...(node.stretchy === false ? { stretchy: false } : {}) };
    case 'table': {
      const json: NodeJSON = { type: 'table', fence: node.fence, cells: node.cells.map(row => row.map(toJSON)) };
      for (const key of tableAttributeKeys) if (node[key] !== undefined) json[key] = node[key];
      return json;
    }
    case 'style': {
      const json: NodeJSON = { type: 'style', body: toJSON(node.body) };
      for (const key of styleAttributeKeys) if (node[key] !== undefined) json[key] = node[key];
      return json;
    }
    case 'enclose':
      return { type: 'enclose', notation: node.notation, body: toJSON(node.body) };
    case 'xarrow':
      return { type: 'xarrow', arrow: node.arrow, latex: node.latex, over: toJSON(node.over), under: node.under ? toJSON(node.under) : null };
  }
}

export function fromJSON(json: NodeJSON): FormulaNode {
  const rowChildren = (value: unknown): InlineNode[] => ((value as NodeJSON)?.children as NodeJSON[] | undefined || []).map(child => fromJSON(child) as InlineNode);
  switch (json.type) {
    case 'row':
      return createRow(rowChildren(json));
    case 'token':
      return createToken(json.kind as TokenKind, json.text as string, {
        variant: json.variant as Variant | undefined,
        latex: json.latex as string | undefined,
        largeop: json.largeop as boolean | undefined,
        raw: json.raw as boolean | undefined
      });
    case 'space':
      return createSpace(json.width as number, json.latex as string);
    case 'frac': {
      const frac = createFrac(rowChildren(json.num), rowChildren(json.den), (json.kind as FracNode['kind']) || 'frac');
      if (json.bevelled) frac.bevelled = true;
      return frac;
    }
    case 'root':
      return createRoot(rowChildren(json.base), json.index ? rowChildren(json.index) : null);
    case 'script':
      return createScript(rowChildren(json.base), json.sub ? rowChildren(json.sub) : null, json.sup ? rowChildren(json.sup) : null, !!json.limits, !!json.prescript);
    case 'accent':
      return createAccent(rowChildren(json.base), json.mark as string, json.latex as string, json.position as 'over' | 'under', !!json.stretchy);
    case 'fence':
      return createFence(json.open as string, json.close as string, rowChildren(json.body), json.stretchy !== false);
    case 'table': {
      const cells = json.cells as NodeJSON[][];
      const table = createTable(cells.length, cells[0] ? cells[0].length : 0, json.fence as TableFence);
      cells.forEach((row, r) => row.forEach((cell, c) => insertChildren(table.cells[r][c], 0, rowChildren(cell))));
      for (const key of tableAttributeKeys) if (json[key] !== undefined) (table as any)[key] = json[key];
      return table;
    }
    case 'style': {
      const style = createStyle(rowChildren(json.body));
      for (const key of styleAttributeKeys) if (json[key] !== undefined) (style as any)[key] = json[key];
      return style;
    }
    case 'enclose':
      return createEnclose(rowChildren(json.body), json.notation as EncloseNotation);
    case 'xarrow':
      return createXArrow(json.arrow as string, json.latex as string, rowChildren(json.over), json.under ? rowChildren(json.under) : null);
    default:
      throw new Error(`math-model-unknown-node-type: ${String(json.type)}`);
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Paths (stable addresses for undo snapshots)                                                 */
/* ------------------------------------------------------------------------------------------ */

/** Path of a row from the root: alternating child index and slot name. */
export function getRowPath(row: RowNode): Array<number | string> {
  const path: Array<number | string> = [];
  let current: RowNode = row;
  while (current.owner) {
    path.unshift(current.slot!);
    const owner = current.owner;
    if (!owner.parent) break;
    path.unshift(indexOf(owner));
    current = owner.parent;
  }
  return path;
}

export function resolveRowPath(root: RowNode, path: Array<number | string>): RowNode | null {
  let row: RowNode = root;
  for (let i = 0; i < path.length; i += 2) {
    const index = path[i] as number;
    const slot = path[i + 1] as string;
    const child = row.children[index];
    if (!child || !isStruct(child)) return null;
    const target = getSlots(child).find(s => s.slot === slot);
    if (!target) return null;
    row = target;
  }
  return row;
}
