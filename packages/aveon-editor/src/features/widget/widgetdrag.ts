/**
 * Move a block widget by dragging its grip: a native drag starts from the `.ck-widget__selection-handle`,
 * a line shows where the widget will land (before or after the block under the pointer), and the
 * clipboard's `DragDrop` plugin performs the move on drop. `Alt+Shift+↑/↓` moves the selected
 * widget without a mouse (the `moveFigure` command).
 */

import { Plugin } from '../../core/plugin';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Element as ViewElement } from '../../engine/view/element';

const LINE_CLASS = 'ck-widget-drop-line';

export class WidgetDrag extends Plugin {
  private _dragged: ModelElement | null = null;
  private _target: { block: ViewElement; before: boolean } | null = null;
  private _line: HTMLElement | null = null;
  private _detach = () => {};

  public static override get pluginName(): string {
    return 'WidgetDrag';
  }

  public override init(): void {
    const editor = this.editor;
    const view = editor.editing.view;
    const viewDocument = view.document;

    const attach = () => {
      const editable = editor.ui.getEditableElement();
      if (!editable) return;
      const onDragStart = (event: DragEvent) => this._onDragStart(event);
      const onDragLeave = (event: DragEvent) => {
        if (!editable.contains(event.relatedTarget as Node | null)) this._hideLine();
      };
      editable.addEventListener('dragstart', onDragStart, true);
      editable.addEventListener('dragleave', onDragLeave);
      this._detach = () => {
        editable.removeEventListener('dragstart', onDragStart, true);
        editable.removeEventListener('dragleave', onDragLeave);
      };
    };
    if ((editor.ui as any).isReady) attach();
    else editor.ui.once('ready', attach);

    // While a widget is dragged over the text, the drop lands between blocks, never inside one.
    this.listenTo(viewDocument, 'dragging', (evt, data: any) => {
      if (!this._dragged) return;
      this._target = this._blockTarget(data);
      this._showLine();
    }, { priority: 'high' });

    this.listenTo(viewDocument, 'clipboardInput', (evt, data: any) => {
      if (data.method !== 'drop' || !this._dragged) return;
      const target = this._target || this._blockTarget(data);
      if (target) {
        const position = target.before ? view.createPositionBefore(target.block) : view.createPositionAfter(target.block);
        data.targetRanges = [view.createRange(position)];
      }
      this._hideLine();
    }, { priority: 'highest' });

    this.listenTo(viewDocument, 'dragend', () => this._reset(), { priority: 'lowest' });
    this.listenTo(viewDocument, 'drop', () => this._reset(), { priority: 'lowest' });
  }

  public override destroy(): void {
    this._detach();
    this._hideLine();
    super.destroy();
  }

  private _onDragStart(event: DragEvent): void {
    const editor = this.editor;
    const target = event.target as HTMLElement | null;
    const grip = target && typeof target.closest === 'function' ? target.closest('.ck-widget__selection-handle') : null;
    if (!grip || editor.isReadOnly) return;
    const widgetDom = grip.closest('.ck-widget') as HTMLElement | null;
    if (!widgetDom) return;
    const viewElement = editor.editing.view.domConverter.mapDomToView(widgetDom) as ViewElement | undefined;
    const modelElement = viewElement ? (editor.editing.mapper.toModelElement(viewElement) as ModelElement | undefined) : undefined;
    if (!modelElement) return;
    // The DragDrop plugin takes the dragged content from the selection: put it on the widget first.
    editor.model.change(writer => writer.setSelection(modelElement, 'on'));
    this._dragged = modelElement;
    if (event.dataTransfer) {
      try {
        event.dataTransfer.setDragImage(widgetDom, 16, 16);
      } catch {
        // Not every environment allows a custom drag image.
      }
    }
  }

  /** The block under the pointer and whether the widget goes before it (upper half) or after. */
  private _blockTarget(data: any): { block: ViewElement; before: boolean } | null {
    const view = this.editor.editing.view;
    const range = data.targetRanges && data.targetRanges[0];
    if (!range) return null;
    let node: any = range.start.parent;
    while (node && node.parent && !node.parent.is('rootElement') && !node.parent.is('editableElement')) node = node.parent;
    if (!node || !node.is('element')) return null;
    const dom = view.domConverter.mapViewToDom(node) as HTMLElement | undefined;
    const clientY = data.domEvent && typeof data.domEvent.clientY === 'number' ? data.domEvent.clientY : null;
    if (!dom || clientY === null) return { block: node, before: true };
    const box = dom.getBoundingClientRect();
    return { block: node, before: clientY < box.top + box.height / 2 };
  }

  private _showLine(): void {
    const target = this._target;
    if (!target) {
      this._hideLine();
      return;
    }
    const view = this.editor.editing.view;
    const dom = view.domConverter.mapViewToDom(target.block) as HTMLElement | undefined;
    if (!dom) return;
    const doc = dom.ownerDocument;
    if (!this._line) {
      this._line = doc.createElement('div');
      this._line.className = `ck ${LINE_CLASS}`;
      this._line.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(this._line);
    }
    const box = dom.getBoundingClientRect();
    const line = this._line;
    line.style.left = `${box.left}px`;
    line.style.width = `${box.width}px`;
    line.style.top = `${(target.before ? box.top : box.bottom) - 1}px`;
  }

  private _hideLine(): void {
    if (this._line) this._line.remove();
    this._line = null;
    this._target = null;
  }

  private _reset(): void {
    this._hideLine();
    this._dragged = null;
  }
}
