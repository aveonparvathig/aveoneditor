import { parseDelimitedEquation, mathTypeMathMLToLatex } from './mathediting';
import { renderEquationImageTag, type EquationImageFormat } from './mathimage';
import { domToMathMLLike, getTexAnnotation, parseMathML } from './model/mathml';
import { toLatex } from './model/latex';

const EQUATION_SELECTOR = 'span.math-tex, script[type^="math/tex"], math, img.math-tex[data-equation], img[data-mathml]';

/** Whether the HTML holds equations in any of the forms the editor writes or reads. */
export function hasEquations(html: string): boolean {
  return /class="[^"]*math-tex|type="math\/tex|<math[\s>]|data-mathml=/.test(html);
}

/**
 * Replaces every equation in the HTML (`\(…\)` spans, `math/tex` scripts, MathML, equation and
 * MathType images) with a self-contained image, for exports and for pages that cannot run scripts:
 * SVG keeps it sharp at any size, PNG is for Word and e-mail programs that do not show SVG.
 */
export async function replaceEquationsWithImages(html: string, options: { format?: EquationImageFormat } = {}): Promise<string> {
  if (!hasEquations(html) || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  // Outermost equations only (a MathType image may sit inside an equation span, and so on).
  const found = [...doc.body.querySelectorAll<HTMLElement>(EQUATION_SELECTOR)].filter(element => !element.parentElement?.closest(EQUATION_SELECTOR));
  for (const element of found) {
    const equation = readEquation(element);
    if (!equation) continue;
    const alt = element.getAttribute('aria-label') || element.getAttribute('alttext') || element.getAttribute('alt') || equation.equation;
    try {
      const tag = await renderEquationImageTag(equation.equation, equation.display, { format: options.format, alt, className: equation.display ? 'math-tex math-tex-display' : 'math-tex' });
      const template = doc.createElement('template');
      template.innerHTML = tag;
      element.replaceWith(template.content);
    } catch (error) {
      console.warn('math-export-image-failed: an equation is exported as its source.', error);
    }
  }
  return doc.body.innerHTML;
}

function readEquation(element: HTMLElement): { equation: string; display: boolean } | null {
  const name = element.localName;
  if (name === 'img') {
    const source = element.getAttribute('data-equation');
    if (source) return { equation: source, display: element.classList.contains('math-tex-display') };
    return mathTypeMathMLToLatex(element.getAttribute('data-mathml') || '');
  }
  if (name === 'math') {
    const like = domToMathMLLike(element);
    let equation = (getTexAnnotation(like) || '').trim();
    if (!equation) {
      try {
        equation = toLatex(parseMathML(like));
      } catch {
        return null;
      }
    }
    return equation ? { equation, display: element.getAttribute('display') === 'block' } : null;
  }
  const value = parseDelimitedEquation(element.textContent || '');
  if (name === 'script' && (element.getAttribute('type') || '').includes('mode=display')) value.display = true;
  return value.equation ? { equation: value.equation, display: value.display } : null;
}
