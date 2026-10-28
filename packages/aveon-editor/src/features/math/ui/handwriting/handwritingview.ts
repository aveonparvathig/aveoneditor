/**
 * Handwriting input: a drawing surface for touch, pen or mouse with undo, redo, clear and a
 * deletion gesture. Strokes are passed to the configured recogniser after a short pause and the
 * resulting LaTeX is fired as `recognized`.
 */

import { View } from '../../../../ui/view';
import { ButtonView } from '../../../../ui/button/buttonview';
import type { Locale } from '../../../../utils/locale';
import { boundingBox, boxesIntersect, createBasicRecognizer, isScribble, type HandwritingRecognizer, type RecognitionResult, type Stroke } from './recognizer';

export interface HandwritingOptions {
  recognizer?: HandwritingRecognizer;
  /** Stroke width in pixels. Default 3. */
  strokeWidth?: number;
  /** Stroke colour. Default the text colour. */
  strokeColor?: string;
  /** Scribbling over strokes deletes them. Default `true`. */
  deletionGesture?: boolean;
  /** Milliseconds of inactivity before recognition runs. Default 600. */
  recognitionDelay?: number;
  /** Read-only surface (no drawing). */
  readOnly?: boolean;
}

export class HandwritingView extends View {
  declare public element: HTMLDivElement | null;
  declare public latex: string;
  declare public confidence: number;
  declare public isRecognizing: boolean;
  public readonly undoButtonView: ButtonView;
  public readonly redoButtonView: ButtonView;
  public readonly clearButtonView: ButtonView;
  public strokes: Stroke[] = [];
  private _redo: Stroke[][] = [];
  private _canvas: HTMLCanvasElement | null = null;
  private _current: Stroke | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _recognitionId = 0;
  private readonly _options: Required<Omit<HandwritingOptions, 'strokeColor'>> & { strokeColor?: string };

  constructor(locale: Locale, options: HandwritingOptions = {}) {
    super(locale);
    const t = locale.t;
    this._options = {
      recognizer: options.recognizer || createBasicRecognizer(),
      strokeWidth: options.strokeWidth || 3,
      strokeColor: options.strokeColor,
      deletionGesture: options.deletionGesture !== false,
      recognitionDelay: options.recognitionDelay ?? 600,
      readOnly: !!options.readOnly
    };
    this.set('latex', '');
    this.set('confidence', 1);
    this.set('isRecognizing', false);

    this.undoButtonView = this._createButton(t('Undo stroke'), '↶', () => this.undo());
    this.redoButtonView = this._createButton(t('Redo stroke'), '↷', () => this.redo());
    this.clearButtonView = this._createButton(t('Clear'), '✕', () => this.clear());

    const toolbar = new View(locale);
    toolbar.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-math-handwriting__toolbar'], role: 'toolbar', 'aria-label': t('Handwriting tools') }, children: [this.undoButtonView, this.redoButtonView, this.clearButtonView] });

    const hint = new View(locale);
    hint.setTemplate({ tag: 'p', attributes: { class: ['ck', 'ck-math-handwriting__hint'] }, children: [t('Write the formula with a finger, pen or mouse. Scribble over a symbol to delete it.')] });

    this.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-math-handwriting', 'ck-reset_all-excluded'] }, children: [toolbar, hint] });
  }

  public override render(): void {
    super.render();
    const doc = this.element!.ownerDocument;
    this._canvas = doc.createElement('canvas');
    this._canvas.className = 'ck ck-math-handwriting__canvas';
    this._canvas.setAttribute('role', 'img');
    this._canvas.setAttribute('aria-label', this.locale ? this.locale.t('Handwriting area') : 'Handwriting area');
    this._canvas.style.touchAction = 'none';
    this.element!.insertBefore(this._canvas, this.element!.lastElementChild);
    this._canvas.addEventListener('pointerdown', evt => this._onPointerDown(evt));
    this._canvas.addEventListener('pointermove', evt => this._onPointerMove(evt));
    this._canvas.addEventListener('pointerup', evt => this._onPointerUp(evt));
    this._canvas.addEventListener('pointercancel', evt => this._onPointerUp(evt));
    this._canvas.addEventListener('pointerleave', evt => this._onPointerUp(evt));
    this._resize();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this._resize()).observe(this.element!);
    }
  }

  public focus(): void {
    this.element?.focus();
  }

  /** Replaces the strokes (e.g. when reopening) and redraws. */
  public setStrokes(strokes: Stroke[]): void {
    this.strokes = strokes.map(stroke => stroke.map(p => ({ ...p })));
    this._redo = [];
    this._draw();
    this._scheduleRecognition(0);
  }

  public clear(): void {
    if (!this.strokes.length) return;
    this._redo.push(this.strokes);
    this.strokes = [];
    this._draw();
    this._scheduleRecognition(0);
  }

  public undo(): void {
    if (!this.strokes.length) return;
    this._redo.push(this.strokes);
    this.strokes = this.strokes.slice(0, -1);
    this._draw();
    this._scheduleRecognition(0);
  }

  public redo(): void {
    const next = this._redo.pop();
    if (!next) return;
    this.strokes = next;
    this._draw();
    this._scheduleRecognition(0);
  }

  /** Runs recognition now (returns the result and updates `latex`). */
  public async recognize(): Promise<RecognitionResult> {
    const id = ++this._recognitionId;
    this.isRecognizing = true;
    try {
      const result = await this._options.recognizer.recognize(this.strokes);
      if (id === this._recognitionId) {
        this.latex = result.latex;
        this.confidence = result.confidence;
        this.fire('recognized', result);
      }
      return result;
    } catch (err) {
      this.fire('error', err);
      return { latex: this.latex, confidence: 0, symbols: [] };
    } finally {
      if (id === this._recognitionId) this.isRecognizing = false;
    }
  }

  /* --------------------------------------------------------------------------------------- */

  private _createButton(label: string, text: string, action: () => void): ButtonView {
    const button = new ButtonView(this.locale);
    button.set({ label, tooltip: true, withText: true });
    button.extendTemplate({ attributes: { class: ['ck-math-handwriting__button'] } });
    button.on('execute', action);
    button.on('render', () => {
      const labelElement = button.element!.querySelector('.ck-button__label');
      if (labelElement) labelElement.textContent = text;
    });
    return button;
  }

  private _resize(): void {
    if (!this._canvas || !this.element) return;
    const width = Math.max(200, this.element.clientWidth - 2);
    const height = 180;
    const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this._canvas.width = Math.round(width * ratio);
    this._canvas.height = Math.round(height * ratio);
    this._canvas.style.width = `${width}px`;
    this._canvas.style.height = `${height}px`;
    this._draw();
  }

  private _point(evt: PointerEvent): { x: number; y: number; t: number } {
    const rect = this._canvas!.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top, t: evt.timeStamp };
  }

  private _onPointerDown(evt: PointerEvent): void {
    if (this._options.readOnly || evt.button !== 0) return;
    evt.preventDefault();
    this._canvas!.setPointerCapture(evt.pointerId);
    this._current = [this._point(evt)];
    if (this._timer) clearTimeout(this._timer);
  }

  private _onPointerMove(evt: PointerEvent): void {
    if (!this._current) return;
    evt.preventDefault();
    this._current.push(this._point(evt));
    this._draw();
  }

  private _onPointerUp(evt: PointerEvent): void {
    if (!this._current) return;
    evt.preventDefault();
    const stroke = this._current;
    this._current = null;
    if (this._options.deletionGesture && isScribble(stroke)) {
      const box = boundingBox(stroke);
      const remaining = this.strokes.filter(s => !boxesIntersect(boundingBox(s), box));
      if (remaining.length !== this.strokes.length) {
        this._redo.push(this.strokes);
        this.strokes = remaining;
        this._draw();
        this._scheduleRecognition(0);
        return;
      }
    }
    if (stroke.length === 1) stroke.push({ ...stroke[0], x: stroke[0].x + 1 });
    this._redo = [];
    this.strokes = [...this.strokes, stroke];
    this._draw();
    this._scheduleRecognition(this._options.recognitionDelay);
  }

  private _scheduleRecognition(delay: number): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      void this.recognize();
    }, delay);
  }

  private _draw(): void {
    const canvas = this._canvas;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const height = canvas.height / ratio;
    const width = canvas.width / ratio;
    // Guide line.
    context.strokeStyle = 'rgba(0,0,0,0.12)';
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(8, height * 0.68);
    context.lineTo(width - 8, height * 0.68);
    context.stroke();
    context.setLineDash([]);
    context.strokeStyle = this._options.strokeColor || (typeof getComputedStyle !== 'undefined' ? getComputedStyle(canvas).color : 'black') || 'black';
    context.lineWidth = this._options.strokeWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const stroke of [...this.strokes, ...(this._current ? [this._current] : [])]) {
      context.beginPath();
      stroke.forEach((p, i) => (i === 0 ? context.moveTo(p.x, p.y) : context.lineTo(p.x, p.y)));
      context.stroke();
    }
  }
}
