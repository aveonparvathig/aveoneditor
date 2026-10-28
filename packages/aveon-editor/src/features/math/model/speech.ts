/**
 * Spoken description of a formula (used for alt text and `aria-label`), following ClearSpeak-style
 * phrasing: "a over b", "square root of x", "x squared", "sum from i equals 1 to n of …".
 * English is complete; other languages translate the structural phrases and the common symbols and
 * fall back to English for the rest.
 */

import type { InlineNode, RowNode, TokenNode } from './nodes';
import { accentCommands, encloseSpeech, greekLetters, symbolsByChar, xarrowCommands } from './symbols';

export interface SpeechDictionary {
  over: string;
  squareRootOf: string;
  cubeRootOf: string;
  nthRootOf: string;
  squared: string;
  cubed: string;
  toThePower: string;
  sub: string;
  from: string;
  to: string;
  of: string;
  withAbove: string;
  withBelow: string;
  choose: string;
  preSuperscript: string;
  preSubscript: string;
  matrix: string;
  determinant: string;
  cases: string;
  by: string;
  row: string;
  blank: string;
  in: string;
  highlighted: string;
  labelled: string;
  arrow: string;
  degrees: string;
  decimalPoint: string;
  /** Fraction words for small denominators: `{ '2': ['half', 'halves'], … }`. */
  fractions: Record<string, [string, string]>;
  /** Symbol and function name translations by character or name. */
  symbols: Record<string, string>;
  /** Enclosure notations. */
  enclose: Partial<Record<keyof typeof encloseSpeech, string>>;
  /** Accent names by LaTeX command. */
  accents: Record<string, string>;
}

const english: SpeechDictionary = {
  over: '{num} over {den}',
  squareRootOf: 'the square root of {x}',
  cubeRootOf: 'the cube root of {x}',
  nthRootOf: 'the {n}th root of {x}',
  squared: '{x} squared',
  cubed: '{x} cubed',
  toThePower: '{x} to the power {n}',
  sub: '{x} sub {n}',
  from: 'from',
  to: 'to',
  of: 'of',
  withAbove: 'with {x} above',
  withBelow: 'with {x} below',
  choose: '{n} choose {k}',
  preSuperscript: 'pre-superscript {x}',
  preSubscript: 'pre-subscript {x}',
  matrix: 'matrix',
  determinant: 'determinant',
  cases: 'cases',
  by: 'by',
  row: 'row {n}',
  blank: 'blank',
  in: 'in {color}',
  highlighted: 'highlighted {color}',
  labelled: 'labelled',
  arrow: 'arrow',
  degrees: 'degrees',
  decimalPoint: 'point',
  fractions: { '2': ['half', 'halves'], '3': ['third', 'thirds'], '4': ['quarter', 'quarters'], '5': ['fifth', 'fifths'], '6': ['sixth', 'sixths'], '7': ['seventh', 'sevenths'], '8': ['eighth', 'eighths'], '9': ['ninth', 'ninths'], '10': ['tenth', 'tenths'] },
  symbols: {},
  enclose: {},
  accents: {}
};

const spanish: SpeechDictionary = {
  ...english,
  over: '{num} entre {den}',
  squareRootOf: 'raíz cuadrada de {x}',
  cubeRootOf: 'raíz cúbica de {x}',
  nthRootOf: 'raíz {n}-ésima de {x}',
  squared: '{x} al cuadrado',
  cubed: '{x} al cubo',
  toThePower: '{x} elevado a {n}',
  sub: '{x} sub {n}',
  from: 'desde',
  to: 'hasta',
  of: 'de',
  withAbove: 'con {x} arriba',
  withBelow: 'con {x} abajo',
  choose: '{n} sobre {k}',
  preSuperscript: 'presuperíndice {x}',
  preSubscript: 'presubíndice {x}',
  matrix: 'matriz',
  determinant: 'determinante',
  cases: 'casos',
  by: 'por',
  row: 'fila {n}',
  blank: 'vacío',
  in: 'en {color}',
  highlighted: 'resaltado en {color}',
  labelled: 'con etiqueta',
  arrow: 'flecha',
  degrees: 'grados',
  decimalPoint: 'coma',
  fractions: { '2': ['medio', 'medios'], '3': ['tercio', 'tercios'], '4': ['cuarto', 'cuartos'], '5': ['quinto', 'quintos'], '6': ['sexto', 'sextos'], '7': ['séptimo', 'séptimos'], '8': ['octavo', 'octavos'], '9': ['noveno', 'novenos'], '10': ['décimo', 'décimos'] },
  symbols: { '+': 'más', '−': 'menos', '±': 'más menos', '×': 'por', '÷': 'dividido por', '⋅': 'por', '=': 'igual a', '≠': 'distinto de', '≈': 'aproximadamente igual a', '<': 'menor que', '>': 'mayor que', '≤': 'menor o igual que', '≥': 'mayor o igual que', '∞': 'infinito', '∑': 'sumatorio', '∏': 'producto', '∫': 'integral', '∈': 'pertenece a', '∉': 'no pertenece a', '∪': 'unión', '∩': 'intersección', '→': 'flecha derecha', '⇒': 'implica', '⇔': 'si y solo si', '(': 'abre paréntesis', ')': 'cierra paréntesis', '[': 'abre corchete', ']': 'cierra corchete', '{': 'abre llave', '}': 'cierra llave', '|': 'barra vertical', ',': 'coma', '…': 'puntos suspensivos', '∂': 'parcial', '∅': 'conjunto vacío', '∀': 'para todo', '∃': 'existe', '¬': 'no', '∧': 'y', '∨': 'o', sum: 'sumatorio', product: 'producto', integral: 'integral', sin: 'seno', cos: 'coseno', tan: 'tangente', log: 'logaritmo', ln: 'logaritmo neperiano', lim: 'límite', exp: 'exponencial', max: 'máximo', min: 'mínimo', det: 'determinante' },
  enclose: { box: 'en un recuadro', updiagonalstrike: 'tachado', downdiagonalstrike: 'tachado', crossout: 'tachado', horizontalstrike: 'tachado' },
  accents: { '\\hat': 'con sombrero', '\\bar': 'barra', '\\overline': 'barra', '\\underline': 'subrayado', '\\vec': 'vector', '\\overrightarrow': 'vector', '\\tilde': 'tilde', '\\dot': 'punto', '\\ddot': 'dos puntos', '\\overbrace': 'llave superior', '\\underbrace': 'llave inferior' }
};

const french: SpeechDictionary = {
  ...english,
  over: '{num} sur {den}',
  squareRootOf: 'racine carrée de {x}',
  cubeRootOf: 'racine cubique de {x}',
  nthRootOf: 'racine {n}-ième de {x}',
  squared: '{x} au carré',
  cubed: '{x} au cube',
  toThePower: '{x} puissance {n}',
  sub: '{x} indice {n}',
  from: 'de',
  to: 'à',
  of: 'de',
  withAbove: 'avec {x} au-dessus',
  withBelow: 'avec {x} en dessous',
  choose: '{n} parmi {k}',
  preSuperscript: 'exposant gauche {x}',
  preSubscript: 'indice gauche {x}',
  matrix: 'matrice',
  determinant: 'déterminant',
  cases: 'cas',
  by: 'par',
  row: 'ligne {n}',
  blank: 'vide',
  in: 'en {color}',
  highlighted: 'surligné en {color}',
  labelled: 'étiquetée',
  arrow: 'flèche',
  degrees: 'degrés',
  decimalPoint: 'virgule',
  fractions: { '2': ['demi', 'demis'], '3': ['tiers', 'tiers'], '4': ['quart', 'quarts'], '5': ['cinquième', 'cinquièmes'], '6': ['sixième', 'sixièmes'], '7': ['septième', 'septièmes'], '8': ['huitième', 'huitièmes'], '9': ['neuvième', 'neuvièmes'], '10': ['dixième', 'dixièmes'] },
  symbols: { '+': 'plus', '−': 'moins', '±': 'plus ou moins', '×': 'fois', '÷': 'divisé par', '⋅': 'fois', '=': 'égale', '≠': 'différent de', '≈': 'environ égal à', '<': 'inférieur à', '>': 'supérieur à', '≤': 'inférieur ou égal à', '≥': 'supérieur ou égal à', '∞': "l'infini", '∑': 'somme', '∏': 'produit', '∫': 'intégrale', '∈': 'appartient à', '∉': "n'appartient pas à", '∪': 'union', '∩': 'intersection', '→': 'flèche droite', '⇒': 'implique', '⇔': 'si et seulement si', '(': 'parenthèse ouvrante', ')': 'parenthèse fermante', '[': 'crochet ouvrant', ']': 'crochet fermant', '{': 'accolade ouvrante', '}': 'accolade fermante', '|': 'barre verticale', ',': 'virgule', '…': 'points de suspension', '∂': 'd rond', '∅': 'ensemble vide', '∀': 'pour tout', '∃': 'il existe', '¬': 'non', '∧': 'et', '∨': 'ou', sum: 'somme', product: 'produit', integral: 'intégrale', sin: 'sinus', cos: 'cosinus', tan: 'tangente', log: 'logarithme', ln: 'logarithme népérien', lim: 'limite', exp: 'exponentielle', max: 'maximum', min: 'minimum', det: 'déterminant' },
  enclose: { box: 'encadré', updiagonalstrike: 'barré', downdiagonalstrike: 'barré', crossout: 'barré', horizontalstrike: 'barré' },
  accents: { '\\hat': 'chapeau', '\\bar': 'barre', '\\overline': 'barre', '\\underline': 'souligné', '\\vec': 'vecteur', '\\overrightarrow': 'vecteur', '\\tilde': 'tilde', '\\dot': 'point', '\\ddot': 'deux points', '\\overbrace': 'accolade supérieure', '\\underbrace': 'accolade inférieure' }
};

const german: SpeechDictionary = {
  ...english,
  over: '{num} durch {den}',
  squareRootOf: 'Quadratwurzel aus {x}',
  cubeRootOf: 'Kubikwurzel aus {x}',
  nthRootOf: '{n}-te Wurzel aus {x}',
  squared: '{x} Quadrat',
  cubed: '{x} hoch drei',
  toThePower: '{x} hoch {n}',
  sub: '{x} Index {n}',
  from: 'von',
  to: 'bis',
  of: 'über',
  withAbove: 'mit {x} darüber',
  withBelow: 'mit {x} darunter',
  choose: '{n} über {k}',
  preSuperscript: 'linker Hochindex {x}',
  preSubscript: 'linker Tiefindex {x}',
  matrix: 'Matrix',
  determinant: 'Determinante',
  cases: 'Fallunterscheidung',
  by: 'mal',
  row: 'Zeile {n}',
  blank: 'leer',
  in: 'in {color}',
  highlighted: 'hervorgehoben in {color}',
  labelled: 'beschriftet mit',
  arrow: 'Pfeil',
  degrees: 'Grad',
  decimalPoint: 'Komma',
  fractions: { '2': ['Halb', 'Halbe'], '3': ['Drittel', 'Drittel'], '4': ['Viertel', 'Viertel'], '5': ['Fünftel', 'Fünftel'], '6': ['Sechstel', 'Sechstel'], '7': ['Siebtel', 'Siebtel'], '8': ['Achtel', 'Achtel'], '9': ['Neuntel', 'Neuntel'], '10': ['Zehntel', 'Zehntel'] },
  symbols: { '+': 'plus', '−': 'minus', '±': 'plus minus', '×': 'mal', '÷': 'geteilt durch', '⋅': 'mal', '=': 'gleich', '≠': 'ungleich', '≈': 'ungefähr gleich', '<': 'kleiner als', '>': 'größer als', '≤': 'kleiner oder gleich', '≥': 'größer oder gleich', '∞': 'unendlich', '∑': 'Summe', '∏': 'Produkt', '∫': 'Integral', '∈': 'Element von', '∉': 'nicht Element von', '∪': 'vereinigt mit', '∩': 'geschnitten mit', '→': 'Pfeil nach rechts', '⇒': 'impliziert', '⇔': 'genau dann wenn', '(': 'Klammer auf', ')': 'Klammer zu', '[': 'eckige Klammer auf', ']': 'eckige Klammer zu', '{': 'geschweifte Klammer auf', '}': 'geschweifte Klammer zu', '|': 'Betragsstrich', ',': 'Komma', '…': 'und so weiter', '∂': 'partiell', '∅': 'leere Menge', '∀': 'für alle', '∃': 'es existiert', '¬': 'nicht', '∧': 'und', '∨': 'oder', sum: 'Summe', product: 'Produkt', integral: 'Integral', sin: 'Sinus', cos: 'Kosinus', tan: 'Tangens', log: 'Logarithmus', ln: 'natürlicher Logarithmus', lim: 'Limes', exp: 'Exponentialfunktion', max: 'Maximum', min: 'Minimum', det: 'Determinante' },
  enclose: { box: 'eingerahmt', updiagonalstrike: 'durchgestrichen', downdiagonalstrike: 'durchgestrichen', crossout: 'durchgestrichen', horizontalstrike: 'durchgestrichen' },
  accents: { '\\hat': 'Dach', '\\bar': 'quer', '\\overline': 'quer', '\\underline': 'unterstrichen', '\\vec': 'Vektor', '\\overrightarrow': 'Vektor', '\\tilde': 'Tilde', '\\dot': 'Punkt', '\\ddot': 'zwei Punkte', '\\overbrace': 'Klammer darüber', '\\underbrace': 'Klammer darunter' }
};

export const speechDictionaries: Record<string, SpeechDictionary> = { en: english, es: spanish, fr: french, de: german };

/** Registers or extends a speech dictionary for a language (missing phrases fall back to English). */
export function addSpeechDictionary(language: string, dictionary: Partial<SpeechDictionary>): void {
  const existing = speechDictionaries[language] || english;
  speechDictionaries[language] = { ...existing, ...dictionary, symbols: { ...existing.symbols, ...(dictionary.symbols || {}) }, accents: { ...existing.accents, ...(dictionary.accents || {}) }, enclose: { ...existing.enclose, ...(dictionary.enclose || {}) }, fractions: { ...existing.fractions, ...(dictionary.fractions || {}) } };
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => (values[key] !== undefined ? values[key] : match));
}

const greekByChar = new Map(greekLetters.map(letter => [letter.char, letter.speech]));

class Speaker {
  constructor(private readonly dict: SpeechDictionary) {}

  private symbol(char: string, fallback: string): string {
    return this.dict.symbols[char] ?? fallback;
  }

  private token(token: TokenNode): string {
    if (token.raw) return token.text.replace(/^\\/, '');
    if (token.kind === 'mtext') return token.text;
    const info = symbolsByChar.get(token.text);
    if (info && token.kind !== 'mn') return this.symbol(token.text, info.speech);
    if (greekByChar.has(token.text)) return this.symbol(token.text, greekByChar.get(token.text)!);
    if (token.kind === 'mi' && token.text.length > 1) return this.symbol(token.text, token.text);
    if (token.text === '.' && token.kind === 'mn') return this.dict.decimalPoint;
    if (token.variant === 'bold' || token.variant === 'bold-italic') return `bold ${token.text}`;
    return token.text;
  }

  public row(row: RowNode): string {
    const parts: string[] = [];
    const children = row.children;
    let i = 0;
    while (i < children.length) {
      const node = children[i];
      if (node.type === 'token' && (node.kind === 'mn' || node.kind === 'mtext') && node.text !== '.') {
        const kind = node.kind;
        let text = '';
        while (i < children.length && children[i].type === 'token' && (children[i] as TokenNode).kind === kind && !(children[i] as TokenNode).raw && (children[i] as TokenNode).text !== '.') {
          text += (children[i] as TokenNode).text;
          i++;
        }
        parts.push(text);
        continue;
      }
      parts.push(this.node(node));
      i++;
    }
    return parts.filter(Boolean).join(' ');
  }

  public node(node: InlineNode): string {
    const d = this.dict;
    switch (node.type) {
      case 'token':
        return this.token(node);
      case 'space':
        return '';
      case 'frac': {
        const num = this.row(node.num);
        const den = this.row(node.den);
        if (node.kind === 'binom') return fill(d.choose, { n: num, k: den });
        if (isSimple(node.num) && isSimple(node.den) && /^\d+$/.test(num) && /^\d+$/.test(den)) {
          const name = d.fractions[den];
          if (name) return `${num} ${num === '1' ? name[0] : name[1]}`;
        }
        return fill(d.over, { num, den });
      }
      case 'root': {
        const x = this.row(node.base);
        if (!node.index) return fill(d.squareRootOf, { x });
        const index = this.row(node.index);
        if (index === '3') return fill(d.cubeRootOf, { x });
        if (index === '2') return fill(d.squareRootOf, { x });
        return fill(d.nthRootOf, { n: index, x });
      }
      case 'script': {
        const b = this.row(node.base);
        if (node.prescript) {
          const pre: string[] = [];
          if (node.sup) pre.push(fill(d.preSuperscript, { x: this.row(node.sup) }));
          if (node.sub) pre.push(fill(d.preSubscript, { x: this.row(node.sub) }));
          return `${pre.join(' ')} ${b}`.trim();
        }
        const token = node.base.children[0];
        const isOperator = !!(token && token.type === 'token' && token.largeop && node.base.children.length === 1);
        if (node.limits && !isOperator) {
          const parts: string[] = [b];
          if (node.sup) parts.push(fill(d.withAbove, { x: this.row(node.sup) }));
          if (node.sub) parts.push(fill(d.withBelow, { x: this.row(node.sub) }));
          return parts.join(' ');
        }
        if (node.limits || isOperator) {
          const from = node.sub ? ` ${d.from} ${this.row(node.sub)}` : '';
          const to = node.sup ? ` ${d.to} ${this.row(node.sup)}` : '';
          return `${b}${from}${to} ${d.of}`;
        }
        let out = b;
        if (node.sub) out = fill(d.sub, { x: out, n: this.row(node.sub) });
        if (node.sup) {
          const sup = this.row(node.sup);
          if (sup === '2') out = fill(d.squared, { x: out });
          else if (sup === '3') out = fill(d.cubed, { x: out });
          else if (sup === this.symbol('°', 'degrees') || sup === '∘') out = `${out} ${d.degrees}`;
          else out = fill(d.toThePower, { x: out, n: sup });
        }
        return out;
      }
      case 'accent': {
        const def = accentCommands[node.latex];
        const name = d.accents[node.latex] ?? (def ? def.speech : node.position === 'over' ? 'over' : 'under');
        return `${this.row(node.base)} ${name}`;
      }
      case 'fence': {
        const open = node.open ? this.symbol(node.open, symbolsByChar.get(node.open)?.speech || node.open) : '';
        const close = node.close ? this.symbol(node.close, symbolsByChar.get(node.close)?.speech || node.close) : '';
        return `${open} ${this.row(node.body)} ${close}`.trim();
      }
      case 'table': {
        const rows = node.cells.length;
        const columns = node.cells[0] ? node.cells[0].length : 0;
        const kind = node.fence === 'bar' ? d.determinant : node.fence === 'cases' ? d.cases : d.matrix;
        const body = node.cells.map((row, r) => `${fill(d.row, { n: String(r + 1) })}: ${row.map(cell => this.row(cell) || d.blank).join(', ')}`).join('; ');
        return `${rows} ${d.by} ${columns} ${kind}: ${body}`;
      }
      case 'style': {
        const body = this.row(node.body);
        const notes: string[] = [];
        if (node.color) notes.push(fill(d.in, { color: node.color }));
        if (node.background) notes.push(fill(d.highlighted, { color: node.background }));
        return notes.length ? `${body} ${notes.join(' ')}` : body;
      }
      case 'enclose':
        return `${this.row(node.body)} ${d.enclose[node.notation] ?? encloseSpeech[node.notation]}`;
      case 'xarrow': {
        const def = xarrowCommands[node.latex];
        const name = def ? this.symbol(node.arrow, def.speech) : d.arrow;
        const over = this.row(node.over);
        const under = node.under ? this.row(node.under) : '';
        return `${name}${over ? ` ${d.labelled} ${over}` : ''}${under ? ` ${fill(d.withBelow, { x: under })}` : ''}`;
      }
    }
  }
}

function isSimple(row: RowNode): boolean {
  return row.children.length === 1 && row.children[0].type === 'token';
}

export function rowToSpeech(row: RowNode, language = 'en'): string {
  return new Speaker(speechDictionaries[language.split(/[-_]/)[0]] || english).row(row);
}

export function nodeToSpeech(node: InlineNode, language = 'en'): string {
  return new Speaker(speechDictionaries[language.split(/[-_]/)[0]] || english).node(node);
}

/** Full spoken description of a formula in the given language (`en`, `es`, `fr`, `de`, or a registered one). */
export function toSpeech(root: RowNode, language = 'en'): string {
  return rowToSpeech(root, language).replace(/\s+/g, ' ').trim();
}
