/**
 * Drag a corner handle of a selected block widget (image, sketch, diagram) to resize it. The width is
 * kept as a percentage of the editing area and committed through the `resizeFigure` command, so it
 * is undoable and lands in the HTML as `style="width:…%"`.
 */

import { Plugin } from '../../core/plugin';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Element as ViewElement } from '../../engine/view/element';

const SNAP_POINTS = [25, 33.33, 50, 66.67, 75, 100];
const SNAP_DISTANCE = 2;
const MIN_PERCENT = 10;
const RESIZING_CLASS = 'ck-widget_resizing';

interface ResizeState {
  pointerId: number;
  handle: HTMLElement;
  widget: HTMLElement;
  label: HTMLElement | null;
  fromRight: boolean;
  startX: number;
  startWidth: number;
  containerWidth: number;
  originalWidth: string;
  percent: number;
}

export class WidgetResize extends Plugin {
  private _state: ResizeState | null = null;
  private _detach = () => {};

  public static override get pluginName(): string {
    return 'WidgetResize';
  }

  public override init(): void {
    const attach = () => {
      const editable = this.editor.ui.getEditableElement();
      if (!editable) return;
      const onDown = (event: PointerEvent) => this._onPointerDown(event);
      editable.addEventListener('pointerdown', onDown);
      this._detach = () => editable.removeEventListener('pointerdown', onDown);
    };
    if ((this.editor.ui as any).isReady) attach();
    else this.editor.ui.once('ready', attach);
  }

  public override destroy(): void {
    this._detach();
    super.destroy();
  }

  private _onPointerDown(event: PointerEvent): void {
    const editor = this.editor;
    if (editor.isReadOnly || event.button > 0) return;
    const target = event.target as HTMLElement | null;
    const handle = target && typeof target.closest === 'function' ? (target.closest('[data-resize-handle]') as HTMLElement | null) : null;
    if (!handle) return;
    const widget = handle.closest('.ck-widget') as HTMLElement | null;
    if (!widget) return;
    event.preventDefault();

    // Select the widget the handle belongs to (the pointer is on a UI element, not on the widget).
    const viewElement = editor.editing.view.domConverter.mapDomToView(widget) as ViewElement | undefined;
    const modelElement = viewElement ? (editor.editing.mapper.toModelElement(viewElement) as ModelElement | undefined) : undefined;
    if (modelElement) {
      editor.model.change(writer => writer.setSelection(modelElement, 'on'));
    }

    const container = widget.parentElement || widget;
    const containerStyle = getComputedStyle(container);
    const containerWidth = Math.max(1, container.clientWidth - parseFloat(containerStyle.paddingLeft || '0') - parseFloat(containerStyle.paddingRight || '0'));
    const startWidth = widget.getBoundingClientRect().width;
    this._state = {
      pointerId: event.pointerId,
      handle,
      widget,
      label: widget.querySelector('.ck-widget__resizer__size-label'),
      fromRight: /right$/.test(handle.getAttribute('data-resize-handle') || ''),
      startX: event.clientX,
      startWidth,
      containerWidth,
      originalWidth: widget.style.width,
      percent: Math.round((startWidth / containerWidth) * 1000) / 10
    };
    widget.classList.add(RESIZING_CLASS);
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers cannot be captured.
    }
    const onMove = (e: PointerEvent) => this._onPointerMove(e);
    const onUp = () => this._finish(true, cleanUp);
    const onCancel = () => this._finish(false, cleanUp);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this._finish(false, cleanUp);
    };
    const doc = widget.ownerDocument;
    const cleanUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      doc.removeEventListener('keydown', onKey, true);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
    doc.addEventListener('keydown', onKey, true);
    this._updateLabel();
  }

  private _onPointerMove(event: PointerEvent): void {
    const state = this._state;
    if (!state) return;
    const dx = event.clientX - state.startX;
    const widthPx = state.startWidth + (state.fromRight ? dx : -dx);
    let percent = (widthPx / state.containerWidth) * 100;
    percent = Math.min(100, Math.max(MIN_PERCENT, percent));
    const snap = SNAP_POINTS.find(point => Math.abs(point - percent) <= SNAP_DISTANCE);
    if (snap !== undefined) percent = snap;
    state.percent = Math.round(percent * 10) / 10;
    state.widget.style.width = `${state.percent}%`;
    this._updateLabel();
  }

  private _updateLabel(): void {
    const state = this._state;
    if (!state || !state.label) return;
    const box = state.widget.getBoundingClientRect();
    state.label.textContent = `${Math.round(box.width)} × ${Math.round(box.height)} · ${state.percent}%`;
  }

  private _finish(commit: boolean, cleanUp: () => void): void {
    const state = this._state;
    if (!state) return;
    this._state = null;
    cleanUp();
    try {
      state.handle.releasePointerCapture(state.pointerId);
    } catch {
      // Already released.
    }
    state.widget.classList.remove(RESIZING_CLASS);
    if (!commit) {
      state.widget.style.width = state.originalWidth;
      return;
    }
    const width = state.percent >= 100 ? null : `${state.percent}%`;
    const command = this.editor.commands.get('resizeFigure');
    if (command && command.isEnabled) {
      this.editor.execute('resizeFigure', { width });
    } else {
      state.widget.style.width = state.originalWidth;
    }
    // The model is the source of truth for the final width; the view rewrites the DOM style.
    if (width === null) state.widget.style.width = '';
    this.editor.editing.view.focus();
  }
}
