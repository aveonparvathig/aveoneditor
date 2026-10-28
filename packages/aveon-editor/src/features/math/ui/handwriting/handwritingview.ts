/**
 * Handwriting input: a drawing surface for touch, pen or mouse with undo, redo, clear and a
 * deletion gesture. Strokes are passed to the configured recogniser after a short pause and the
 * resulting LaTeX is fired as `recognized`. Each recognised symbol is labelled on the surface and
 * alternative readings are offered as suggestions the user can pick.
 */

import { View } from '../../../../ui/view';
import { ButtonView } from '../../../../ui/button/buttonview';
import { icons } from '../../../../ui/icons';
import type { Locale } from '../../../../utils/locale';
import { boundingBox, boxesIntersect, createBasicRecognizer, isScribble, type HandwritingRecognizer, type Point, type RecognitionResult, type RecognizedSymbol, type Stroke } from './recognizer';

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
  /** Height of the writing area in pixels. Default 200. */
  height?: number;
  /** Labels each recognised symbol on the writing area. Default `true`. */
  showSymbolLabels?: boolean;
}

/** Symbols scoring below this are flagged as uncertain. */
const UNCERTAIN = 0.6;

export class HandwritingView extends View {
  declare public element: HTMLDivElement | null;
  declare public latex: string;
  declare public confidence: number;
  declare public isRecognizing: boolean;
  /** Other readings of the current strokes, offered as suggestions. */
  declare public alternatives: string[];
  public readonly undoButtonView: ButtonView;
  public readonly redoButtonView: ButtonView;
  public readonly clearButtonView: ButtonView;
  public strokes: Stroke[] = [];
  private _redo: Stroke[][] = [];
  private _canvas: HTMLCanvasElement | null = null;
  private _status: HTMLElement | null = null;
  private _suggestions: HTMLElement | null = null;
  private _current: Stroke | null = null;
  private _pointerId: number | null = null;
  private _penSeen = false;
  private _symbols: RecognizedSymbol[] = [];
  private _lastResult: RecognitionResult | null = null;
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
      readOnly: !!options.readOnly,
      height: options.height || 200,
      showSymbolLabels: options.showSymbolLabels !== false
    };
    this.set('latex', '');
    this.set('confidence', 1);
    this.set('isRecognizing', false);
    this.set('alternatives', []);

    this.undoButtonView = this._createButton(t('Undo stroke'), icons.undo, () => this.undo());
    this.redoButtonView = this._createButton(t('Redo stroke'), icons.redo, () => this.redo());
    this.clearButtonView = this._createButton(t('Clear'), icons.eraser, () => this.clear(), true);

    const toolbar = new View(locale);
    toolbar.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-math-handwriting__toolbar'], role: 'toolbar', 'aria-label': t('Handwriting tools') }, children: [this.undoButtonView, this.redoButtonView, this.clearButtonView] });

    const hint = new View(locale);
    hint.setTemplate({ tag: 'p', attributes: { class: ['ck', 'ck-math-handwriting__hint'] }, children: [t('Write one symbol at a time, left to right. Scribble over a symbol to erase it. Ctrl+Z undoes a stroke.')] });

    this.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-math-handwriting', 'ck-reset_all-excluded'] }, children: [toolbar, hint] });
  }

  public override render(): void {
    super.render();
    const doc = this.element!.ownerDocument;
    const t = this.locale ? this.locale.t : (s: string) => s;
    const toolbar = this.element!.firstElementChild!;

    this._status = doc.createElement('span');
    this._status.className = 'ck ck-math-handwriting__status';
    this._status.setAttribute('role', 'status');
    this._status.setAttribute('aria-live', 'polite');
    toolbar.appendChild(this._status);

    this._canvas = doc.createElement('canvas');
    this._canvas.className = 'ck ck-math-handwriting__canvas';
    this._canvas.setAttribute('role', 'img');
    this._canvas.setAttribute('aria-label', t('Handwriting area'));
    this._canvas.tabIndex = 0;
    this._canvas.style.touchAction = 'none';
    this.element!.insertBefore(this._canvas, this.element!.lastElementChild);

    this._suggestions = doc.createElement('div');
    this._suggestions.className = 'ck ck-math-handwriting__suggestions';
    this._suggestions.setAttribute('role', 'group');
    this._suggestions.setAttribute('aria-label', t('Other readings'));
    this._suggestions.hidden = true;
    this.element!.insertBefore(this._suggestions, this.element!.lastElementChild);

    this._canvas.addEventListener('pointerdown', evt => this._onPointerDown(evt));
    this._canvas.addEventListener('pointermove', evt => this._onPointerMove(evt));
    this._canvas.addEventListener('pointerup', evt => this._onPointerUp(evt));
    this._canvas.addEventListener('pointercancel', evt => this._onPointerUp(evt));
    this._canvas.addEventListener('keydown', evt => this._onKeyDown(evt));
    this._resize();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this._resize()).observe(this.element!);
    }
    this.on('change:isRecognizing', () => this._updateStatus());
    this._updateButtons();
    this._updateStatus();
  }

  public focus(): void {
    (this._canvas || this.element)?.focus();
  }

  /** Replaces the strokes (e.g. when reopening) and redraws. */
  public setStrokes(strokes: Stroke[]): void {
    this.strokes = strokes.map(stroke => stroke.map(p => ({ ...p })));
    this._redo = [];
    this._changed(0);
  }

  public clear(): void {
    if (!this.strokes.length) return;
    this._redo.push(this.strokes);
    this.strokes = [];
    this._changed(0);
  }

  public undo(): void {
    if (!this.strokes.length) return;
    this._redo.push(this.strokes);
    this.strokes = this.strokes.slice(0, -1);
    this._changed(0);
  }

  public redo(): void {
    const next = this._redo.pop();
    if (!next) return;
    this.strokes = next;
    this._changed(0);
  }

  /** Picks one of the offered alternative readings. */
  public chooseAlternative(latex: string): void {
    if (!latex) return;
    const previous = this.latex;
    const others = [previous, ...this.alternatives.filter(alt => alt !== latex)].filter(Boolean);
    const result: RecognitionResult = { ...(this._lastResult || { symbols: [] }), latex, confidence: 1, alternatives: others };
    this._lastResult = result;
    this.latex = latex;
    this.confidence = 1;
    this.alternatives = others;
    this._renderSuggestions();
    this._updateStatus();
    this.fire('recognized', result);
  }

  /** Runs recognition now (returns the result and updates `latex`). */
  public async recognize(): Promise<RecognitionResult> {
    const id = ++this._recognitionId;
    this.isRecognizing = true;
    try {
      const result = await this._options.recognizer.recognize(this.strokes);
      if (id === this._recognitionId) {
        this._lastResult = result;
        this._symbols = result.symbols || [];
        this.latex = result.latex;
        this.confidence = result.confidence;
        this.alternatives = (result.alternatives || []).slice(0, 4);
        this._renderSuggestions();
        this._draw();
        this.fire('recognized', result);
      }
      return result;
    } catch (err) {
      this.fire('error', err);
      return { latex: this.latex, confidence: 0, symbols: [] };
    } finally {
      if (id === this._recognitionId) {
        this.isRecognizing = false;
        this._updateStatus();
      }
    }
  }

  /* --------------------------------------------------------------------------------------- */

  private _createButton(label: string, icon: string, action: () => void, withText = false): ButtonView {
    const button = new ButtonView(this.locale);
    button.set({ label, icon, tooltip: true, withText });
    button.extendTemplate({ attributes: { class: ['ck-math-handwriting__button'] } });
    button.on('execute', () => {
      action();
      this.focus();
    });
    return button;
  }

  private _changed(delay: number): void {
    // Labels belong to the previous recognition; they return once it runs again.
    this._symbols = [];
    this._updateButtons();
    this._draw();
    this._scheduleRecognition(delay);
  }

  private _updateButtons(): void {
    const editable = !this._options.readOnly;
    this.undoButtonView.isEnabled = editable && this.strokes.length > 0;
    this.clearButtonView.isEnabled = editable && this.strokes.length > 0;
    this.redoButtonView.isEnabled = editable && this._redo.length > 0;
  }

  private _updateStatus(): void {
    if (!this._status) return;
    const t = this.locale ? this.locale.t : (s: string) => s;
    let text = '';
    let state = 'idle';
    if (this.isRecognizing || this._timer) {
      text = t('Recognising…');
      state = 'busy';
    } else if (!this.strokes.length) {
      text = '';
    } else if (!this.latex) {
      text = t('Nothing recognised yet');
      state = 'warning';
    } else if (this.confidence < UNCERTAIN && this.alternatives.length) {
      text = t('Not sure: check the suggestions');
      state = 'warning';
    } else {
      text = t('Recognised');
      state = 'ok';
    }
    this._status.textContent = text;
    this._status.dataset.state = state;
  }

  private _renderSuggestions(): void {
    const container = this._suggestions;
    if (!container) return;
    const t = this.locale ? this.locale.t : (s: string) => s;
    container.textContent = '';
    const options = this.strokes.length ? this.alternatives : [];
    container.hidden = !options.length;
    if (!options.length) return;
    const doc = container.ownerDocument;
    const label = doc.createElement('span');
    label.className = 'ck-math-handwriting__suggestions-label';
    label.textContent = t('Did you mean');
    container.appendChild(label);
    for (const latex of options) {
      const chip = doc.createElement('button');
      chip.type = 'button';
      chip.className = 'ck ck-math-handwriting__suggestion';
      chip.textContent = latex;
      chip.title = t('Use this reading');
      chip.addEventListener('click', () => this.chooseAlternative(latex));
      container.appendChild(chip);
    }
  }

  private _resize(): void {
    if (!this._canvas || !this.element) return;
    const width = Math.max(200, this.element.clientWidth);
    const height = this._options.height;
    const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this._canvas.width = Math.round(width * ratio);
    this._canvas.height = Math.round(height * ratio);
    this._canvas.style.width = '100%';
    this._canvas.style.height = `${height}px`;
    this._draw();
  }

  private _point(evt: PointerEvent): Point & { p?: number } {
    const rect = this._canvas!.getBoundingClientRect();
    // Pens report real pressure; mice and most touch screens report a constant 0.5 (or 0).
    const pressure = evt.pointerType === 'pen' && evt.pressure > 0 ? evt.pressure : undefined;
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top, t: evt.timeStamp, p: pressure };
  }

  private _onPointerDown(evt: PointerEvent): void {
    if (this._options.readOnly || evt.button > 0) return;
    if (evt.pointerType === 'pen') this._penSeen = true;
    // Palm rejection: once a pen is in use, touches are ignored; a second finger never starts a stroke.
    if ((evt.pointerType === 'touch' && this._penSeen) || this._current) return;
    evt.preventDefault();
    this._canvas!.focus({ preventScroll: true });
    try {
      this._canvas!.setPointerCapture(evt.pointerId);
    } catch {
      // The pointer is already gone (or synthetic); the stroke still works without capture.
    }
    this._pointerId = evt.pointerId;
    this._current = [this._point(evt)];
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._symbols = [];
    this._updateStatus();
  }

  private _onPointerMove(evt: PointerEvent): void {
    if (!this._current || evt.pointerId !== this._pointerId) return;
    evt.preventDefault();
    // Coalesced events carry the samples the browser merged between frames: smoother, more faithful ink.
    const events = typeof evt.getCoalescedEvents === 'function' ? evt.getCoalescedEvents() : [];
    for (const e of events.length ? events : [evt]) this._current.push(this._point(e));
    this._draw();
  }

  private _onPointerUp(evt: PointerEvent): void {
    if (!this._current || evt.pointerId !== this._pointerId) return;
    evt.preventDefault();
    const stroke = this._current;
    this._current = null;
    this._pointerId = null;
    if (this._options.deletionGesture && isScribble(stroke) && this.strokes.length) {
      const box = boundingBox(stroke);
      const remaining = this.strokes.filter(s => !boxesIntersect(boundingBox(s), box));
      if (remaining.length !== this.strokes.length) {
        this._redo.push(this.strokes);
        this.strokes = remaining;
        this._changed(0);
        return;
      }
    }
    if (stroke.length === 1) stroke.push({ ...stroke[0], x: stroke[0].x + 1 });
    this._redo = [];
    this.strokes = [...this.strokes, stroke];
    this._changed(this._options.recognitionDelay);
  }

  private _onKeyDown(evt: KeyboardEvent): void {
    const mod = evt.ctrlKey || evt.metaKey;
    const key = evt.key.toLowerCase();
    let handled = true;
    if (mod && key === 'z' && !evt.shiftKey) this.undo();
    else if (mod && (key === 'y' || (key === 'z' && evt.shiftKey))) this.redo();
    else if (!mod && (evt.key === 'Backspace' || evt.key === 'Delete')) this.undo();
    else handled = false;
    if (handled) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  }

  private _scheduleRecognition(delay: number): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      void this.recognize();
    }, delay);
    this._updateStatus();
  }

  private _draw(): void {
    const canvas = this._canvas;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const height = canvas.height / ratio;
    const width = canvas.width / ratio;
    context.clearRect(0, 0, width, height);
    const style = typeof getComputedStyle !== 'undefined' ? getComputedStyle(canvas) : null;
    const ink = this._options.strokeColor || (style && style.color) || 'black';
    const accent = (style && style.getPropertyValue('--ck-math-handwriting-accent').trim()) || 'hsl(218, 81.8%, 56.9%)';
    const warning = (style && style.getPropertyValue('--ck-math-handwriting-warning').trim()) || 'hsl(32, 95%, 44%)';

    // Writing guide.
    context.save();
    context.globalAlpha = 0.18;
    context.strokeStyle = ink;
    context.lineWidth = 1;
    context.setLineDash([4, 6]);
    context.beginPath();
    context.moveTo(16, Math.round(height * 0.66) + 0.5);
    context.lineTo(width - 16, Math.round(height * 0.66) + 0.5);
    context.stroke();
    context.restore();

    if (!this.strokes.length && !this._current) {
      const t = this.locale ? this.locale.t : (s: string) => s;
      context.save();
      context.globalAlpha = 0.4;
      context.fillStyle = ink;
      context.font = `15px ${(style && style.fontFamily) || 'sans-serif'}`;
      context.textAlign = 'center';
      context.fillText(this._options.readOnly ? '' : t('Write a formula here'), width / 2, height * 0.66 - 14);
      context.restore();
    }

    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const stroke of this.strokes) this._drawStroke(context, stroke, ink);
    if (this._current) this._drawStroke(context, this._current, accent);

    if (this._options.showSymbolLabels && !this._current) this._drawLabels(context, ink, accent, warning, style);
  }

  /** Draws a stroke through the midpoints of its samples (smooth curve), thicker under pen pressure. */
  private _drawStroke(context: CanvasRenderingContext2D, stroke: Array<Point & { p?: number }>, color: string): void {
    const base = this._options.strokeWidth;
    context.strokeStyle = color;
    context.fillStyle = color;
    if (stroke.length < 3) {
      context.beginPath();
      context.arc(stroke[0].x, stroke[0].y, base / 2, 0, Math.PI * 2);
      context.fill();
      if (stroke.length === 2) {
        context.lineWidth = base;
        context.beginPath();
        context.moveTo(stroke[0].x, stroke[0].y);
        context.lineTo(stroke[1].x, stroke[1].y);
        context.stroke();
      }
      return;
    }
    const pressured = stroke.some(p => p.p !== undefined);
    if (!pressured) {
      context.lineWidth = base;
      context.beginPath();
      context.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length - 1; i++) {
        const mx = (stroke[i].x + stroke[i + 1].x) / 2;
        const my = (stroke[i].y + stroke[i + 1].y) / 2;
        context.quadraticCurveTo(stroke[i].x, stroke[i].y, mx, my);
      }
      context.lineTo(stroke[stroke.length - 1].x, stroke[stroke.length - 1].y);
      context.stroke();
      return;
    }
    // Pressure varies along the stroke, so each segment gets its own width.
    for (let i = 1; i < stroke.length; i++) {
      const a = stroke[i - 1];
      const b = stroke[i];
      context.lineWidth = base * (0.6 + (b.p ?? 0.5) * 0.9);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }
  }

  /** Shows what each symbol was read as, flagging uncertain ones. */
  private _drawLabels(context: CanvasRenderingContext2D, ink: string, accent: string, warning: string, style: CSSStyleDeclaration | null): void {
    if (!this._symbols.length) return;
    context.save();
    context.font = `600 12px ${(style && style.fontFamily) || 'sans-serif'}`;
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    for (const symbol of this._symbols) {
      const uncertain = symbol.score < UNCERTAIN;
      const color = uncertain ? warning : accent;
      const box = symbol.box;
      const label = symbol.name;
      const textWidth = context.measureText(label).width;
      const x = box.cx;
      const y = Math.max(16, box.top - 6);
      context.globalAlpha = 0.14;
      context.fillStyle = color;
      context.beginPath();
      this._roundRect(context, x - textWidth / 2 - 5, y - 15, textWidth + 10, 16, 8);
      context.fill();
      context.globalAlpha = 0.95;
      context.fillStyle = uncertain ? warning : ink;
      context.fillText(label, x, y);
      if (uncertain) {
        context.globalAlpha = 0.5;
        context.strokeStyle = warning;
        context.lineWidth = 1;
        context.setLineDash([3, 3]);
        context.strokeRect(box.left - 4, box.top - 4, box.width + 8, box.height + 8);
        context.setLineDash([]);
      }
    }
    context.restore();
  }

  private _roundRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  }
}
