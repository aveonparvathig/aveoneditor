import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { Widget } from '../widget/widget';
import { toWidget } from '../widget/utils';
import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Element as ViewElement } from '../../engine/view/element';
import type { EventInfo } from '../../utils/eventinfo';
import { parseLatex, toLatex } from './model/latex';
import { toMathML, parseMathML, getTexAnnotation, domToMathMLLike, type MathMLElementLike } from './model/mathml';
import { toSpeech } from './model/speech';
import { parseDelimitedEquation, stripTag } from './model/delimiters';
import { loadMathImageRenderer, isMathImageRendererReady, renderEquationSvgSync, svgToDataUri, getSvgMetrics } from './mathimage';
import type { MathToolbarConfig } from './ui/catalogue';
import type { ColorDefinition } from '../../ui/colorgrid/colorgridview';
import type { HandwritingRecognizer } from './ui/handwriting/recognizer';

/** Rendering engine: KaTeX (bundled) or a custom function (e.g. MathJax). */
export type MathEngine = 'katex' | ((equation: string, element: HTMLElement, display: boolean) => void);

export type MathOutputType = 'span' | 'script' | 'mathml' | 'image';

export interface MathHandwritingConfig {
  /** Recognition service; the built-in basic recogniser is used when omitted. */
  recognizer?: HandwritingRecognizer;
  strokeWidth?: number;
  strokeColor?: string;
  deletionGesture?: boolean;
  recognitionDelay?: number;
  /** Hide the handwriting mode entirely. */
  enabled?: boolean;
}

export interface MathChemistryConfig {
  /** Registers the `chemType` toolbar button and the Chemistry tab. Default `true`. */
  enabled?: boolean;
}

export type MathNumberFormat = 'arabic' | 'roman' | 'alpha';

export interface MathNumberingConfig {
  /** `arabic` (1, 2, 3), `roman` (i, ii, iii) or `alpha` (a, b, c). Default `arabic`. */
  format?: MathNumberFormat;
  /** Template for the label, `{n}` is replaced with the number. Default `({n})`. */
  template?: string;
  /** Number every display equation by default. Default `false`. */
  all?: boolean;
}

export interface MathConfig {
  /** `'katex'` (default) or a custom renderer `(equation, element, display) => void`. */
  engine?: MathEngine;
  /**
   * How equations are written in `getData()`:
   * - `span` (default): `<span class="math-tex">\(…\)</span>`
   * - `script`: `<script type="math/tex">…</script>`
   * - `mathml`: `<math>` presentation markup with a TeX annotation
   */
  outputType?: MathOutputType;
  /** Extra options passed to `katex.render()`. */
  katexOptions?: Record<string, unknown>;
  /** Generate spoken descriptions (`aria-label` / `alttext`). Default `true`. */
  altText?: boolean;
  /** Mode the dialog opens in: `visual` (default), `latex`, `mathml`, `handwriting`, or `auto` (handwriting on touch devices). */
  defaultMode?: 'visual' | 'latex' | 'mathml' | 'handwriting' | 'auto';
  /** Language of the spoken descriptions (`en`, `es`, `fr`, `de` or a registered dictionary). Defaults to the content language. */
  speechLanguage?: string;
  /** Notation direction. `rtl` for Arabic notation. Default `ltr`. */
  direction?: 'ltr' | 'rtl';
  /** Decimal separator typed in the visual editor (`.` default, or `,`). */
  decimalSeparator?: '.' | ',';
  /** Renders an equation to an SVG string for `outputType: 'image'` (defaults to a KaTeX-based renderer). */
  imageRenderer?: (equation: string, display: boolean) => string;
  handwriting?: MathHandwritingConfig;
  chemistry?: MathChemistryConfig;
  /** Autoformat shortcuts in the visual editor (`/`, `^`, `_`, `<=`, brackets). Default `true`. */
  autoformat?: boolean;
  /** Typing `$…$`, `` $`…`$ `` or a paragraph of `$$…$$` in the text inserts an equation, as on GitHub. Default `true`. */
  dollarSyntax?: boolean;
  /** Toolbar customisation. */
  toolbar?: MathToolbarConfig;
  /** Colours offered by the colour pickers. */
  colors?: ColorDefinition[];
  /** Equation numbering. */
  numbering?: MathNumberingConfig;
}

export const MATH_INLINE = 'mathtex-inline';
export const MATH_DISPLAY = 'mathtex-display';

export interface MathValue {
  equation: string;
  display: boolean;
  numbered?: boolean;
}

export function isMathElement(node: unknown): node is ModelElement {
  const n = node as any;
  return !!n && typeof n.is === 'function' && n.is('element') && (n.name === MATH_INLINE || n.name === MATH_DISPLAY);
}

/** Returns the math element selected as an object (clicked widget), if any. */
export function getSelectedMathElement(selection: any): ModelElement | null {
  const element = selection.getSelectedElement();
  return isMathElement(element) ? element : null;
}

type Katex = typeof import('katex').default;

let katexLib: Katex | null = null;
let katexPromise: Promise<Katex> | null = null;
/** Previews drawn before KaTeX arrived; they are rendered properly once it loads. */
const pendingRenders = new Map<HTMLElement, () => void>();

let loadKatexStyles: (() => Promise<unknown>) | null = null;

/**
 * Registers a loader for KaTeX's stylesheet, run together with KaTeX itself (the script-tag build
 * uses it so pages without equations never download the math fonts).
 */
export function setKatexStylesLoader(loader: (() => Promise<unknown>) | null): void {
  loadKatexStyles = loader;
}

/**
 * Loads KaTeX on first use (a separate chunk for bundlers), so pages without equations never pay for
 * it. The Math plugin calls this during start-up; integrators may call it to preload.
 */
export function loadKatex(): Promise<Katex> {
  if (!katexPromise) {
    const styles = loadKatexStyles ? loadKatexStyles().catch(() => undefined) : Promise.resolve();
    katexPromise = Promise.all([import('katex'), styles]).then(([module]) => {
      katexLib = ((module as any).default || module) as Katex;
      for (const [element, render] of pendingRenders) {
        if (element.isConnected) render();
      }
      pendingRenders.clear();
      return katexLib;
    });
  }
  return katexPromise;
}

const renderCache = new Map<string, string>();
const RENDER_CACHE_LIMIT = 500;

/** Renders the equation into the DOM element with the configured engine (KaTeX output is cached). */
export function renderEquation(editor: Editor, equation: string, element: HTMLElement, display: boolean): void {
  const engine = (editor.config.get('math.engine') as MathEngine | undefined) || 'katex';
  if (typeof engine === 'function') {
    engine(equation, element, display);
    return;
  }
  if (!katexLib) {
    // Show the source until KaTeX has loaded, then draw the equation in place.
    element.textContent = equation;
    element.classList.add('ck-math-tex_loading');
    pendingRenders.set(element, () => {
      element.classList.remove('ck-math-tex_loading');
      renderEquation(editor, equation, element, display);
    });
    void loadKatex();
    return;
  }
  const katex = katexLib;
  const extra = (editor.config.get('math.katexOptions') as Record<string, unknown>) || {};
  const options = { displayMode: display, throwOnError: false, output: 'htmlAndMathml' as const, ...extra };
  const key = `${display ? 'D' : 'I'}:${JSON.stringify(extra)}:${equation}`;
  let html = renderCache.get(key);
  if (html === undefined) {
    html = katex.renderToString(equation, options);
    if (renderCache.size >= RENDER_CACHE_LIMIT) renderCache.delete(renderCache.keys().next().value!);
    renderCache.set(key, html);
  }
  element.innerHTML = html;
}

/** Spoken description of a LaTeX equation (falls back to the source when it cannot be parsed). */
export function getSpeechText(equation: string, language = 'en'): string {
  try {
    return toSpeech(parseLatex(equation), language) || equation;
  } catch {
    return equation;
  }
}

/** The language used for spoken descriptions. */
export function getSpeechLanguage(editor: Editor): string {
  return (editor.config.get('math.speechLanguage') as string) || editor.locale.contentLanguage || editor.locale.uiLanguage || 'en';
}

/**
 * An SVG image of the equation. Once the image renderer has loaded (`loadMathImageRenderer()`; the
 * editor loads it for `outputType: 'image'`) it is drawn as paths and needs no fonts. Before that it
 * falls back to KaTeX HTML inside a `foreignObject`, which needs the KaTeX fonts in the page.
 */
export function renderEquationToSvg(editor: Editor, equation: string, display: boolean): string {
  const custom = editor.config.get('math.imageRenderer') as ((equation: string, display: boolean) => string) | undefined;
  if (custom) return custom(equation, display);
  if (isMathImageRendererReady()) return renderEquationSvgSync(equation, display);
  const html = katexLib ? katexLib.renderToString(equation, { displayMode: display, throwOnError: false, output: 'html' }) : escapeXml(equation);
  const fontSize = 18;
  const estimate = Math.max(1, equation.replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}^_\\]/g, '').length);
  const width = Math.ceil(estimate * fontSize * 0.6 + 16);
  const height = Math.ceil(fontSize * (display ? 3.2 : 1.6));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:KaTeX_Main,'Times New Roman',serif;font-size:${fontSize}px;line-height:1.2;padding:4px;color:#000">${html}</div></foreignObject></svg>`;
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

/** Presentation MathML for a LaTeX equation, with the TeX source as annotation. */
export function getMathML(equation: string, display: boolean, alttext?: string, direction?: 'ltr' | 'rtl'): string {
  const mathml = toMathML(parseLatex(equation), { display, annotation: equation, alttext });
  return direction === 'rtl' ? mathml.replace('<math ', '<math dir="rtl" ') : mathml;
}

/** Formats an equation number according to `math.numbering`. */
export function formatEquationNumber(editor: Editor, n: number): string {
  const config = (editor.config.get('math.numbering') as MathNumberingConfig) || {};
  const format = config.format || 'arabic';
  let text = String(n);
  if (format === 'roman') text = toRoman(n);
  else if (format === 'alpha') text = toAlpha(n);
  return (config.template || '({n})').replace('{n}', text);
}

function toRoman(n: number): string {
  const numerals: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [value, symbol] of numerals) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out || '0';
}

function toAlpha(n: number): string {
  let out = '';
  while (n > 0) {
    n--;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

export { parseDelimitedEquation, stripTag };

/** Wraps the equation with the delimiters used in the data output. */
export function delimitEquation(equation: string, display: boolean): string {
  return display ? `\\[${equation}\\]` : `\\(${equation}\\)`;
}

/** Inserts a new equation or updates the selected one. `value` is `{ equation, display, numbered }` when a math widget is selected. */
export class MathCommand extends Command {
  declare public value: MathValue | null;

  public override refresh(): void {
    const model = this.editor.model;
    const selection = model.document.selection;
    const selected = getSelectedMathElement(selection);
    if (selected) {
      this.value = { equation: String(selected.getAttribute('equation') || ''), display: selected.name === MATH_DISPLAY, numbered: !!selected.getAttribute('numbered') };
      this.isEnabled = true;
      return;
    }
    this.value = null;
    const position = selection.getFirstPosition();
    this.isEnabled = !!position && !!model.schema.findAllowedParent(position, MATH_INLINE);
  }

  public override execute(options: { equation: string; display?: boolean; numbered?: boolean }): void {
    const editor = this.editor;
    const model = editor.model;
    const equation = (options.equation || '').trim();
    const display = !!options.display;
    const numbering = (editor.config.get('math.numbering') as MathNumberingConfig) || {};
    const numbered = display && (options.numbered !== undefined ? options.numbered : !!numbering.all);
    const elementName = display ? MATH_DISPLAY : MATH_INLINE;

    model.change(writer => {
      const selected = getSelectedMathElement(model.document.selection);
      if (selected && selected.name === elementName) {
        writer.setAttribute('equation', equation, selected);
        if (display) {
          if (numbered) writer.setAttribute('numbered', true, selected);
          else {
            writer.removeAttribute('numbered', selected);
            writer.removeAttribute('number', selected);
          }
        }
        placeCaretAfter(writer, model, selected, display);
        return;
      }
      if (selected) {
        // Switching between inline and display mode replaces the element.
        const position = writer.createPositionBefore(selected);
        writer.remove(selected);
        writer.setSelection(position);
      }
      const attributes: Record<string, unknown> = { equation };
      if (numbered) attributes.numbered = true;
      const element = writer.createElement(elementName, attributes);
      if (display) {
        model.insertObject(element, null, null, { findOptimalPosition: 'auto', setSelection: 'after' });
      } else {
        model.insertContent(element);
        placeCaretAfter(writer, model, element, false);
      }
    });
  }
}

/**
 * Puts the caret after an equation, so that the next "Insert equation" adds a new one instead of
 * editing this one (clicking an equation still selects it for editing).
 */
function placeCaretAfter(writer: any, model: any, element: ModelElement, display: boolean): void {
  if (!display) {
    writer.setSelection(element, 'after');
    return;
  }
  const range = model.schema.getNearestSelectionRange(writer.createPositionAfter(element), 'forward');
  if (range && !range.containsItem?.(element) && range.start.nodeAfter !== element) {
    writer.setSelection(range);
  } else {
    const paragraph = writer.createElement('paragraph');
    writer.insert(paragraph, writer.createPositionAfter(element));
    writer.setSelection(paragraph, 0);
  }
}

/** Schema, converters, numbering and the `math` command. */
export class MathEditing extends Plugin {
  public static override get pluginName(): string {
    return 'MathEditing';
  }

  public static override get requires() {
    return [Widget];
  }

  /**
   * Waits for KaTeX so equations render immediately once the editor is ready, and for the image
   * renderer when the data holds images, so `getData()` has the finished drawings.
   */
  public override afterInit(): Promise<unknown> | void {
    const editor = this.editor;
    const waits: Array<Promise<unknown>> = [];
    if (typeof editor.config.get('math.engine') !== 'function') {
      waits.push(loadKatex().catch(error => console.warn('math-katex-unavailable: KaTeX could not be loaded.', error)));
    }
    if (editor.config.get('math.outputType') === 'image' && !editor.config.get('math.imageRenderer')) {
      waits.push(loadMathImageRenderer().catch(error => console.warn('math-image-unavailable: the equation image renderer could not be loaded.', error)));
    }
    return Promise.all(waits);
  }

  public override init(): void {
    const editor = this.editor;
    const model = editor.model;
    const schema = model.schema;
    const conversion = editor.conversion;
    const t = editor.t;
    const altTextEnabled = () => editor.config.get('math.altText') !== false;
    const speechOf = (equation: string) => getSpeechText(equation, getSpeechLanguage(editor));
    const direction = () => (editor.config.get('math.direction') as 'ltr' | 'rtl' | undefined) || 'ltr';

    schema.register(MATH_INLINE, { allowWhere: '$text', isInline: true, isObject: true, allowAttributes: ['equation'] });
    schema.register(MATH_DISPLAY, { allowWhere: '$block', isBlock: true, isObject: true, allowAttributes: ['equation', 'numbered', 'number'] });

    // Keeps `number` in sync with the document order of numbered display equations.
    model.document.registerPostFixer(writer => {
      let changed = false;
      let count = 0;
      for (const root of model.document.roots) {
        if (root.rootName === '$graveyard') continue;
        for (const item of model.createRangeIn(root).getItems()) {
          if (!(item as any).is('element', MATH_DISPLAY)) continue;
          const element = item as ModelElement;
          if (element.getAttribute('numbered')) {
            count++;
            if (element.getAttribute('number') !== count) {
              writer.setAttribute('number', count, element);
              changed = true;
            }
          } else if (element.hasAttribute('number')) {
            writer.removeAttribute('number', element);
            changed = true;
          }
        }
      }
      return changed;
    });

    const equationWithTag = (modelElement: ModelElement, display: boolean): string => {
      const equation = String(modelElement.getAttribute('equation') || '');
      if (!display || !modelElement.getAttribute('numbered')) return equation;
      const number = Number(modelElement.getAttribute('number') || 1);
      const config = (editor.config.get('math.numbering') as MathNumberingConfig) || {};
      const label = formatEquationNumber(editor, number);
      const isDefault = !config.template || config.template === '({n})';
      return isDefault ? `${equation}\\tag{${label.slice(1, -1)}}` : `${equation}\\tag*{${label}}`;
    };

    for (const [modelName, display] of [
      [MATH_INLINE, false],
      [MATH_DISPLAY, true]
    ] as Array<[string, boolean]>) {
      conversion.for('dataDowncast').elementToStructure({
        model: modelName,
        view: (modelElement: ModelElement, { writer }: any) => {
          const equation = String(modelElement.getAttribute('equation') || '');
          const tagged = equationWithTag(modelElement, display);
          const numbered = display && !!modelElement.getAttribute('numbered');
          const outputType = ((editor.config.get('math.outputType') as MathOutputType) || 'span') as MathOutputType;
          const speech = altTextEnabled() ? speechOf(equation) : undefined;
          if (outputType === 'image') {
            const svg = renderEquationToSvg(editor, tagged, display);
            const attributes: Record<string, string> = { src: svgToDataUri(svg), class: display ? 'math-tex math-tex-display' : 'math-tex', 'data-equation': equation, alt: speech || equation, role: 'math' };
            const metrics = getSvgMetrics(svg);
            if (metrics.width && metrics.height) {
              attributes.width = String(Math.round(metrics.width));
              attributes.height = String(Math.round(metrics.height));
              if (!display && metrics.verticalAlign) attributes.style = `vertical-align:${metrics.verticalAlign}px`;
            }
            if (numbered) attributes['data-numbered'] = 'true';
            return writer.createEmptyElement('img', attributes);
          }
          if (outputType === 'script') {
            const script = writer.createContainerElement('script', { type: display ? 'math/tex; mode=display' : 'math/tex' });
            writer.insert(writer.createPositionAt(script, 0), writer.createText(tagged));
            return script;
          }
          if (outputType === 'mathml') {
            const view = mathmlToView(writer, getMathML(tagged, display, speech, direction()));
            if (numbered) writer.setAttribute('data-numbered', 'true', view);
            return view;
          }
          const attributes: Record<string, string> = { class: 'math-tex' };
          if (speech) {
            attributes.role = 'math';
            attributes['aria-label'] = speech;
          }
          if (numbered) attributes['data-numbered'] = 'true';
          const span = writer.createContainerElement('span', attributes);
          writer.insert(writer.createPositionAt(span, 0), writer.createText(delimitEquation(tagged, display)));
          return span;
        }
      });

      conversion.for('editingDowncast').elementToStructure({
        model: modelName,
        view: (modelElement: ModelElement, { writer }: any) => {
          const equation = String(modelElement.getAttribute('equation') || '');
          const tagged = equationWithTag(modelElement, display);
          const speech = altTextEnabled() ? speechOf(equation) : equation;
          const attributes: Record<string, string> = {
            class: `ck-math-tex ${display ? 'ck-math-tex-display' : 'ck-math-tex-inline'}`,
            'data-equation': equation,
            role: 'math',
            'aria-label': speech
          };
          if (direction() === 'rtl') attributes.dir = 'rtl';
          if (display && modelElement.getAttribute('numbered')) attributes['data-numbered'] = String(modelElement.getAttribute('number') || '');
          const container = writer.createContainerElement(display ? 'div' : 'span', attributes);
          const preview = writer.createRawElement('span', { class: 'ck-math-tex__preview', 'aria-hidden': 'true' }, (domElement: HTMLElement) => {
            domElement.innerHTML = '';
            renderEquation(editor, tagged, domElement, display);
          });
          writer.insert(writer.createPositionAt(container, 0), preview);
          return toWidget(container, writer, { label: `${t('Math equation')}: ${speech}` });
        }
      });
    }

    conversion.for('upcast').add(dispatcher => {
      dispatcher.on('element:span', upcastMath('span'), { priority: 'high' });
      dispatcher.on('element:script', upcastMath('script'), { priority: 'high' });
      dispatcher.on('element:math', upcastMathML(), { priority: 'high' });
      dispatcher.on('element:img', upcastImage(), { priority: 'high' });
      // GitHub and Markdown tools write display equations as a `math` code block.
      dispatcher.on('element:pre', upcastMathCodeBlock(), { priority: 'highest' });
    });

    editor.commands.add('math', new MathCommand(editor));
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Converters                                                                                  */
/* ------------------------------------------------------------------------------------------ */

function upcastMath(kind: 'span' | 'script') {
  return (evt: EventInfo, data: any, conversionApi: any): void => {
    const viewItem = data.viewItem as ViewElement;
    const scriptType = String(viewItem.getAttribute('type') || '');
    if (kind === 'span' && !viewItem.hasClass('math-tex')) return;
    if (kind === 'script' && !scriptType.startsWith('math/tex')) return;
    if (!conversionApi.consumable.test(viewItem, { name: true })) return;

    let { equation, display } = parseDelimitedEquation(collectText(viewItem));
    if (kind === 'script' && scriptType.includes('mode=display')) display = true;
    const stripped = stripTag(equation);
    const numbered = display && (stripped.numbered || viewItem.getAttribute('data-numbered') === 'true');

    insertMathElement(evt, data, conversionApi, stripped.equation, display, numbered);
  };
}

/** `<pre><code class="language-math">…</code></pre>` (a ```math block in Markdown) is a display equation. */
function upcastMathCodeBlock() {
  return (evt: EventInfo, data: any, conversionApi: any): void => {
    const pre = data.viewItem as ViewElement;
    const children = [...pre.getChildren()].filter((child: any) => !(child.is('$text') && !child.data.trim())) as any[];
    const code = children.length === 1 && children[0].is('element', 'code') ? (children[0] as ViewElement) : null;
    const isMath = (element: ViewElement | null) => !!element && (element.hasClass('language-math') || element.hasClass('lang-math'));
    if (!(isMath(code) || isMath(pre) || pre.getAttribute('lang') === 'math')) return;
    if (!conversionApi.consumable.test(pre, { name: true })) return;
    const equation = collectText(pre).trim();
    if (!equation) return;
    insertMathElement(evt, data, conversionApi, equation, true);
  };
}

function upcastImage() {
  return (evt: EventInfo, data: any, conversionApi: any): void => {
    const viewItem = data.viewItem as ViewElement;
    if (!conversionApi.consumable.test(viewItem, { name: true })) return;
    const equation = viewItem.getAttribute('data-equation');
    if (equation) {
      const display = viewItem.hasClass('math-tex-display');
      const numbered = display && viewItem.getAttribute('data-numbered') === 'true';
      insertMathElement(evt, data, conversionApi, String(equation), display, numbered);
      return;
    }
    // MathType (WIRIS) image formulas keep their MathML in `data-mathml`.
    const mathml = viewItem.getAttribute('data-mathml');
    if (!mathml) return;
    const converted = mathTypeMathMLToLatex(String(mathml));
    if (!converted) return;
    const stripped = stripTag(converted.equation);
    insertMathElement(evt, data, conversionApi, stripped.equation, converted.display, converted.display && stripped.numbered);
  };
}

/**
 * Reads MathType's "modified XML encoding", used to keep MathML in an HTML attribute: « » ¨ § `
 * stand for < > " & ' (see WIRIS's MathML attribute reference). Plain MathML is returned as is.
 */
export function decodeMathTypeMathML(value: string): string {
  if (!/[«»]/.test(value)) return value;
  return value.replace(/[«»¨§`]/g, ch => ({ '«': '<', '»': '>', '¨': '"', '§': '&', '`': "'" })[ch]!);
}

/** LaTeX of a MathType formula's MathML (its LaTeX annotation when it has one). */
export function mathTypeMathMLToLatex(value: string): { equation: string; display: boolean } | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${decodeMathTypeMathML(value)}`, 'text/html');
  const math = doc.body.querySelector('math');
  if (!math) return null;
  const like = domToMathMLLike(math);
  const annotation = getTexAnnotation(like);
  let equation = annotation && annotation.trim() ? annotation.trim() : '';
  if (!equation) {
    try {
      equation = toLatex(parseMathML(like));
    } catch {
      equation = (math.textContent || '').trim();
    }
  }
  if (!equation) return null;
  return { equation, display: math.getAttribute('display') === 'block' };
}

function upcastMathML() {
  return (evt: EventInfo, data: any, conversionApi: any): void => {
    const viewItem = data.viewItem as ViewElement;
    if (!conversionApi.consumable.test(viewItem, { name: true })) return;
    const like = viewToMathMLLike(viewItem);
    const annotation = getTexAnnotation(like);
    let equation: string;
    if (annotation !== null && annotation.trim()) {
      equation = annotation.trim();
    } else {
      try {
        equation = toLatex(parseMathML(like));
      } catch {
        equation = collectText(viewItem);
      }
    }
    const display = String(viewItem.getAttribute('display') || '') === 'block';
    const stripped = stripTag(equation);
    const numbered = display && (stripped.numbered || viewItem.getAttribute('data-numbered') === 'true');
    insertMathElement(evt, data, conversionApi, stripped.equation, display, numbered);
  };
}

function insertMathElement(evt: EventInfo, data: any, conversionApi: any, equation: string, display: boolean, numbered = false): void {
  const viewItem = data.viewItem as ViewElement;
  const attributes: Record<string, unknown> = { equation };
  if (numbered) attributes.numbered = true;
  const element = conversionApi.writer.createElement(display ? MATH_DISPLAY : MATH_INLINE, attributes);
  if (!conversionApi.safeInsert(element, data.modelCursor)) return;
  conversionApi.consumable.consume(viewItem, { name: true });
  consumeDescendants(viewItem, conversionApi);
  conversionApi.updateConversionResult(element, data);
  evt.stop();
}

function collectText(element: ViewElement): string {
  let text = '';
  for (const child of element.getChildren()) {
    const c = child as any;
    if (c.is('$text')) text += c.data;
    else if (c.is('element')) text += collectText(c);
  }
  return text;
}

function consumeDescendants(element: ViewElement, conversionApi: any): void {
  for (const child of element.getChildren()) {
    const c = child as any;
    if (c.is('$text')) {
      conversionApi.consumable.consume(c);
    } else if (c.is('element')) {
      conversionApi.consumable.consume(c, { name: true });
      consumeDescendants(c, conversionApi);
    }
  }
}

function viewToMathMLLike(element: ViewElement): MathMLElementLike {
  const attributes: Record<string, string> = {};
  for (const key of element.getAttributeKeys()) attributes[key] = String(element.getAttribute(key));
  const children: MathMLElementLike[] = [];
  let text = '';
  for (const child of element.getChildren()) {
    const c = child as any;
    if (c.is('$text')) text += c.data;
    else if (c.is('element')) children.push(viewToMathMLLike(c));
  }
  return { name: element.name.toLowerCase(), attributes, children, text };
}

/** Builds view elements from a MathML string (data pipeline). */
function mathmlToView(writer: any, mathml: string): any {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${mathml}`, 'text/html');
  const mathElement = doc.body.querySelector('math') || doc.body.firstElementChild!;
  const build = (dom: Element): any => {
    const attributes: Record<string, string> = {};
    for (const attr of Array.from(dom.attributes)) attributes[attr.name] = attr.value;
    const viewElement = writer.createContainerElement(dom.localName.toLowerCase(), attributes);
    let index = 0;
    for (const child of Array.from(dom.childNodes)) {
      if (child.nodeType === 1) {
        writer.insert(writer.createPositionAt(viewElement, index++), build(child as Element));
      } else if (child.nodeType === 3 && child.textContent) {
        writer.insert(writer.createPositionAt(viewElement, index++), writer.createText(child.textContent));
      }
    }
    return viewElement;
  };
  return build(mathElement);
}
