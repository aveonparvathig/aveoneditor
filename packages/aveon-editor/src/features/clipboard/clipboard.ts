import { Plugin } from '../../core/plugin';
import { ClipboardObserver } from '../../engine/view/observer/clipboardobserver';
import { EventInfo } from '../../utils/eventinfo';
import { DataTransfer } from '../../engine/view/observer/datatransfer';
import type { DocumentFragment as ViewDocumentFragment } from '../../engine/view/documentfragment';
import type { DocumentFragment as ModelDocumentFragment } from '../../engine/model/documentfragment';
import type { Element as ViewElement } from '../../engine/view/element';
import type { Range as ModelRange } from '../../engine/model/range';
import type { Range as ViewRange } from '../../engine/view/range';
import type { Item as ViewItem } from '../../engine/view/item';
import { keyCodes, parseKeystroke } from '../../utils/keyboard';
import { env } from '../../utils/env';
import { LiveRange } from '../../engine/model/liverange';

export interface ClipboardInputEventData {
  dataTransfer: DataTransfer;
  method: 'paste' | 'drop';
  targetRanges: ViewRange[] | null;
  content?: ViewDocumentFragment;
}

/**
 * Clipboard pipeline: `clipboardInput` → `inputTransformation` → `contentInsertion`
 * for paste/drop, and `clipboardOutput` for copy/cut.
 */
export class ClipboardPipeline extends Plugin {
  public static override get pluginName(): string {
    return 'ClipboardPipeline';
  }

  public override init(): void {
    const editor = this.editor;
    const view = editor.editing.view;
    view.addObserver(ClipboardObserver);
    this._setupPasteDrop();
    this._setupCopyCut();
  }

  private _setupPasteDrop(): void {
    const editor = this.editor;
    const model = editor.model;
    const view = editor.editing.view;
    const viewDocument = view.document;

    this.listenTo(viewDocument, 'clipboardInput', (evt, data: ClipboardInputEventData) => {
      if (editor.isReadOnly) {
        evt.stop();
      }
    }, { priority: 'highest' });

    this.listenTo(viewDocument, 'clipboardInput', (evt, data: ClipboardInputEventData) => {
      const dataTransfer = data.dataTransfer;
      let content: ViewDocumentFragment;
      if (data.content) {
        content = data.content;
      } else {
        let contentData = '';
        if (dataTransfer.getData('text/html')) {
          contentData = normalizeClipboardHtml(dataTransfer.getData('text/html'));
        } else if (dataTransfer.getData('text/plain')) {
          contentData = plainTextToHtml(dataTransfer.getData('text/plain'));
        }
        content = editor.data.htmlProcessor.toView(contentData);
      }
      const eventInfo = new EventInfo(this, 'inputTransformation');
      this.fire(eventInfo, { content, dataTransfer, targetRanges: data.targetRanges, method: data.method });
      if (eventInfo.stopped) evt.stop();
      view.scrollToTheSelection();
    }, { priority: 'low' });

    this.listenTo(this, 'inputTransformation', (evt, data: any) => {
      if (data.content.isEmpty) return;
      const dataController = editor.data;
      const modelFragment = dataController.toModel(data.content, '$clipboardHolder');
      if (modelFragment.childCount === 0) return;
      evt.stop();
      model.change(() => {
        this.fire('contentInsertion', { content: modelFragment, method: data.method, dataTransfer: data.dataTransfer, targetRanges: data.targetRanges });
      });
    }, { priority: 'low' });

    this.listenTo(this, 'contentInsertion', (evt, data: any) => {
      data.resultRange = model.insertContent(data.content);
    }, { priority: 'low' });
  }

  private _setupCopyCut(): void {
    const editor = this.editor;
    const modelDocument = editor.model.document;
    const view = editor.editing.view;
    const viewDocument = view.document;

    const onCopyCut = (evt: EventInfo, data: any) => {
      const dataTransfer = data.dataTransfer;
      data.preventDefault();
      const content = editor.data.toView(editor.model.getSelectedContent(modelDocument.selection));
      viewDocument.fire('clipboardOutput', { dataTransfer, content, method: evt.name });
    };

    this.listenTo(viewDocument, 'copy', onCopyCut, { priority: 'low' });
    this.listenTo(viewDocument, 'cut', (evt, data: any) => {
      if (editor.isReadOnly) {
        data.preventDefault();
      } else {
        onCopyCut(evt, data);
      }
    }, { priority: 'low' });

    this.listenTo(viewDocument, 'clipboardOutput', (evt, data: any) => {
      if (!data.content.isEmpty) {
        data.dataTransfer.setData('text/html', editor.data.htmlProcessor.toData(data.content));
        data.dataTransfer.setData('text/plain', viewToPlainText(data.content));
      }
      if (data.method === 'cut') {
        editor.model.deleteContent(modelDocument.selection);
      }
    }, { priority: 'low' });
  }
}

/** Pastes as plain text on Ctrl+Shift+V, and keeps text-only pastes inheriting the selection formatting. */
export class PastePlainText extends Plugin {
  public static override get pluginName(): string {
    return 'PastePlainText';
  }

  public static override get requires() {
    return [ClipboardPipeline];
  }

  public override init(): void {
    const editor = this.editor;
    const model = editor.model;
    const view = editor.editing.view;
    const viewDocument = view.document;
    const selection = model.document.selection;
    let shiftPressed = false;

    view.addObserver(ClipboardObserver);
    this.listenTo(viewDocument, 'keydown', (evt, data: any) => {
      shiftPressed = data.shiftKey;
    });

    this.listenTo(editor.plugins.get(ClipboardPipeline) as ClipboardPipeline, 'contentInsertion', (evt, data: any) => {
      if (!shiftPressed && !isPlainTextFragment(data.content, model.schema)) return;
      model.change(writer => {
        const textAttributes = Array.from(selection.getAttributes()).filter(([key]) => model.schema.getAttributeProperties(key).isFormatting);
        if (!selection.isCollapsed) {
          model.deleteContent(selection, { doNotAutoparagraph: true });
        }
        textAttributes.push(...(selection.getAttributes() as any));
        const range = writer.createRangeIn(data.content);
        for (const item of range.getItems()) {
          if ((item as any).is('$textProxy')) {
            writer.setAttributes(textAttributes as any, item as any);
          }
        }
      });
    });
  }
}

function isPlainTextFragment(documentFragment: ModelDocumentFragment, schema: any): boolean {
  if (documentFragment.childCount > 1) return false;
  const child = documentFragment.getChild(0);
  if (!child) return false;
  if (schema.isObject(child)) return false;
  return Array.from(child.getAttributeKeys()).length === 0;
}

/** Drag and drop of editor content and external content. */
export class DragDrop extends Plugin {
  public static override get pluginName(): string {
    return 'DragDrop';
  }

  public static override get requires() {
    return [ClipboardPipeline];
  }

  private _draggedRange: LiveRange | null = null;
  private _draggingUid = '';

  public override init(): void {
    const editor = this.editor;
    const view = editor.editing.view;
    const viewDocument = view.document;
    const model = editor.model;

    view.addObserver(ClipboardObserver);

    this.listenTo(viewDocument, 'dragstart', (evt, data: any) => {
      const selection = model.document.selection;
      if (selection.isCollapsed) {
        data.preventDefault();
        return;
      }
      this._draggedRange = LiveRange.fromRange(selection.getFirstRange()!);
      this._draggingUid = Math.random().toString(36).slice(2);
      data.dataTransfer.effectAllowed = editor.isReadOnly ? 'copy' : 'copyMove';
      data.dataTransfer.setData('application/aveon-dragging-uid', this._draggingUid);
      const content = editor.data.toView(model.getSelectedContent(selection));
      viewDocument.fire('clipboardOutput', { dataTransfer: data.dataTransfer, content, method: 'dragstart' });
    }, { priority: 'low' });

    this.listenTo(viewDocument, 'dragend', () => {
      this._finalizeDragging(false);
    }, { priority: 'low' });

    this.listenTo(viewDocument, 'dragging', (evt, data: any) => {
      if (editor.isReadOnly) {
        data.dataTransfer.dropEffect = 'none';
        return;
      }
      data.dataTransfer.dropEffect = this._draggedRange ? 'move' : 'copy';
      evt.stop();
    }, { priority: 'low' });

    this.listenTo(viewDocument, 'clipboardInput', (evt, data: any) => {
      if (data.method !== 'drop') return;
      const targetRange = data.targetRanges && data.targetRanges[0];
      if (!targetRange) {
        this._finalizeDragging(false);
        evt.stop();
        return;
      }
      const modelRange = editor.editing.mapper.toModelRange(targetRange);
      const isMove = this._draggedRange && data.dataTransfer.getData('application/aveon-dragging-uid') === this._draggingUid;
      if (isMove && this._draggedRange!.containsRange(modelRange, true)) {
        this._finalizeDragging(false);
        evt.stop();
        return;
      }
      model.change(writer => {
        writer.setSelection(modelRange);
      });
      if (isMove) {
        data.dataTransfer.dropEffect = 'move';
      }
    }, { priority: 'high' });

    this.listenTo(editor.plugins.get(ClipboardPipeline) as ClipboardPipeline, 'contentInsertion', (evt, data: any) => {
      if (data.method !== 'drop') return;
      const isMove = this._draggedRange && data.dataTransfer.getData('application/aveon-dragging-uid') === this._draggingUid;
      if (isMove && !editor.isReadOnly) {
        model.change(writer => {
          writer.remove(this._draggedRange!);
        });
      }
      this._finalizeDragging(true);
    }, { priority: 'lowest' });
  }

  private _finalizeDragging(_moved: boolean): void {
    if (this._draggedRange) {
      this._draggedRange.detach();
      this._draggedRange = null;
    }
    this._draggingUid = '';
  }
}

/** Clipboard feature (copy, cut, paste, drag and drop). */
export class Clipboard extends Plugin {
  public static override get pluginName(): string {
    return 'Clipboard';
  }

  public static override get requires() {
    return [ClipboardPipeline, DragDrop, PastePlainText];
  }
}

export function normalizeClipboardHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<\?xml[^>]*>/gi, '')
    .replace(/<(\/?)o:p>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
}

export function plainTextToHtml(text: string): string {
  text = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n\r?\n/g, '</p><p>')
    .replace(/\r?\n/g, '<br>')
    .replace(/^\s/, '&nbsp;')
    .replace(/\s$/, '&nbsp;')
    .replace(/\s\s/g, ' &nbsp;');
  if (text.includes('</p><p>') || text.includes('<br>')) {
    text = `<p>${text}</p>`;
  }
  return text;
}

export function viewToPlainText(viewItem: ViewItem | ViewDocumentFragment): string {
  let text = '';
  if ((viewItem as any).is('$text') || (viewItem as any).is('$textProxy')) {
    text = (viewItem as any).data;
  } else if ((viewItem as any).is('element', 'img') && (viewItem as ViewElement).hasAttribute('alt')) {
    text = (viewItem as ViewElement).getAttribute('alt')!;
  } else if ((viewItem as any).is('element', 'br')) {
    text = '\n';
  } else {
    let prev: any = null;
    for (const child of (viewItem as ViewElement).getChildren()) {
      const childText = viewToPlainText(child);
      if (prev && (prev.is('containerElement') || (child as any).is('containerElement'))) {
        if (isBlockLike(prev) || isBlockLike(child as ViewElement)) {
          text += '\n\n';
        } else {
          text += '\n';
        }
      }
      text += childText;
      prev = child;
    }
  }
  return text;
}

function isBlockLike(el: any): boolean {
  return el.is && el.is('element') && !['li', 'td', 'th', 'tr'].includes(el.name);
}

export { keyCodes, parseKeystroke, env };
export type { ModelRange };
