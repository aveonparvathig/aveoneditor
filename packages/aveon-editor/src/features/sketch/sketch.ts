/**
 * Sketch: a drawing block (diagrams, signatures, annotations) made with a pen, saved as SVG:
 * `<figure class="sketch"><svg …><path …/></svg></figure>`. Double-click a sketch to edit it.
 *
 * Only `<svg>` with stroked `<path>` elements is accepted; anything else (scripts, links, styles,
 * event attributes) is dropped when sketches are loaded, so stored HTML cannot carry active content.
 */

import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { applyTheme } from '../../ui/theme';
import { Widget } from '../widget/widget';
import { toWidget } from '../widget/utils';
import { upcastAtomic } from '../shared/upcast';
import { editOnDoubleClick } from '../references/references';
import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Element as ViewElement } from '../../engine/view/element';

const MODEL = 'sketch';

export interface SketchStroke {
  color: string;
  width: number;
  points: Array<[number, number]>;
}

export interface SketchData {
  width: number;
  height: number;
  strokes: SketchStroke[];
}

const COLOR = /^#[0-9a-f]{3,8}$/i;

const num = (value: unknown, fallback: number) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/** SVG markup for a sketch (polyline paths with round joins). Every value is validated. */
export function sketchToSvg(data: SketchData): string {
  const width = num(data.width, 600);
  const height = num(data.height, 300);
  const paths = (data.strokes || [])
    .filter(stroke => Array.isArray(stroke.points) && stroke.points.length)
    .map(stroke => {
      const [first, ...rest] = stroke.points.map(([x, y]) => [num(x, 0), num(y, 0)] as [number, number]);
      const color = COLOR.test(String(stroke.color)) ? stroke.color : '#000000';
      const strokeWidth = Math.min(40, Math.max(0.5, num(stroke.width, 3)));
      const d = `M${first[0]} ${first[1]}` + (rest.length ? rest.map(([x, y]) => `L${x} ${y}`).join('') : `L${first[0] + 0.1} ${first[1]}`);
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${paths}</svg>`;
}

/** Reads strokes back from path data written by `sketchToSvg()` (M/L commands). */
function parsePath(d: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const pattern = /[ML]\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(d))) points.push([Number(match[1]), Number(match[2])]);
  return points;
}

/** Strict reading of a sketch's `<svg>` view element. */
function viewToSketch(figure: ViewElement): SketchData | null {
  const svg = [...figure.getChildren()].find((child: any) => child.is('element', 'svg')) as ViewElement | undefined;
  if (!svg) return null;
  const viewBox = String(svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const width = Math.min(4000, Math.max(1, Number(svg.getAttribute('width')) || viewBox[2] || 600));
  const height = Math.min(4000, Math.max(1, Number(svg.getAttribute('height')) || viewBox[3] || 300));
  const strokes: SketchStroke[] = [];
  const visit = (element: ViewElement) => {
    for (const child of element.getChildren()) {
      const node = child as any;
      if (!node.is('element')) continue;
      if (node.name === 'path') {
        const points = parsePath(String(node.getAttribute('d') || ''));
        const color = String(node.getAttribute('stroke') || '#000000');
        if (points.length) strokes.push({ points, color: COLOR.test(color) ? color : '#000000', width: Math.min(40, Math.max(0.5, Number(node.getAttribute('stroke-width')) || 3)) });
      } else if (node.name === 'g') {
        visit(node);
      }
    }
  };
  visit(svg);
  return { width, height, strokes };
}

function readData(element: ModelElement): SketchData {
  try {
    const data = JSON.parse(String(element.getAttribute('sketchData') || '{}'));
    return { width: data.width || 600, height: data.height || 300, strokes: Array.isArray(data.strokes) ? data.strokes : [] };
  } catch {
    return { width: 600, height: 300, strokes: [] };
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Drawing dialog                                                                              */
/* ------------------------------------------------------------------------------------------ */

const PALETTE = ['#1f2328', '#cf222e', '#1a7f37', '#0969da', '#bf8700', '#8250df'];
const WIDTHS = [2, 4, 8];

/** Opens the drawing pad; resolves with the drawing, or `null` when cancelled. */
export function openSketchDialog(editor: Editor, initial?: SketchData): Promise<SketchData | null> {
  const t = editor.t;
  const doc = editor.ui.element?.ownerDocument || document;
  return new Promise(resolve => {
    const data: SketchData = initial ? { width: initial.width, height: initial.height, strokes: initial.strokes.map(s => ({ ...s, points: s.points.slice() })) } : { width: 720, height: 360, strokes: [] };
    const undone: SketchStroke[] = [];
    let color = PALETTE[0];
    let width = WIDTHS[1];

    const overlay = doc.createElement('div');
    overlay.className = 'ck ck-dialog-overlay ck-reset_all-excluded';
    applyTheme(editor, overlay);
    const dialog = doc.createElement('div');
    dialog.className = 'ck-dialog ck-dialog_sketch';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', t('Sketch'));

    const title = doc.createElement('h2');
    title.className = 'ck-dialog__title';
    title.textContent = t('Sketch');

    const tools = doc.createElement('div');
    tools.className = 'ck-sketch__tools';
    const swatches = PALETTE.map(value => {
      const swatch = doc.createElement('button');
      swatch.type = 'button';
      swatch.className = 'ck-sketch__swatch';
      swatch.style.background = value;
      swatch.setAttribute('aria-label', `${t('Colour')} ${value}`);
      swatch.addEventListener('click', () => {
        color = value;
        sync();
      });
      return swatch;
    });
    const sizes = WIDTHS.map(value => {
      const size = doc.createElement('button');
      size.type = 'button';
      size.className = 'ck-sketch__size';
      size.innerHTML = `<span style="width:${value + 4}px;height:${value + 4}px"></span>`;
      size.setAttribute('aria-label', `${t('Pen width')} ${value}`);
      size.addEventListener('click', () => {
        width = value;
        sync();
      });
      return size;
    });
    const action = (label: string, onClick: () => void) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'ck-dialog__button ck-sketch__action';
      button.textContent = label;
      button.addEventListener('click', onClick);
      return button;
    };
    const undo = action(t('Undo'), () => {
      const stroke = data.strokes.pop();
      if (stroke) undone.push(stroke);
      draw();
    });
    const redo = action(t('Redo'), () => {
      const stroke = undone.pop();
      if (stroke) data.strokes.push(stroke);
      draw();
    });
    const clear = action(t('Clear'), () => {
      undone.push(...data.strokes.reverse());
      data.strokes = [];
      draw();
    });
    const spacer = doc.createElement('span');
    spacer.className = 'ck-sketch__spacer';
    tools.append(...swatches, spacer, ...sizes, undo, redo, clear);

    const canvas = doc.createElement('canvas');
    canvas.className = 'ck-sketch__canvas';
    canvas.width = data.width;
    canvas.height = data.height;
    canvas.style.touchAction = 'none';

    const actions = doc.createElement('div');
    actions.className = 'ck-dialog__actions';
    const close = (result: SketchData | null) => {
      overlay.remove();
      editor.editing.view.focus();
      resolve(result);
    };
    const cancel = action(t('Cancel'), () => close(null));
    const save = action(t('Insert'), () => close(data.strokes.length ? data : null));
    save.classList.add('ck-dialog__button_primary');
    if (initial) save.textContent = t('Save');
    actions.append(cancel, save);

    dialog.append(title, tools, canvas, actions);
    overlay.append(dialog);
    doc.body.appendChild(overlay);

    const context = canvas.getContext('2d');
    function draw(): void {
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      for (const stroke of data.strokes) {
        context.strokeStyle = stroke.color;
        context.lineWidth = stroke.width;
        context.beginPath();
        stroke.points.forEach(([x, y], i) => (i ? context.lineTo(x, y) : context.moveTo(x, y)));
        if (stroke.points.length === 1) context.lineTo(stroke.points[0][0] + 0.1, stroke.points[0][1]);
        context.stroke();
      }
      undo.disabled = !data.strokes.length;
      redo.disabled = !undone.length;
      clear.disabled = !data.strokes.length;
    }
    function sync(): void {
      swatches.forEach((swatch, i) => swatch.classList.toggle('ck-on', PALETTE[i] === color));
      sizes.forEach((size, i) => size.classList.toggle('ck-on', WIDTHS[i] === width));
    }

    let current: SketchStroke | null = null;
    const point = (event: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / (rect.width || canvas.width);
      const scaleY = canvas.height / (rect.height || canvas.height);
      return [Math.round((event.clientX - rect.left) * scaleX * 10) / 10, Math.round((event.clientY - rect.top) * scaleY * 10) / 10];
    };
    canvas.addEventListener('pointerdown', event => {
      if (event.button > 0) return;
      event.preventDefault();
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic or already-released pointers cannot be captured.
      }
      current = { color, width, points: [point(event)] };
      data.strokes.push(current);
      undone.length = 0;
      draw();
    });
    canvas.addEventListener('pointermove', event => {
      if (!current) return;
      const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
      for (const e of events.length ? events : [event]) current.points.push(point(e));
      draw();
    });
    const end = () => {
      current = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') close(null);
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo.click();
      }
    });
    sync();
    draw();
    save.focus();
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Commands and plugin                                                                         */
/* ------------------------------------------------------------------------------------------ */

export class InsertSketchCommand extends Command {
  public override refresh(): void {
    const model = this.editor.model;
    this.isEnabled = model.schema.findAllowedParent(model.document.selection.getFirstPosition()!, MODEL) !== null;
  }

  /** Inserts `data`, or opens the drawing pad (editing the selected sketch if there is one). */
  public override async execute(options: { data?: SketchData } = {}): Promise<void> {
    const editor = this.editor;
    const selected = editor.model.document.selection.getSelectedElement();
    const existing = selected && selected.name === MODEL ? selected : null;
    const data = options.data ?? (await openSketchDialog(editor, existing ? readData(existing) : undefined));
    if (!data) return;
    const json = JSON.stringify(data);
    editor.model.change(writer => {
      if (existing) {
        writer.setAttribute('sketchData', json, existing);
        return;
      }
      const element = writer.createElement(MODEL, { sketchData: json });
      editor.model.insertContent(element);
      writer.setSelection(element, 'on');
    });
  }
}

export class Sketch extends Plugin {
  public static override get pluginName(): string {
    return 'Sketch';
  }

  public static override get requires() {
    return [Widget];
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    editor.model.schema.register(MODEL, { inheritAllFrom: '$blockObject', allowAttributes: ['sketchData'] });

    editor.conversion.for('upcast').add(dispatcher => {
      dispatcher.on(
        'element:figure',
        upcastAtomic(
          view => view.hasClass('sketch'),
          (view, writer) => {
            const data = viewToSketch(view);
            return data ? writer.createElement(MODEL, { sketchData: JSON.stringify(data) }) : null;
          }
        ),
        { priority: 'high' }
      );
    });
    const render = (element: ModelElement) => (dom: HTMLElement) => {
      dom.innerHTML = sketchToSvg(readData(element));
    };
    editor.conversion.for('dataDowncast').elementToElement({
      model: MODEL,
      view: (element: ModelElement, { writer }: any) => writer.createRawElement('figure', { class: 'sketch' }, render(element))
    });
    editor.conversion.for('editingDowncast').elementToElement({
      model: MODEL,
      view: (element: ModelElement, { writer }: any) => {
        const figure = writer.createContainerElement('figure', { class: 'ck-sketch', title: t('Double-click to edit') });
        writer.insert(writer.createPositionAt(figure, 0), writer.createRawElement('div', { class: 'ck-sketch__image' }, render(element)));
        return toWidget(figure, writer, { label: t('Sketch') });
      }
    });
    // A changed drawing redraws its widget.
    editor.model.document.on('change:data', () => {
      for (const change of editor.model.document.differ.getChanges()) {
        if (change.type === 'attribute' && change.attributeKey === 'sketchData') {
          const element = change.range.start.nodeAfter;
          if (element) editor.editing.reconvertItem(element as ModelElement);
        }
      }
    });

    editor.commands.add('insertSketch', new InsertSketchCommand(editor));
    editor.ui.componentFactory.add('insertSketch', locale => {
      const command = editor.commands.get('insertSketch')!;
      const button = new ButtonView(locale);
      button.set({ label: t('Sketch'), icon: icons.sketch, tooltip: true });
      button.bind('isEnabled').to(command, 'isEnabled');
      this.listenTo(button, 'execute', () => editor.execute('insertSketch'));
      return button;
    });
    editOnDoubleClick(editor, [MODEL], 'insertSketch');
  }
}

