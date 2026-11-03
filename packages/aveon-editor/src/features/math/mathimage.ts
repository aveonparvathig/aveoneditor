/**
 * Self-contained equation images: SVG drawn as paths (no fonts needed, so they show the same in
 * e-mail, Word, PDF and on any web page) and PNG made from that SVG.
 *
 * The drawing is done by MathJax, loaded on first use as a separate chunk. It also understands
 * `\ce{…}` chemistry (mhchem), which the editor's KaTeX preview does not.
 */

interface MathJaxRenderer {
  toSvg(equation: string, display: boolean): string;
}

let renderer: MathJaxRenderer | null = null;
let rendererPromise: Promise<MathJaxRenderer> | null = null;

/** Pixels per `ex` for an equation drawn at 16px, MathJax's default. */
const EX_TO_PX = 8;

/** Loads MathJax on first use. */
export function loadMathImageRenderer(): Promise<MathJaxRenderer> {
  if (!rendererPromise) {
    rendererPromise = Promise.all([
      import('mathjax-full/js/mathjax.js'),
      import('mathjax-full/js/input/tex.js'),
      import('mathjax-full/js/output/svg.js'),
      import('mathjax-full/js/adaptors/liteAdaptor.js'),
      import('mathjax-full/js/handlers/html.js'),
      import('mathjax-full/js/input/tex/AllPackages.js')
    ]).then(([{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }]) => {
      const adaptor = liteAdaptor();
      RegisterHTMLHandler(adaptor);
      const document = mathjax.document('', {
        InputJax: new TeX({ packages: AllPackages }),
        OutputJax: new SVG({ fontCache: 'none' })
      });
      renderer = {
        toSvg(equation, display) {
          const container = document.convert(equation, { display });
          const svg = adaptor.firstChild(container) as any;
          return adaptor.outerHTML(svg);
        }
      };
      return renderer;
    });
    rendererPromise.catch(() => (rendererPromise = null));
  }
  return rendererPromise;
}

/** Whether MathJax has loaded (`renderEquationSvgSync` works from then on). */
export function isMathImageRendererReady(): boolean {
  return !!renderer;
}

/**
 * The equation number (`\tag{1}`) is written next to the image's equation: MathJax would stretch a
 * tagged equation to the full line width, which an image cannot have.
 */
function splitTag(equation: string): { body: string; tag: string } {
  const match = /\\tag(\*?)\{([^{}]*)\}\s*$/.exec(equation);
  if (!match) return { body: equation, tag: '' };
  return { body: equation.slice(0, match.index), tag: match[1] ? match[2] : `(${match[2]})` };
}

/**
 * An SVG of the equation, sized in pixels, with the baseline offset in `style` (vertical-align) so an
 * inline image sits on the text line. Requires `loadMathImageRenderer()` to have finished.
 */
export function renderEquationSvgSync(equation: string, display: boolean): string {
  if (!renderer) throw new Error('aveon-math-image-not-loaded: call loadMathImageRenderer() first.');
  const { body, tag } = splitTag(equation);
  const source = tag ? `${body}\\qquad\\text{${tag.replace(/[{}\\]/g, '')}}` : body;
  let svg = renderer.toSvg(source, display);
  // Pixel sizes: `ex` depends on the font of the page showing the image.
  svg = svg.replace(/(width|height)="([\d.]+)ex"/g, (_m, name, value) => `${name}="${(Number(value) * EX_TO_PX).toFixed(2)}"`);
  svg = svg.replace(/vertical-align:\s*(-?[\d.]+)ex/, (_m, value) => `vertical-align: ${(Number(value) * EX_TO_PX).toFixed(2)}px`);
  // `currentColor` is black inside an image; say so, so every viewer agrees.
  svg = svg.replace('<svg ', '<svg color="#000" ');
  return svg;
}

/** Same as `renderEquationSvgSync`, loading MathJax first if needed. */
export async function renderEquationSvg(equation: string, display: boolean): Promise<string> {
  await loadMathImageRenderer();
  return renderEquationSvgSync(equation, display);
}

/** Size (px) and baseline offset (px, negative = below the line) of an SVG from `renderEquationSvgSync`. */
export function getSvgMetrics(svg: string): { width: number; height: number; verticalAlign: number } {
  const number = (re: RegExp) => Number((re.exec(svg) || [])[1] || 0);
  return { width: number(/\swidth="([\d.]+)"/), height: number(/\sheight="([\d.]+)"/), verticalAlign: number(/vertical-align:\s*(-?[\d.]+)px/) };
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg).replace(/%20/g, ' ')}`;
}

/** A PNG (data URI) of an SVG from `renderEquationSvgSync`, drawn at `scale` times its size for sharp print. */
export function svgToPng(svg: string, scale = 3): Promise<string> {
  const { width, height } = getSvgMetrics(svg);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(width * scale));
      canvas.height = Math.max(1, Math.ceil(height * scale));
      const context = canvas.getContext('2d');
      if (!context) return reject(new Error('aveon-math-image-no-canvas'));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('aveon-math-image-png-failed'));
    image.src = svgToDataUri(svg);
  });
}

export type EquationImageFormat = 'svg' | 'png';

/** An `<img>` of the equation, sized and aligned to the text line, with its spoken text as `alt`. */
export async function renderEquationImageTag(equation: string, display: boolean, options: { format?: EquationImageFormat; alt?: string; className?: string } = {}): Promise<string> {
  const svg = await renderEquationSvg(equation, display);
  const { width, height, verticalAlign } = getSvgMetrics(svg);
  const src = options.format === 'png' ? await svgToPng(svg) : svgToDataUri(svg);
  const alt = escapeAttribute(options.alt || equation);
  const className = options.className ? ` class="${escapeAttribute(options.className)}"` : '';
  const style = display ? 'display:block;margin:0.6em auto' : `vertical-align:${verticalAlign}px`;
  return `<img${className} src="${src}" width="${Math.round(width)}" height="${Math.round(height)}" style="${style}" alt="${alt}" data-equation="${escapeAttribute(equation)}">`;
}

function escapeAttribute(text: string): string {
  return text.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}
