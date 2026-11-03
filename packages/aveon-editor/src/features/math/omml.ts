/**
 * Word equations (Office Math, OMML) to MathML, for pasting from Word.
 *
 * Word puts each equation on the clipboard twice: as OMML inside a conditional comment
 * (`<!--[if gte msEquation 12]>…<![endif]-->`, which other programs ignore) and as a picture of it
 * (`<![if !msEquation]><img src="file:///…">…<![endif]>`) that points to a temporary file the browser
 * cannot read. `extractWordEquations()` swaps the pair for MathML, which the editor turns into an
 * editable equation.
 */

const EQUATION = /<!--\[if gte msEquation 12\]>([\s\S]*?)<!\[endif\]-->(\s*<!\[if !msEquation\]>[\s\S]*?<!\[endif\]>)?/gi;

/** Replaces Word's equations in clipboard HTML with MathML. HTML without them is returned unchanged. */
export function extractWordEquations(html: string): string {
  if (!html.includes('msEquation') || typeof DOMParser === 'undefined') return html;
  return html.replace(EQUATION, (whole, omml: string) => {
    const mathml = ommlToMathML(omml);
    return mathml || whole;
  });
}

/**
 * MathML for OMML markup (`<m:oMathPara>` or `<m:oMath>`, with or without namespace declarations).
 * A paragraph of equations (`oMathPara`) becomes display equations; returns '' when there is none.
 */
export function ommlToMathML(omml: string): string {
  // The HTML parser keeps prefixed names (`m:omath`) as plain elements and tolerates Word's markup,
  // but ignores `/>`: write out empty elements (`<m:deg/>`) or they would swallow what follows.
  const expanded = omml.replace(/<(m:[\w]+)([^<>]*?)\s*\/>/gi, '<$1$2></$1>');
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${expanded}`, 'text/html');
  const maths = [...doc.body.getElementsByTagName('*')].filter(element => name(element) === 'omath' && !ancestor(element, 'omath'));
  return maths
    .map(math => {
      const display = !!ancestor(math, 'omathpara');
      return `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ''}>${row(math)}</math>`;
    })
    .join('');
}

/** OMML element name without its prefix, lower case (`m:sSup` → `ssup`). */
function name(element: Element): string {
  const local = element.localName.toLowerCase();
  const colon = local.indexOf(':');
  return colon >= 0 ? local.slice(colon + 1) : local;
}

function isMath(element: Element): boolean {
  return element.localName.toLowerCase().startsWith('m:');
}

function ancestor(element: Element, wanted: string): Element | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (isMath(parent) && name(parent) === wanted) return parent;
  }
  return null;
}

/** The first OMML child with this name. */
function child(element: Element | null, wanted: string): Element | null {
  if (!element) return null;
  for (const node of Array.from(element.children)) {
    if (isMath(node) && name(node) === wanted) return node;
    // Word wraps runs in formatting spans; look through them.
    if (!isMath(node)) {
      const inner = child(node, wanted);
      if (inner) return inner;
    }
  }
  return null;
}

function children(element: Element, wanted: string): Element[] {
  const found: Element[] = [];
  for (const node of Array.from(element.children)) {
    if (isMath(node) && name(node) === wanted) found.push(node);
    else if (!isMath(node)) found.push(...children(node, wanted));
  }
  return found;
}

/** A property value: `<m:chr m:val="∑"/>` inside the element's `…Pr` child. */
function prop(element: Element, wanted: string): string | null {
  const properties = Array.from(element.children).find(node => isMath(node) && name(node).endsWith('pr'));
  const found = properties ? child(properties, wanted) : null;
  if (!found) return null;
  return found.getAttribute('m:val') ?? found.getAttribute('val') ?? '';
}

function isOn(value: string | null): boolean {
  return value !== null && value !== '0' && value !== 'off' && value !== 'false';
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

/** The content of an element as one `<mrow>`. */
function row(element: Element | null): string {
  if (!element) return '<mrow></mrow>';
  return `<mrow>${convertChildren(element)}</mrow>`;
}

function convertChildren(element: Element): string {
  let out = '';
  for (const node of Array.from(element.children)) {
    if (!isMath(node)) {
      out += convertChildren(node);
      continue;
    }
    out += convert(node);
  }
  return out;
}

function mo(text: string): string {
  return `<mo>${escape(text)}</mo>`;
}

function convert(element: Element): string {
  switch (name(element)) {
    case 'r':
      return run(element);
    case 'f': {
      const type = prop(element, 'type');
      const num = row(child(element, 'num'));
      const den = row(child(element, 'den'));
      if (type === 'lin') return `<mrow>${num}${mo('/')}${den}</mrow>`;
      return `<mfrac${type === 'nobar' || type === 'noBar' ? ' linethickness="0"' : ''}>${num}${den}</mfrac>`;
    }
    case 'ssup':
      return `<msup>${row(child(element, 'e'))}${row(child(element, 'sup'))}</msup>`;
    case 'ssub':
      return `<msub>${row(child(element, 'e'))}${row(child(element, 'sub'))}</msub>`;
    case 'ssubsup':
      return `<msubsup>${row(child(element, 'e'))}${row(child(element, 'sub'))}${row(child(element, 'sup'))}</msubsup>`;
    case 'spre':
      return `<mmultiscripts>${row(child(element, 'e'))}<none/><none/><mprescripts/>${row(child(element, 'sub'))}${row(child(element, 'sup'))}</mmultiscripts>`;
    case 'rad': {
      const degree = child(element, 'deg');
      const hidden = isOn(prop(element, 'deghide')) || !degree || !(degree.textContent || '').trim();
      return hidden ? `<msqrt>${row(child(element, 'e'))}</msqrt>` : `<mroot>${row(child(element, 'e'))}${row(degree)}</mroot>`;
    }
    case 'd': {
      const begin = prop(element, 'begchr');
      const end = prop(element, 'endchr');
      const separator = prop(element, 'sepchr') ?? '|';
      const parts = children(element, 'e').map(row);
      const open = begin === null ? '(' : begin;
      const close = end === null ? ')' : end;
      return `<mrow>${open ? mo(open) : ''}${parts.join(mo(separator))}${close ? mo(close) : ''}</mrow>`;
    }
    case 'nary': {
      const symbol = prop(element, 'chr') || '∫';
      const sub = isOn(prop(element, 'subhide')) ? '' : row(child(element, 'sub'));
      const sup = isOn(prop(element, 'suphide')) ? '' : row(child(element, 'sup'));
      const location = prop(element, 'limloc') || (/[∑∏∐⋃⋂⋁⋀]/.test(symbol) ? 'undOvr' : 'subSup');
      const under = location.toLowerCase() === 'undovr';
      const op = mo(symbol);
      let base = op;
      if (sub && sup) base = under ? `<munderover>${op}${sub}${sup}</munderover>` : `<msubsup>${op}${sub}${sup}</msubsup>`;
      else if (sub) base = under ? `<munder>${op}${sub}</munder>` : `<msub>${op}${sub}</msub>`;
      else if (sup) base = under ? `<mover>${op}${sup}</mover>` : `<msup>${op}${sup}</msup>`;
      return `<mrow>${base}${row(child(element, 'e'))}</mrow>`;
    }
    case 'func': {
      const fname = child(element, 'fname');
      const text = fname && !child(fname, 'limlow') && !child(fname, 'limupp') ? (fname.textContent || '').trim() : '';
      const nameMarkup = text ? `<mi>${escape(text)}</mi>` : row(fname);
      return `<mrow>${nameMarkup}<mo>&#x2061;</mo>${row(child(element, 'e'))}</mrow>`;
    }
    case 'acc':
      return `<mover accent="true">${row(child(element, 'e'))}${mo(accent(prop(element, 'chr') ?? '̂'))}</mover>`;
    case 'bar':
      return prop(element, 'pos') === 'top'
        ? `<mover accent="true">${row(child(element, 'e'))}${mo('¯')}</mover>`
        : `<munder accentunder="true">${row(child(element, 'e'))}${mo('_')}</munder>`;
    case 'groupchr': {
      const symbol = prop(element, 'chr') || '⏟';
      return prop(element, 'pos') === 'top' ? `<mover>${row(child(element, 'e'))}${mo(symbol)}</mover>` : `<munder>${row(child(element, 'e'))}${mo(symbol)}</munder>`;
    }
    case 'limlow':
      return `<munder>${row(child(element, 'e'))}${row(child(element, 'lim'))}</munder>`;
    case 'limupp':
      return `<mover>${row(child(element, 'e'))}${row(child(element, 'lim'))}</mover>`;
    case 'm':
      return `<mtable>${children(element, 'mr').map(r => `<mtr>${children(r, 'e').map(cell => `<mtd>${row(cell)}</mtd>`).join('')}</mtr>`).join('')}</mtable>`;
    case 'eqarr':
      return `<mtable>${children(element, 'e').map(line => `<mtr><mtd>${row(line)}</mtd></mtr>`).join('')}</mtable>`;
    case 'borderbox':
      return `<menclose notation="box">${row(child(element, 'e'))}</menclose>`;
    case 'phant':
      return isOn(prop(element, 'show')) ? row(child(element, 'e')) : `<mphantom>${row(child(element, 'e'))}</mphantom>`;
    case 'box':
    case 'e':
    case 'omath':
      return row(element);
    default:
      // Properties (…Pr) and Word's control characters carry no content.
      if (name(element).endsWith('pr') || name(element) === 'ctrlpr') return '';
      return convertChildren(element);
  }
}

/** Word writes accents as combining characters; MathML wants the spacing forms. */
function accent(symbol: string): string {
  const map: Record<string, string> = { '̂': '^', '̃': '~', '̇': '˙', '̈': '¨', '̄': '¯', '̅': '¯', '⃗': '→', '⃖': '←', '̌': 'ˇ', '̆': '˘', '́': '´', '̀': '`' };
  return map[symbol] || symbol;
}

/** A run of text: numbers, letters (one identifier each unless upright text) and operators. */
function run(element: Element): string {
  const texts = children(element, 't');
  const text = (texts.length ? texts.map(t => t.textContent || '').join('') : element.textContent || '').replace(/ /g, ' ');
  if (!text.trim()) return '';
  const style = prop(element, 'sty');
  if (isOn(prop(element, 'nor'))) return `<mtext>${escape(text)}</mtext>`;
  const upright = style === 'p';
  let out = '';
  const tokens = text.match(/\d+(?:[.,]\d+)*|[A-Za-zͰ-Ͽ]+|\s+|./gu) || [];
  for (const token of tokens) {
    if (/^\s+$/.test(token)) continue;
    if (/^\d/.test(token)) out += `<mn>${escape(token)}</mn>`;
    else if (/^[A-Za-zͰ-Ͽ]+$/.test(token)) {
      if (upright && token.length > 1) out += `<mi>${escape(token)}</mi>`;
      else for (const letter of token) out += upright ? `<mi mathvariant="normal">${escape(letter)}</mi>` : `<mi>${escape(letter)}</mi>`;
    } else out += mo(token);
  }
  return out;
}
