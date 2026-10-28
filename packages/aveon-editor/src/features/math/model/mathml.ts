/**
 * Formula tree → MathML (presentation markup) and MathML → formula tree.
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
  createStyle,
  createTable,
  createToken,
  createXArrow,
  insertChildren,
  type ColumnAlign,
  type EncloseNotation,
  type InlineNode,
  type RowAlign,
  type RowNode,
  type StyleSize,
  type TableFence,
  type TokenKind,
  type TokenNode,
  type Variant
} from './nodes';
import { accentCommands, largeOperators, limitOperators, sizeScale, spaceCommands, symbolsByChar, xarrowCommands } from './symbols';

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function attrs(map: Record<string, string | undefined>): string {
  return Object.entries(map)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => ` ${key}="${escape(value!)}"`)
    .join('');
}

/** Serialises a row's children; consecutive digits and text are merged into single tokens. */
function rowContent(row: RowNode): string {
  const parts: string[] = [];
  const children = row.children;
  let i = 0;
  while (i < children.length) {
    const node = children[i];
    if (node.type === 'token' && (node.kind === 'mn' || node.kind === 'mtext')) {
      const kind = node.kind;
      const variant = node.variant;
      let text = '';
      while (i < children.length && children[i].type === 'token' && (children[i] as TokenNode).kind === kind && (children[i] as TokenNode).variant === variant) {
        text += (children[i] as TokenNode).text;
        i++;
      }
      parts.push(`<${kind}${attrs({ mathvariant: variant && variant !== 'italic' ? variant : undefined })}>${escape(text)}</${kind}>`);
      continue;
    }
    parts.push(nodeToMathML(node));
    i++;
  }
  return parts.join('');
}

export function rowToMathML(row: RowNode, wrap = true): string {
  const content = rowContent(row);
  if (!wrap) return content;
  if (row.children.length === 1) return content;
  return `<mrow>${content}</mrow>`;
}

const fenceChars: Record<TableFence, [string, string]> = {
  none: ['', ''],
  paren: ['(', ')'],
  bracket: ['[', ']'],
  brace: ['{', '}'],
  bar: ['|', '|'],
  'double-bar': ['‖', '‖'],
  cases: ['{', '']
};

const fenceByChars: Record<string, TableFence> = { '()': 'paren', '[]': 'bracket', '{}': 'brace', '||': 'bar', '‖‖': 'double-bar', '{': 'cases' };

function fenced(open: string, close: string, content: string): string {
  const o = open ? `<mo fence="true" stretchy="true">${escape(open)}</mo>` : '';
  const c = close ? `<mo fence="true" stretchy="true">${escape(close)}</mo>` : '';
  return `<mrow>${o}${content}${c}</mrow>`;
}

export function nodeToMathML(node: InlineNode): string {
  switch (node.type) {
    case 'token': {
      const kind = node.raw ? 'mtext' : node.kind;
      const variant = node.variant && node.variant !== 'italic' ? node.variant : node.kind === 'mi' && node.text.length > 1 && !node.raw ? 'normal' : undefined;
      const extra: Record<string, string | undefined> = { mathvariant: variant };
      if (node.largeop) extra.largeop = 'true';
      return `<${kind}${attrs(extra)}>${escape(node.text)}</${kind}>`;
    }
    case 'space':
      return `<mspace width="${node.width}em"/>`;
    case 'frac': {
      const inner = `<mfrac${node.kind === 'binom' ? ' linethickness="0"' : ''}${node.bevelled ? ' bevelled="true"' : ''}>${rowToMathML(node.num)}${rowToMathML(node.den)}</mfrac>`;
      if (node.kind === 'binom') return fenced('(', ')', inner);
      if (node.kind === 'dfrac') return `<mstyle displaystyle="true">${inner}</mstyle>`;
      if (node.kind === 'tfrac') return `<mstyle displaystyle="false">${inner}</mstyle>`;
      return inner;
    }
    case 'root':
      return node.index ? `<mroot>${rowToMathML(node.base)}${rowToMathML(node.index)}</mroot>` : `<msqrt>${rowToMathML(node.base, false)}</msqrt>`;
    case 'script': {
      const base = rowToMathML(node.base);
      if (node.prescript) {
        return `<mmultiscripts>${base}<mprescripts/>${node.sub ? rowToMathML(node.sub) : '<none/>'}${node.sup ? rowToMathML(node.sup) : '<none/>'}</mmultiscripts>`;
      }
      if (node.limits) {
        if (node.sub && node.sup) return `<munderover>${base}${rowToMathML(node.sub)}${rowToMathML(node.sup)}</munderover>`;
        if (node.sub) return `<munder>${base}${rowToMathML(node.sub)}</munder>`;
        if (node.sup) return `<mover>${base}${rowToMathML(node.sup)}</mover>`;
        return base;
      }
      if (node.sub && node.sup) return `<msubsup>${base}${rowToMathML(node.sub)}${rowToMathML(node.sup)}</msubsup>`;
      if (node.sub) return `<msub>${base}${rowToMathML(node.sub)}</msub>`;
      if (node.sup) return `<msup>${base}${rowToMathML(node.sup)}</msup>`;
      return base;
    }
    case 'accent': {
      const mark = `<mo${node.stretchy ? ' stretchy="true"' : ''}>${escape(node.mark)}</mo>`;
      return node.position === 'over' ? `<mover accent="true">${rowToMathML(node.base)}${mark}</mover>` : `<munder accentunder="true">${rowToMathML(node.base)}${mark}</munder>`;
    }
    case 'fence': {
      const stretchy = node.stretchy === false ? 'false' : 'true';
      const open = node.open ? `<mo fence="true" stretchy="${stretchy}">${escape(node.open)}</mo>` : '';
      const close = node.close ? `<mo fence="true" stretchy="${stretchy}">${escape(node.close)}</mo>` : '';
      return `<mrow>${open}${rowToMathML(node.body)}${close}</mrow>`;
    }
    case 'table': {
      const [open, close] = fenceChars[node.fence];
      const rows = node.cells.map(row => `<mtr>${row.map(cell => `<mtd>${rowToMathML(cell, false) || ''}</mtd>`).join('')}</mtr>`).join('');
      const attributes: Record<string, string | undefined> = {
        columnalign: node.columnAlign ? node.columnAlign.join(' ') : node.fence === 'cases' ? 'left' : undefined,
        rowalign: node.rowAlign,
        frame: node.frame ? 'solid' : undefined,
        rowlines: node.rowLines ? 'solid' : node.lineBelow && node.lineBelow.length ? node.cells.slice(0, -1).map((_, r) => (node.lineBelow!.includes(r) ? 'solid' : 'none')).join(' ') : undefined,
        columnlines: node.columnLines ? 'solid' : undefined,
        equalrows: node.equalRows ? 'true' : undefined,
        equalcolumns: node.equalColumns ? 'true' : undefined,
        columnspacing: node.columnSpacing,
        rowspacing: node.rowSpacing,
        align: node.align
      };
      const table = `<mtable${attrs(attributes)}>${rows}</mtable>`;
      if (!open && !close) return table;
      return fenced(open, close, table);
    }
    case 'style': {
      let content = rowToMathML(node.body, false) || '<mrow></mrow>';
      const styleAttrs: Record<string, string | undefined> = {
        mathcolor: node.color,
        mathbackground: node.background,
        mathsize: node.size ? `${sizeScale[node.size]}em` : undefined,
        displaystyle: node.displaystyle === undefined ? undefined : String(node.displaystyle)
      };
      if (Object.values(styleAttrs).some(Boolean)) content = `<mstyle${attrs(styleAttrs)}>${content}</mstyle>`;
      if (node.voffset || node.hspace) {
        content = `<mpadded${attrs({ voffset: node.voffset ? `${node.voffset}em` : undefined, lspace: node.hspace ? `${node.hspace}em` : undefined })}>${content}</mpadded>`;
      }
      return content;
    }
    case 'enclose': {
      const notation = node.notation === 'crossout' ? 'updiagonalstrike downdiagonalstrike' : node.notation;
      return `<menclose notation="${notation}">${rowToMathML(node.body, false)}</menclose>`;
    }
    case 'xarrow': {
      const arrow = `<mo stretchy="true">${escape(node.arrow)}</mo>`;
      if (node.under) return `<munderover>${arrow}${rowToMathML(node.under)}${rowToMathML(node.over)}</munderover>`;
      return `<mover>${arrow}${rowToMathML(node.over)}</mover>`;
    }
  }
}

export interface MathMLOptions {
  display?: boolean;
  /** TeX source added as `<annotation encoding="application/x-tex">`. */
  annotation?: string;
  /** Spoken description added as `alttext`. */
  alttext?: string;
}

export function toMathML(root: RowNode, options: MathMLOptions = {}): string {
  const content = rowToMathML(root, false) || '<mrow></mrow>';
  const body = options.annotation !== undefined ? `<semantics><mrow>${content}</mrow><annotation encoding="application/x-tex">${escape(options.annotation)}</annotation></semantics>` : content;
  const attributes = attrs({ xmlns: MATHML_NS, display: options.display ? 'block' : undefined, alttext: options.alttext });
  return `<math${attributes}>${body}</math>`;
}

/* ------------------------------------------------------------------------------------------ */
/* Parser                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/** Minimal DOM-like interface so the parser works with the browser DOM and the view tree alike. */
export interface MathMLElementLike {
  name: string;
  attributes: Record<string, string>;
  children: MathMLElementLike[];
  text: string;
}

export function domToMathMLLike(element: Element): MathMLElementLike {
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) attributes[attr.name] = attr.value;
  const children: MathMLElementLike[] = [];
  let text = '';
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 1) children.push(domToMathMLLike(child as Element));
    else if (child.nodeType === 3) text += child.textContent || '';
  }
  return { name: element.localName.toLowerCase(), attributes, children, text };
}

/** Returns the TeX annotation of a `<math>` element if present. */
export function getTexAnnotation(math: MathMLElementLike): string | null {
  const find = (el: MathMLElementLike): string | null => {
    if (el.name === 'annotation' && /tex/i.test(el.attributes.encoding || '')) return el.text;
    for (const child of el.children) {
      const found = find(child);
      if (found !== null) return found;
    }
    return null;
  };
  return find(math);
}

export function parseMathML(math: MathMLElementLike): RowNode {
  const row = createRow();
  const content = math.name === 'math' ? unwrapSemantics(math.children) : [math];
  insertChildren(row, 0, content.flatMap(child => elementToNodes(child)));
  return row;
}

function unwrapSemantics(children: MathMLElementLike[]): MathMLElementLike[] {
  if (children.length === 1 && children[0].name === 'semantics') {
    return children[0].children.filter(child => child.name !== 'annotation' && child.name !== 'annotation-xml');
  }
  return children;
}

function childrenToNodes(children: MathMLElementLike[]): InlineNode[] {
  return children.flatMap(child => elementToNodes(child));
}

function sizeFromMathML(value: string | undefined): StyleSize | undefined {
  if (!value) return undefined;
  const em = parseFloat(value);
  if (Number.isNaN(em)) return undefined;
  let best: StyleSize = 'normal';
  let bestDiff = Infinity;
  for (const [size, scale] of Object.entries(sizeScale) as Array<[StyleSize, number]>) {
    const diff = Math.abs(scale - em);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = size;
    }
  }
  return best === 'normal' ? undefined : best;
}

function elementToNodes(el: MathMLElementLike): InlineNode[] {
  const variant = el.attributes.mathvariant as Variant | undefined;
  switch (el.name) {
    case 'mrow':
    case 'mphantom':
    case 'semantics':
      return tryFence(el.children) ?? childrenToNodes(el.children);
    case 'mstyle': {
      const body = tryFence(el.children) ?? childrenToNodes(el.children);
      const style = {
        color: el.attributes.mathcolor,
        background: el.attributes.mathbackground,
        size: sizeFromMathML(el.attributes.mathsize),
        displaystyle: el.attributes.displaystyle === undefined ? undefined : el.attributes.displaystyle === 'true'
      };
      if (!style.color && !style.background && !style.size && style.displaystyle === undefined) return body;
      return [createStyle(body, style)];
    }
    case 'mpadded': {
      const body = childrenToNodes(el.children);
      const voffset = el.attributes.voffset ? parseFloat(el.attributes.voffset) : undefined;
      const hspace = el.attributes.lspace ? parseFloat(el.attributes.lspace) : undefined;
      if (!voffset && !hspace) return body;
      if (body.length === 1 && body[0].type === 'style') {
        if (voffset) body[0].voffset = voffset;
        if (hspace) body[0].hspace = hspace;
        return body;
      }
      return [createStyle(body, { voffset: voffset || undefined, hspace: hspace || undefined })];
    }
    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext': {
      const kind = el.name as TokenKind;
      const text = el.text.trim() || el.text;
      if (kind === 'mi' && text.length > 1) {
        return [createToken('mi', text, { variant: 'normal', latex: /^[a-zA-Z]+$/.test(text) && isKnownFunction(text) ? `\\${text}` : `\\operatorname{${text}}` })];
      }
      if (kind === 'mn' || kind === 'mtext') {
        return Array.from(text).map(ch => createToken(kind, ch, variant && variant !== 'italic' ? { variant } : {}));
      }
      const info = symbolsByChar.get(text) || symbolsByChar.get(text === '-' ? '−' : text);
      const token = createToken(kind, info ? info.char : text, info ? { latex: info.latex } : {});
      if (variant && variant !== 'italic') token.variant = variant;
      if (info && largeOperators.has(info.latex)) token.largeop = true;
      return [token];
    }
    case 'mspace': {
      const width = parseFloat(el.attributes.width || '0.33') || 0.33;
      const latex = Object.entries(spaceCommands).find(([, w]) => Math.abs(w - width) < 0.03)?.[0] || `\\hspace{${width}em}`;
      return [createSpace(width, latex)];
    }
    case 'mfrac': {
      const kind = el.attributes.linethickness === '0' ? 'binom' : 'frac';
      const frac = createFrac(childrenToNodes([el.children[0]]), childrenToNodes([el.children[1]]), kind);
      if (el.attributes.bevelled === 'true') frac.bevelled = true;
      return [frac];
    }
    case 'msqrt':
      return [createRoot(childrenToNodes(el.children))];
    case 'mroot':
      return [createRoot(childrenToNodes([el.children[0]]), childrenToNodes([el.children[1]]))];
    case 'mmultiscripts': {
      const base = childrenToNodes([el.children[0]]);
      const index = el.children.findIndex(child => child.name === 'mprescripts');
      const pre = index === -1 ? [] : el.children.slice(index + 1);
      const sub = pre[0] && pre[0].name !== 'none' ? childrenToNodes([pre[0]]) : null;
      const sup = pre[1] && pre[1].name !== 'none' ? childrenToNodes([pre[1]]) : null;
      return [createScript(base, sub, sup, false, true)];
    }
    case 'msub':
    case 'msup':
    case 'msubsup':
    case 'munder':
    case 'mover':
    case 'munderover': {
      const limits = el.name.startsWith('mu') || el.name === 'mover';
      const first = el.children[0];
      // Labelled arrow: stretchy arrow operator with content above (and below).
      if (limits && first && first.name === 'mo' && first.attributes.stretchy === 'true' && el.attributes.accent !== 'true') {
        const arrow = first.text.trim();
        const command = Object.entries(xarrowCommands).find(([, def]) => def.arrow === arrow);
        if (command) {
          if (el.name === 'mover') return [createXArrow(arrow, command[0], childrenToNodes([el.children[1]]))];
          if (el.name === 'munderover') return [createXArrow(arrow, command[0], childrenToNodes([el.children[2]]), childrenToNodes([el.children[1]]))];
        }
      }
      const base = childrenToNodes([first]);
      if ((el.name === 'mover' && el.attributes.accent === 'true') || (el.name === 'munder' && el.attributes.accentunder === 'true')) {
        const mark = el.children[1]?.text.trim() || '^';
        const position = el.name === 'mover' ? 'over' : 'under';
        const command = Object.entries(accentCommands).find(([, def]) => def.mark === mark && def.position === position);
        return [createAccent(base, mark, command ? command[0] : position === 'over' ? '\\overset{' + mark + '}' : '\\underset{' + mark + '}', position, command ? command[1].stretchy : true)];
      }
      let sub: InlineNode[] | null = null;
      let sup: InlineNode[] | null = null;
      if (el.name === 'msub' || el.name === 'munder') sub = childrenToNodes([el.children[1]]);
      else if (el.name === 'msup' || el.name === 'mover') sup = childrenToNodes([el.children[1]]);
      else {
        sub = childrenToNodes([el.children[1]]);
        sup = childrenToNodes([el.children[2]]);
      }
      const baseToken = base.length === 1 && base[0].type === 'token' ? base[0] : null;
      const useLimits = limits || !!(baseToken && baseToken.latex && limitOperators.has(baseToken.latex));
      return [createScript(base, sub, sup, useLimits)];
    }
    case 'mtable': {
      const rows = el.children.filter(child => child.name === 'mtr' || child.name === 'mlabeledtr');
      const cells = rows.map(tr => tr.children.filter(td => td.name === 'mtd').map(td => childrenToNodes(td.children)));
      const columns = Math.max(1, ...cells.map(r => r.length));
      const table = createTable(cells.length || 1, columns, 'none', cells);
      if (el.attributes.frame && el.attributes.frame !== 'none') table.frame = true;
      if (el.attributes.rowlines && el.attributes.rowlines !== 'none') {
        const values = el.attributes.rowlines.split(/\s+/);
        if (values.every(v => v === 'solid')) table.rowLines = true;
        else table.lineBelow = values.map((v, r) => (v === 'solid' ? r : -1)).filter(r => r >= 0);
      }
      if (el.attributes.columnlines && el.attributes.columnlines !== 'none') table.columnLines = true;
      if (el.attributes.columnalign) {
        const aligns = el.attributes.columnalign.split(/\s+/).filter(Boolean) as ColumnAlign[];
        if (aligns.some(a => a !== 'center')) table.columnAlign = aligns;
      }
      if (el.attributes.rowalign) table.rowAlign = el.attributes.rowalign.split(/\s+/)[0] as RowAlign;
      if (el.attributes.equalrows === 'true') table.equalRows = true;
      if (el.attributes.equalcolumns === 'true') table.equalColumns = true;
      if (el.attributes.columnspacing) table.columnSpacing = el.attributes.columnspacing;
      if (el.attributes.rowspacing) table.rowSpacing = el.attributes.rowspacing;
      if (el.attributes.align) table.align = el.attributes.align as RowAlign;
      return [table];
    }
    case 'menclose': {
      const notation = (el.attributes.notation || 'box').split(/\s+/);
      let value: EncloseNotation = 'box';
      if (notation.includes('updiagonalstrike') && notation.includes('downdiagonalstrike')) value = 'crossout';
      else if (notation.includes('updiagonalstrike')) value = 'updiagonalstrike';
      else if (notation.includes('downdiagonalstrike')) value = 'downdiagonalstrike';
      else if (notation.includes('horizontalstrike')) value = 'horizontalstrike';
      return [createEnclose(childrenToNodes(el.children), value)];
    }
    case 'annotation':
    case 'annotation-xml':
      return [];
    default:
      return childrenToNodes(el.children);
  }
}

function isKnownFunction(name: string): boolean {
  return ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'lg', 'exp', 'lim', 'liminf', 'limsup', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'deg', 'gcd', 'hom', 'arg', 'Pr'].includes(name);
}

/** Recognises `<mrow><mo fence>…</mo> content <mo fence>…</mo></mrow>` as a fence or fenced matrix. */
function tryFence(children: MathMLElementLike[]): InlineNode[] | null {
  if (children.length < 2) return null;
  const first = children[0];
  const last = children[children.length - 1];
  const isFence = (el: MathMLElementLike) => el.name === 'mo' && (el.attributes.fence === 'true' || /^[()[\]{}|‖⟨⟩⌊⌋⌈⌉]$/.test(el.text.trim()));
  if (!isFence(first)) return null;
  const open = first.text.trim();
  const hasClose = isFence(last) && last !== first;
  const close = hasClose ? last.text.trim() : '';
  const inner = children.slice(1, hasClose ? -1 : undefined);
  if (inner.length === 1 && inner[0].name === 'mtable') {
    const fence = fenceByChars[open + close] || (open === '{' && !close ? 'cases' : 'none');
    const table = elementToNodes(inner[0])[0];
    if (table && table.type === 'table') {
      table.fence = fence;
      return [table];
    }
  }
  if (inner.length === 1 && inner[0].name === 'mfrac' && inner[0].attributes.linethickness === '0' && open === '(' && close === ')') {
    return elementToNodes(inner[0]);
  }
  const stretchy = first.attributes.stretchy !== 'false';
  return [createFence(open, close, childrenToNodes(inner), stretchy)];
}
