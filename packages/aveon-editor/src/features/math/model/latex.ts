/**
 * LaTeX ⇄ formula tree. The parser covers the subset the visual editor produces plus the common
 * amsmath constructs; unknown commands become raw tokens so nothing is lost on a round trip.
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
  insertChild,
  removeChild,
  type ColumnAlign,
  type FracNode,
  type InlineNode,
  type RowNode,
  type ScriptNode,
  type StyleNode,
  type StyleSize,
  type TableFence,
  type TableNode,
  type TokenNode,
  type Variant
} from './nodes';
import {
  accentCommands,
  braceAccents,
  delimiterToLatex,
  encloseCommands,
  fenceDelimiters,
  functionNames,
  largeOperators,
  limitOperators,
  sizeCommands,
  spaceCommands,
  symbolsByChar,
  symbolsByLatex,
  xarrowCommands
} from './symbols';

/* ------------------------------------------------------------------------------------------ */
/* Tokenizer                                                                                   */
/* ------------------------------------------------------------------------------------------ */

type Tok = { type: 'command' | 'char' | 'open' | 'close' | 'sup' | 'sub' | 'amp' | 'newline' | 'ws' | 'eof'; value: string };

function tokenize(input: string): Tok[] {
  const tokens: Tok[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '\\') {
      const rest = input.slice(i + 1);
      if (rest.startsWith('\\')) {
        tokens.push({ type: 'newline', value: '\\\\' });
        i += 2;
        continue;
      }
      const match = /^[a-zA-Z]+\*?/.exec(rest);
      if (match) {
        tokens.push({ type: 'command', value: '\\' + match[0] });
        i += 1 + match[0].length;
      } else {
        tokens.push({ type: 'command', value: '\\' + (rest[0] || '') });
        i += 2;
      }
      continue;
    }
    if (ch === '{') tokens.push({ type: 'open', value: ch });
    else if (ch === '}') tokens.push({ type: 'close', value: ch });
    else if (ch === '^') tokens.push({ type: 'sup', value: ch });
    else if (ch === '_') tokens.push({ type: 'sub', value: ch });
    else if (ch === '&') tokens.push({ type: 'amp', value: ch });
    else if (ch === '~') tokens.push({ type: 'command', value: '~' });
    else if (/\s/.test(ch)) {
      if (tokens.length && tokens[tokens.length - 1].type !== 'ws') tokens.push({ type: 'ws', value: ' ' });
    } else tokens.push({ type: 'char', value: ch });
    i++;
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

/* ------------------------------------------------------------------------------------------ */
/* Parser                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const matrixEnvironments: Record<string, TableFence> = {
  matrix: 'none',
  pmatrix: 'paren',
  bmatrix: 'bracket',
  Bmatrix: 'brace',
  vmatrix: 'bar',
  Vmatrix: 'double-bar',
  cases: 'cases',
  aligned: 'none',
  array: 'none',
  'align*': 'none',
  align: 'none',
  gathered: 'none'
};

const fenceTypeByDelims: Record<string, TableFence> = { '()': 'paren', '[]': 'bracket', '{}': 'brace', '||': 'bar', '‖‖': 'double-bar', '{': 'cases', '': 'none' };

const variantCommands: Record<string, Variant> = {
  '\\mathrm': 'normal',
  '\\mathbf': 'bold',
  '\\boldsymbol': 'bold',
  '\\bm': 'bold',
  '\\mathit': 'italic',
  '\\mathbb': 'double-struck',
  '\\mathcal': 'script',
  '\\mathscr': 'script',
  '\\mathfrak': 'fraktur',
  '\\mathsf': 'sans-serif',
  '\\mathtt': 'monospace',
  '\\operatorname': 'normal'
};

const fracCommands: Record<string, FracNode['kind']> = { '\\frac': 'frac', '\\dfrac': 'dfrac', '\\tfrac': 'tfrac', '\\binom': 'binom', '\\cfrac': 'cfrac' };

const ignoredCommands = new Set(['\\scriptstyle', '\\scriptscriptstyle', '\\limits', '\\nolimits', '\\right', '\\middle', '\\nonumber', '\\notag']);

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Tok[]) {}

  public parse(): RowNode {
    const row = createRow();
    this.parseSequence(row, () => this.peek().type === 'eof');
    return row;
  }

  /** Whitespace is skipped everywhere except inside text arguments. */
  private peek(): Tok {
    while (this.tokens[this.pos].type === 'ws') this.pos++;
    return this.tokens[this.pos];
  }

  private next(): Tok {
    this.peek();
    return this.tokens[this.pos++];
  }

  private rawPeek(): Tok {
    return this.tokens[this.pos];
  }

  private rawNext(): Tok {
    return this.tokens[this.pos++];
  }

  /** Parses atoms into `row` until `stop()` is true (the stopping token is not consumed). */
  private parseSequence(row: RowNode, stop: () => boolean): void {
    while (!stop() && this.peek().type !== 'eof') {
      const tok = this.peek();
      if (tok.type === 'sup' || tok.type === 'sub') {
        this.next();
        this.applyScript(row, tok.type === 'sup');
        continue;
      }
      if (tok.type === 'close') {
        this.next();
        continue;
      }
      if (tok.type === 'command' && (sizeCommands[tok.value] || tok.value === '\\displaystyle' || tok.value === '\\textstyle')) {
        // A size/display command applies to the rest of the current group.
        this.next();
        const rest = createRow();
        this.parseSequence(rest, stop);
        const children = detach(rest);
        const style = createStyle(children, tok.value === '\\displaystyle' ? { displaystyle: true } : tok.value === '\\textstyle' ? { displaystyle: false } : { size: sizeCommands[tok.value] });
        insertChild(row, row.children.length, style);
        continue;
      }
      const nodes = this.parseAtom();
      for (const node of nodes) {
        const previous = row.children[row.children.length - 1];
        // `{}_{a}^{b}X`: an empty-based script followed by an atom becomes a prescript.
        if (previous && previous.type === 'script' && previous.prescript && previous.base.children.length === 0) {
          insertChild(previous.base, 0, node);
          continue;
        }
        insertChild(row, row.children.length, node);
      }
    }
  }

  /** Parses a single argument: a brace group or one atom. Returns the nodes. */
  private parseArgument(): InlineNode[] {
    const tok = this.peek();
    if (tok.type === 'open') {
      this.next();
      const row = createRow();
      this.parseSequence(row, () => this.peek().type === 'close');
      if (this.peek().type === 'close') this.next();
      return detach(row);
    }
    if (tok.type === 'eof' || tok.type === 'close') return [];
    return this.parseAtom();
  }

  private parseOptionalArgument(): InlineNode[] | null {
    if (this.peek().type === 'char' && this.peek().value === '[') {
      this.next();
      const row = createRow();
      this.parseSequence(row, () => this.peek().type === 'char' && this.peek().value === ']');
      if (this.peek().type !== 'eof') this.next();
      return detach(row);
    }
    return null;
  }

  private applyScript(row: RowNode, isSup: boolean): void {
    const content = this.parseArgument();
    const previous = row.children[row.children.length - 1];
    let script: ScriptNode;
    if (previous && previous.type === 'script' && (isSup ? !previous.sup : !previous.sub) && !(previous.prescript && previous.base.children.length > 0)) {
      script = previous;
    } else {
      const base = previous ? [previous] : [];
      if (previous) removeChild(previous);
      const limits = !!previous && isLimitsBase(previous);
      script = createScript(base, null, null, limits, !previous);
      insertChild(row, row.children.length, script);
    }
    const slot = createRow(content, script, isSup ? 'sup' : 'sub');
    if (isSup) script.sup = slot;
    else script.sub = slot;
  }

  private parseAtom(): InlineNode[] {
    const tok = this.next();
    switch (tok.type) {
      case 'open': {
        const row = createRow();
        this.parseSequence(row, () => this.peek().type === 'close');
        if (this.peek().type === 'close') this.next();
        return detach(row);
      }
      case 'char':
        if (tok.value === '$') return [];
        return [charToken(tok.value)];
      case 'amp':
      case 'newline':
        return [];
      case 'command':
        return this.parseCommand(tok.value);
      default:
        return [];
    }
  }

  private parseCommand(cmd: string): InlineNode[] {
    if (ignoredCommands.has(cmd)) return [];
    if (cmd === '\\left') return this.parseFence();
    if (fracCommands[cmd]) {
      const num = this.parseArgument();
      const den = this.parseArgument();
      return [createFrac(num, den, fracCommands[cmd])];
    }
    if (cmd === '\\sqrt') {
      const index = this.parseOptionalArgument();
      const base = this.parseArgument();
      return [createRoot(base, index)];
    }
    if (cmd === '\\text' || cmd === '\\textrm' || cmd === '\\mbox' || cmd === '\\textnormal') {
      return Array.from(this.readTextArgument()).map(ch => createToken('mtext', ch));
    }
    if (cmd === '\\textbf' || cmd === '\\textit') {
      return Array.from(this.readTextArgument()).map(ch => createToken('mtext', ch, { variant: cmd === '\\textbf' ? 'bold' : 'italic' }));
    }
    if (variantCommands[cmd]) {
      const variant = variantCommands[cmd];
      if (cmd === '\\operatorname') {
        const name = this.readTextArgument();
        return [createToken('mi', name, { variant: 'normal', latex: `\\operatorname{${name}}` })];
      }
      const content = this.parseArgument();
      const tokens = content.filter((n): n is TokenNode => n.type === 'token');
      if (cmd === '\\mathbb' && tokens.length === 1 && content.length === 1) {
        const info = symbolsByLatex.get(`\\mathbb{${tokens[0].text}}`);
        if (info) return [createToken('mi', info.char, { latex: info.latex })];
      }
      for (const node of content) {
        if (node.type === 'token' && !node.latex) node.variant = variant;
      }
      return content;
    }
    if (accentCommands[cmd]) {
      const def = accentCommands[cmd];
      const base = this.parseArgument();
      return [createAccent(base, def.mark, cmd, def.position, def.stretchy)];
    }
    if (xarrowCommands[cmd]) {
      const under = this.parseOptionalArgument();
      const over = this.parseArgument();
      return [createXArrow(xarrowCommands[cmd].arrow, cmd, over, under)];
    }
    if (encloseCommands[cmd]) {
      return [createEnclose(this.parseArgument(), encloseCommands[cmd])];
    }
    if (cmd === '\\overset' || cmd === '\\underset' || cmd === '\\stackrel') {
      const label = this.parseArgument();
      const base = this.parseArgument();
      const script = createScript(base, cmd === '\\underset' ? label : null, cmd === '\\underset' ? null : label, true);
      return [script];
    }
    if (cmd === '\\textcolor' || cmd === '\\color') {
      const color = this.readTextArgument();
      const body = cmd === '\\color' ? this.parseRestOfGroup() : this.parseArgument();
      return [createStyle(body, { color })];
    }
    if (cmd === '\\colorbox' || cmd === '\\fcolorbox') {
      const background = this.readTextArgument();
      if (cmd === '\\fcolorbox') this.readTextArgument();
      const body = this.parseArgument();
      return [createStyle(body, { background })];
    }
    if (cmd === '\\raisebox') {
      const length = this.readTextArgument();
      const body = this.parseArgument();
      return [createStyle(body, { voffset: parseLength(length) })];
    }
    if (cmd === '\\hspace' || cmd === '\\kern' || cmd === '\\mkern' || cmd === '\\mskip') {
      const length = this.readTextArgument();
      return [createSpace(parseLength(length), `${cmd}{${length}}`)];
    }
    if (cmd === '\\displaystyle' || cmd === '\\textstyle') {
      const body = this.parseRestOfGroup();
      return [createStyle(body, { displaystyle: cmd === '\\displaystyle' })];
    }
    if (sizeCommands[cmd]) {
      return [createStyle(this.parseRestOfGroup(), { size: sizeCommands[cmd] })];
    }
    if (cmd === '\\begin') {
      const name = this.readTextArgument();
      return this.parseEnvironment(name);
    }
    if (cmd === '\\end') {
      this.readTextArgument();
      return [];
    }
    if (cmd === '\\tag' || cmd === '\\label') {
      this.readTextArgument();
      return [];
    }
    if (spaceCommands[cmd] !== undefined) {
      return [createSpace(spaceCommands[cmd], cmd)];
    }
    if (functionNames.includes(cmd.slice(1))) {
      const name = cmd.slice(1);
      return [createToken('mi', name, { variant: 'normal', latex: cmd, largeop: limitOperators.has(cmd) })];
    }
    const symbol = symbolsByLatex.get(cmd);
    if (symbol) {
      return [createToken(symbol.kind, symbol.char, { latex: symbol.latex, largeop: largeOperators.has(symbol.latex) })];
    }
    // Unknown command: keep it verbatim, including a single brace argument if present.
    let raw = cmd;
    if (this.peek().type === 'open') {
      raw += '{' + this.readTextArgument() + '}';
    }
    return [createToken('mo', raw, { raw: true, latex: raw })];
  }

  /** Content up to the end of the current group (for `\color`, `\displaystyle`, size switches). */
  private parseRestOfGroup(): InlineNode[] {
    const row = createRow();
    this.parseSequence(row, () => this.peek().type === 'close' || (this.peek().type === 'command' && this.peek().value === '\\end'));
    return detach(row);
  }

  private parseFence(): InlineNode[] {
    const open = this.readDelimiter();
    const body = createRow();
    this.parseSequence(body, () => this.peek().type === 'command' && this.peek().value === '\\right');
    let close = '';
    if (this.peek().type === 'command' && this.peek().value === '\\right') {
      this.next();
      close = this.readDelimiter();
    }
    const children = detach(body);
    // `\left( \begin{array}…\end{array} \right)`: fold the delimiters into the table.
    if (children.length === 1 && children[0].type === 'table' && children[0].fence === 'none') {
      const type = fenceTypeByDelims[open + close];
      if (type !== undefined) {
        children[0].fence = type;
        return children;
      }
    }
    return [createFence(open, close, children)];
  }

  private readDelimiter(): string {
    const tok = this.next();
    if (tok.type === 'eof') return '';
    if (tok.type === 'open' || tok.type === 'close') return tok.value;
    if (fenceDelimiters[tok.value] !== undefined) return fenceDelimiters[tok.value];
    return tok.value.replace(/^\\/, '');
  }

  /** Reads `{...}` as plain text (for \text, \begin, unknown commands). */
  private readTextArgument(): string {
    if (this.peek().type !== 'open') {
      const tok = this.next();
      return tok.value;
    }
    this.next();
    let depth = 1;
    let text = '';
    while (this.rawPeek().type !== 'eof') {
      const tok = this.rawNext();
      if (tok.type === 'open') depth++;
      if (tok.type === 'close') {
        depth--;
        if (depth === 0) break;
      }
      if (tok.type === 'command' && tok.value === '\\ ') text += ' ';
      else text += tok.value;
    }
    return text;
  }

  private parseEnvironment(name: string): InlineNode[] {
    const fence = matrixEnvironments[name];
    if (fence === undefined) {
      // Unknown environment: parse its content inline.
      const row = createRow();
      this.parseSequence(row, () => this.peek().type === 'command' && this.peek().value === '\\end');
      if (this.peek().type !== 'eof') {
        this.next();
        this.readTextArgument();
      }
      return detach(row);
    }
    let columnSpec: string | null = null;
    if (name === 'array') {
      columnSpec = this.readTextArgument();
    }
    const cells: InlineNode[][][] = [[[]]];
    const hlines: number[] = []; // row indexes before which an \hline appears
    let r = 0;
    let c = 0;
    const row = createRow();
    const flush = () => {
      cells[r][c] = detach(row);
    };
    while (this.peek().type !== 'eof') {
      const tok = this.peek();
      if (tok.type === 'command' && tok.value === '\\end') {
        this.next();
        this.readTextArgument();
        break;
      }
      if (tok.type === 'command' && tok.value === '\\hline') {
        this.next();
        hlines.push(r);
        continue;
      }
      if (tok.type === 'amp') {
        this.next();
        flush();
        c++;
        cells[r][c] = [];
        continue;
      }
      if (tok.type === 'newline') {
        this.next();
        flush();
        r++;
        c = 0;
        cells[r] = [[]];
        continue;
      }
      if (tok.type === 'sup' || tok.type === 'sub') {
        this.next();
        this.applyScript(row, tok.type === 'sup');
        continue;
      }
      const nodes = this.parseAtom();
      for (const node of nodes) insertChild(row, row.children.length, node);
    }
    flush();
    // Drop a trailing empty row produced by a final `\\`.
    const lastIsEmpty = cells.length > 1 && cells[cells.length - 1].length === 1 && cells[cells.length - 1][0].length === 0;
    if (lastIsEmpty) cells.pop();
    const columns = Math.max(...cells.map(line => line.length));
    const table = createTable(cells.length, columns, fence, cells);
    if (columnSpec !== null) applyColumnSpec(table, columnSpec, hlines, cells.length);
    return [table];
  }
}

function detach(row: RowNode): InlineNode[] {
  const children = row.children.slice();
  children.forEach(child => removeChild(child));
  return children;
}

function isLimitsBase(node: InlineNode): boolean {
  if (node.type === 'token') return !!node.largeop && !!node.latex && limitOperators.has(node.latex);
  if (node.type === 'accent') return braceAccents.has(node.latex);
  return false;
}

function applyColumnSpec(table: TableNode, spec: string, hlines: number[], rowCount: number): void {
  const aligns: ColumnAlign[] = [];
  let bars = 0;
  let leadingBar = false;
  let trailingBar = false;
  let innerBars = false;
  for (const ch of spec) {
    if (ch === '|') {
      bars++;
      if (aligns.length === 0) leadingBar = true;
      else innerBars = true;
    } else if (ch === 'l') aligns.push('left');
    else if (ch === 'c') aligns.push('center');
    else if (ch === 'r') aligns.push('right');
  }
  if (spec.trimEnd().endsWith('|') && aligns.length) {
    trailingBar = true;
    if (bars === 1) leadingBar = false;
    innerBars = bars > (leadingBar ? 1 : 0) + 1;
  }
  const topLine = hlines.includes(0);
  const bottomLine = hlines.includes(rowCount);
  const inner = hlines.filter(index => index > 0 && index < rowCount);
  if (leadingBar && trailingBar && topLine && bottomLine) table.frame = true;
  if (innerBars) table.columnLines = true;
  if (inner.length === rowCount - 1 && rowCount > 1) table.rowLines = true;
  else if (inner.length || (bottomLine && !table.frame)) {
    const below = inner.map(index => index - 1);
    if (bottomLine && !table.frame) below.push(rowCount - 1);
    table.lineBelow = Array.from(new Set(below)).sort((a, b) => a - b);
  }
  if (aligns.length && aligns.some(a => a !== 'center')) table.columnAlign = aligns;
}

function parseLength(text: string): number {
  const match = /(-?[\d.]+)\s*(em|ex|pt|px|mu)?/.exec(text);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  switch (match[2]) {
    case 'ex':
      return value / 2;
    case 'pt':
      return value / 10;
    case 'px':
      return value / 16;
    case 'mu':
      return value / 18;
    default:
      return value;
  }
}

function charToken(ch: string): TokenNode {
  if (/[0-9]/.test(ch)) return createToken('mn', ch);
  if (/[a-zA-Z]/.test(ch)) return createToken('mi', ch);
  if (ch === '-') return createToken('mo', '−', { latex: '-' });
  if (ch === '*') return createToken('mo', '∗', { latex: '*' });
  if (ch === "'") return createToken('mo', '′', { latex: "'" });
  const info = symbolsByChar.get(ch);
  if (info) return createToken(info.kind, info.char, { latex: info.latex });
  return createToken('mo', ch);
}

export function parseLatex(latex: string): RowNode {
  return new Parser(tokenize(latex)).parse();
}

/* ------------------------------------------------------------------------------------------ */
/* Serialiser                                                                                  */
/* ------------------------------------------------------------------------------------------ */

const environmentByFence: Record<TableFence, string> = {
  none: 'matrix',
  paren: 'pmatrix',
  bracket: 'bmatrix',
  brace: 'Bmatrix',
  bar: 'vmatrix',
  'double-bar': 'Vmatrix',
  cases: 'cases'
};

const delimsByFence: Record<TableFence, [string, string]> = {
  none: ['.', '.'],
  paren: ['(', ')'],
  bracket: ['[', ']'],
  brace: ['\\{', '\\}'],
  bar: ['|', '|'],
  'double-bar': ['\\|', '\\|'],
  cases: ['\\{', '.']
};

const sizeToCommand: Record<StyleSize, string> = {
  tiny: '\\tiny',
  scriptsize: '\\scriptsize',
  small: '\\small',
  normal: '\\normalsize',
  large: '\\large',
  Large: '\\Large',
  huge: '\\huge'
};

export function rowToLatex(row: RowNode): string {
  let out = '';
  let i = 0;
  const children = row.children;
  while (i < children.length) {
    const node = children[i];
    // Group consecutive text tokens into one \text{} and consecutive variant tokens into one command.
    if (node.type === 'token' && node.kind === 'mtext') {
      const variant = node.variant;
      let text = '';
      while (i < children.length && children[i].type === 'token' && (children[i] as TokenNode).kind === 'mtext' && (children[i] as TokenNode).variant === variant) {
        text += (children[i] as TokenNode).text;
        i++;
      }
      out = join(out, `${variant === 'bold' ? '\\textbf' : variant === 'italic' ? '\\textit' : '\\text'}{${text}}`);
      continue;
    }
    if (node.type === 'token' && node.variant && node.variant !== 'italic' && !node.latex) {
      const variant = node.variant;
      let text = '';
      while (i < children.length) {
        const child = children[i];
        if (child.type === 'token' && child.kind !== 'mtext' && child.variant === variant && !child.latex) {
          text += child.text;
          i++;
        } else break;
      }
      out = join(out, `${variantToCommand(variant)}{${text}}`);
      continue;
    }
    out = join(out, nodeToLatex(node));
    i++;
  }
  return out;
}

function join(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  // A command followed by a letter needs a separating space.
  if (/\\[a-zA-Z]+$/.test(left) && /^[a-zA-Z]/.test(right)) return left + ' ' + right;
  return left + right;
}

function variantToCommand(variant: Variant): string {
  switch (variant) {
    case 'bold':
    case 'bold-italic':
      return '\\mathbf';
    case 'double-struck':
      return '\\mathbb';
    case 'script':
      return '\\mathcal';
    case 'fraktur':
      return '\\mathfrak';
    case 'sans-serif':
      return '\\mathsf';
    case 'monospace':
      return '\\mathtt';
    default:
      return '\\mathrm';
  }
}

function group(row: RowNode): string {
  return `{${rowToLatex(row)}}`;
}

function formatLength(em: number): string {
  return `${Number(em.toFixed(3))}em`;
}

function styleToLatex(node: StyleNode): string {
  let body = rowToLatex(node.body);
  if (node.displaystyle !== undefined) body = `{${node.displaystyle ? '\\displaystyle' : '\\textstyle'} ${body}}`;
  if (node.size) body = `{${sizeToCommand[node.size]} ${body}}`;
  if (node.background) body = `\\colorbox{${node.background}}{$${body}$}`;
  if (node.color) body = `\\textcolor{${node.color}}{${body}}`;
  if (node.voffset) body = `\\raisebox{${formatLength(node.voffset)}}{$${body}$}`;
  if (node.hspace) body = `\\hspace{${formatLength(node.hspace)}}${body}`;
  return body;
}

function tableToLatex(node: TableNode): string {
  const needsArray = node.frame || node.rowLines || node.columnLines || (node.columnAlign && node.columnAlign.length) || (node.lineBelow && node.lineBelow.length);
  if (!needsArray) {
    const env = environmentByFence[node.fence];
    const body = node.cells.map(row => row.map(cell => rowToLatex(cell)).join(' & ')).join(' \\\\ ');
    return `\\begin{${env}}${body}\\end{${env}}`;
  }
  const columns = node.cells[0] ? node.cells[0].length : 1;
  const aligns: string[] = [];
  for (let c = 0; c < columns; c++) {
    const align = node.columnAlign ? node.columnAlign[Math.min(c, node.columnAlign.length - 1)] : node.fence === 'cases' ? 'left' : 'center';
    aligns.push(align === 'left' ? 'l' : align === 'right' ? 'r' : 'c');
  }
  const separator = node.columnLines ? '|' : '';
  let spec = aligns.join(separator);
  if (node.frame) spec = `|${spec}|`;
  const hline = node.frame || node.rowLines ? '\\hline ' : '';
  const rows = node.cells.map(row => row.map(cell => rowToLatex(cell)).join(' & '));
  let body = node.frame ? '\\hline ' : '';
  const lineBelow = new Set(node.lineBelow || []);
  body += rows.map((row, r) => (r < rows.length - 1 ? `${row} \\\\ ${node.rowLines || lineBelow.has(r) ? '\\hline ' : ''}` : row)).join('');
  if (node.frame) body += ' \\\\ \\hline';
  else if (lineBelow.has(rows.length - 1)) body += ' \\\\ \\hline';
  void hline;
  const array = `\\begin{array}{${spec}}${body}\\end{array}`;
  if (node.fence === 'none') return array;
  const [open, close] = delimsByFence[node.fence];
  return `\\left${open}${array}\\right${close}`;
}

export function nodeToLatex(node: InlineNode): string {
  switch (node.type) {
    case 'token':
      if (node.latex) return node.latex;
      if (node.kind === 'mtext') return `\\text{${node.text}}`;
      if (node.variant && node.variant !== 'italic') return `${variantToCommand(node.variant)}{${node.text}}`;
      return symbolsByChar.get(node.text)?.latex ?? node.text;
    case 'space':
      return node.latex;
    case 'frac': {
      const cmd = node.kind && node.kind !== 'frac' ? `\\${node.kind}` : '\\frac';
      return `${cmd}${group(node.num)}${group(node.den)}`;
    }
    case 'root':
      return node.index ? `\\sqrt[${rowToLatex(node.index)}]${group(node.base)}` : `\\sqrt${group(node.base)}`;
    case 'script': {
      const baseLatex = node.base.children.length === 1 ? rowToLatex(node.base) : group(node.base);
      if (node.prescript) {
        let out = '{}';
        if (node.sub) out += `_${group(node.sub)}`;
        if (node.sup) out += `^${group(node.sup)}`;
        return node.base.children.length ? out + baseLatex : out;
      }
      const limitsBase = node.base.children.length === 1 && isLimitsBase(node.base.children[0]);
      if (node.limits && !limitsBase) {
        let out = baseLatex;
        if (node.sup) out = `\\overset${group(node.sup)}{${out}}`;
        if (node.sub) out = `\\underset${group(node.sub)}{${out}}`;
        return out;
      }
      let out = baseLatex;
      if (node.sub) out += `_${group(node.sub)}`;
      if (node.sup) out += `^${group(node.sup)}`;
      return out;
    }
    case 'accent':
      return `${node.latex}${group(node.base)}`;
    case 'fence':
      if (node.stretchy === false) {
        const plain = (char: string) => (char === '{' ? '\\{' : char === '}' ? '\\}' : char === '‖' ? '\\|' : char);
        return `${plain(node.open)}${rowToLatex(node.body)}${plain(node.close)}`;
      }
      return `\\left${delimiterToLatex(node.open)}${rowToLatex(node.body)}\\right${delimiterToLatex(node.close)}`;
    case 'table':
      return tableToLatex(node);
    case 'style':
      return styleToLatex(node);
    case 'enclose': {
      const cmd = Object.entries(encloseCommands).find(([, notation]) => notation === node.notation)?.[0] || '\\boxed';
      return `${cmd}${group(node.body)}`;
    }
    case 'xarrow':
      return `${node.latex}${node.under ? `[${rowToLatex(node.under)}]` : ''}${group(node.over)}`;
  }
}

export function toLatex(root: RowNode): string {
  return rowToLatex(root);
}
