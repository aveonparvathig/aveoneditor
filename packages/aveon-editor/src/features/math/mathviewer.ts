/**
 * Shows the equations of saved editor content on a read-only page (articles, product pages, e-mails
 * rendered in the browser). The editor stores equations as `<span class="math-tex">\(…\)</span>` by
 * default; this turns them into something the browser can display:
 *
 *   import { renderEquations } from '@aveon/editor';
 *   renderEquations(document.querySelector('article'));
 *
 * or, with no bundler, one script tag that renders the whole page when it loads:
 *
 *   <script type="module" src="aveon-math-viewer.js"></script>
 *
 * Output `mathml` (default) uses the browser's own MathML: no download, no fonts, read by screen
 * readers. `svg` draws self-contained images (MathJax, loaded on first use); `katex` uses KaTeX,
 * which needs KaTeX's stylesheet on the page.
 */

import { parseLatex } from './model/latex';
import { toMathML } from './model/mathml';
import { toSpeech } from './model/speech';
import { parseDelimitedEquation, stripTag } from './model/delimiters';

export type EquationViewerOutput = 'mathml' | 'svg' | 'katex';

export interface RenderEquationsOptions {
  /** How equations are drawn (default `mathml`). */
  output?: EquationViewerOutput;
  /** Language of the spoken text (default: the page's `lang`, then English). */
  language?: string;
}

const SELECTOR = 'span.math-tex, script[type^="math/tex"]';
const DONE = 'data-aveon-rendered';

/**
 * Renders every equation inside `root` (default: the whole page) and resolves with how many were
 * drawn. Equations already rendered are skipped, so it is safe to call again after new content
 * arrives.
 */
export async function renderEquations(root: ParentNode = document.body, options: RenderEquationsOptions = {}): Promise<number> {
  const output = options.output || 'mathml';
  const doc = (root as Node).ownerDocument || (root as Document);
  const language = options.language || doc.documentElement?.lang || 'en';
  const elements = [...root.querySelectorAll<HTMLElement>(SELECTOR)].filter(element => !element.hasAttribute(DONE));
  let count = 0;
  for (const element of elements) {
    const value = parseDelimitedEquation(element.textContent || '');
    if ((element.getAttribute('type') || '').includes('mode=display')) value.display = true;
    if (!value.equation) continue;
    const { equation, numbered } = stripTag(value.equation);
    const tag = numbered ? (/\\tag\*?\{([^}]*)\}\s*$/.exec(value.equation) || [])[1] || '' : '';
    const speech = element.getAttribute('aria-label') || speechOf(equation, language);
    const holder = doc.createElement(value.display ? 'div' : 'span');
    holder.className = value.display ? 'math-tex math-tex-display' : 'math-tex';
    holder.setAttribute(DONE, output);
    try {
      if (output === 'svg') {
        const { renderEquationImageTag } = await import('./mathimage');
        holder.innerHTML = await renderEquationImageTag(equation, value.display, { alt: speech });
      } else if (output === 'katex') {
        const katex = await loadKatexModule();
        holder.innerHTML = katex.renderToString(equation, { displayMode: value.display, throwOnError: false, output: 'htmlAndMathml' });
      } else {
        holder.innerHTML = toMathML(parseLatex(equation), { display: value.display, annotation: equation, alttext: speech });
      }
    } catch (error) {
      console.warn('math-viewer-render-failed: an equation is shown as its source.', error);
      continue;
    }
    if (tag) {
      // The equation number at the right edge, as in the editor.
      holder.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:2em';
      const number = doc.createElement('span');
      number.className = 'math-tex-number';
      number.textContent = value.equation.includes('\\tag*') ? tag : `(${tag})`;
      number.style.cssText = 'margin-left:auto';
      holder.insertBefore(doc.createElement('span'), holder.firstChild).style.cssText = 'margin-right:auto';
      holder.appendChild(number);
    }
    element.replaceWith(holder);
    count++;
  }
  return count;
}

function speechOf(equation: string, language: string): string {
  try {
    return toSpeech(parseLatex(equation), language.slice(0, 2).toLowerCase()) || equation;
  } catch {
    return equation;
  }
}

let katexPromise: Promise<any> | null = null;
function loadKatexModule(): Promise<any> {
  if (!katexPromise) katexPromise = import('katex').then(module => (module as any).default || module);
  return katexPromise;
}
