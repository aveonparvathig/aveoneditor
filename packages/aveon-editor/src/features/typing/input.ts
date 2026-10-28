import { Plugin } from '../../core/plugin';
import { InsertTextCommand } from './inserttextcommand';
import { Observer } from '../../engine/view/observer/observer';
import { DomEventData } from '../../engine/view/observer/domeventdata';
import { EventInfo } from '../../utils/eventinfo';
import { env } from '../../utils/env';
import { Text as ViewText } from '../../engine/view/text';
import type { EditingView } from '../../engine/view';
import type { Element as ViewElement } from '../../engine/view/element';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Range as ViewRange } from '../../engine/view/range';
import type { MutationData } from '../../engine/view/observer/mutationobserver';
import { Position as ModelPosition } from '../../engine/model/position';
import { Range as ModelRange } from '../../engine/model/range';

const INLINE_OBJECT_PLACEHOLDER = '￼';

/**
 * Fires `insertText` on the view document for text-inserting `beforeinput` events.
 */
export class InsertTextObserver extends Observer {
  constructor(view: EditingView) {
    super(view);
    const viewDocument = view.document;
    viewDocument.on('beforeinput', (evt, data: any) => {
      if (!this.isEnabled) return;
      const { data: text, targetRanges, inputType, domEvent } = data;
      if (!TYPING_INPUT_TYPES.includes(inputType)) return;
      // During IME composition the DOM is managed by the browser; mutations reconcile the model later.
      if (viewDocument.isComposing && !env.isAndroid) return;
      if (inputType === 'insertCompositionText') return;
      const eventInfo = new EventInfo(viewDocument, 'insertText');
      viewDocument.fire(eventInfo, new DomEventData(view, domEvent, { text, selection: view.createSelection(targetRanges) }));
      if (eventInfo.stopped) evt.stop();
    });
  }

  public observe(): void {
    /* uses the beforeinput event */
  }

  public stopObserving(): void {
    /* nothing */
  }
}

const TYPING_INPUT_TYPES = ['insertText', 'insertReplacementText', 'insertTranspose', 'insertFromDrop', 'insertFromYank', 'insertCompositionText'];

/**
 * Typing: handles `insertText` events and reconciles the model when the DOM changes
 * without going through the model (IME composition, spellcheck, autocorrect).
 */
export class Input extends Plugin {
  private _pendingMutations = new Set<ViewElement>();

  public static override get pluginName(): string {
    return 'Input';
  }

  public override init(): void {
    const editor = this.editor;
    const model = editor.model;
    const view = editor.editing.view;
    const viewDocument = view.document;
    const modelSelection = model.document.selection;

    view.addObserver(InsertTextObserver);

    const insertTextCommand = new InsertTextCommand(editor, editor.config.get('typing.undoStep') || 20);
    editor.commands.add('insertText', insertTextCommand);
    editor.commands.add('input', insertTextCommand);

    this.listenTo(viewDocument, 'insertText', (evt, data: any) => {
      if (!viewDocument.isComposing) {
        data.preventDefault();
      }
      const { text, selection: viewSelection } = data;
      const modelRanges = [];
      for (const viewRange of viewSelection.getRanges()) {
        try {
          modelRanges.push(editor.editing.mapper.toModelRange(viewRange));
        } catch {
          /* skip unmapped */
        }
      }
      const insertTextOptions: any = { text, selection: modelRanges.length ? model.createSelection(modelRanges) : modelSelection };
      editor.execute('insertText', insertTextOptions);
      view.scrollToTheSelection();
    });

    this.listenTo(viewDocument, 'mutations', (evt, data: { mutations: MutationData[] }) => {
      for (const mutation of data.mutations) {
        const element = mutation.type === 'children' ? (mutation.node as ViewElement) : (mutation.node.parent as ViewElement);
        const container = this._findMappedContainer(element);
        if (container) this._pendingMutations.add(container);
      }
      if (viewDocument.isComposing && !env.isAndroid) return;
      this._flushMutations();
    });

    this.listenTo(viewDocument, 'compositionend', () => {
      view.getObserver(MutationObserverRef())?.flush();
      this._flushMutations();
    }, { priority: 'low' });
  }

  private _findMappedContainer(element: ViewElement | null): ViewElement | null {
    const mapper = this.editor.editing.mapper;
    let current: any = element;
    while (current && current.is && current.is('element')) {
      if (current.is('containerElement') && mapper.toModelElement(current)) return current;
      current = current.parent;
    }
    return null;
  }

  private _flushMutations(): void {
    if (!this._pendingMutations.size) return;
    const containers = Array.from(this._pendingMutations);
    this._pendingMutations.clear();
    for (const container of containers) {
      this._reconcileContainer(container);
    }
  }

  /** Reads the DOM text of a block and applies the difference to the model. */
  private _reconcileContainer(viewElement: ViewElement): void {
    const editor = this.editor;
    const model = editor.model;
    const mapper = editor.editing.mapper;
    const domConverter = editor.editing.view.domConverter;
    const modelElement = mapper.toModelElement(viewElement) as ModelElement | undefined;
    const domElement = domConverter.mapViewToDom(viewElement) as HTMLElement | undefined;
    if (!modelElement || !domElement || !(modelElement as any).is('element')) return;

    const domInfo = readDomSequence(domElement, domConverter);
    const modelSeq = readModelSequence(modelElement);
    if (domInfo.text === modelSeq) {
      // Nothing changed in the content, but the DOM may still differ (e.g. nodes split) — re-render.
      editor.editing.view.forceRender();
      return;
    }

    // Common prefix / suffix.
    let prefix = 0;
    const maxPrefix = Math.min(domInfo.text.length, modelSeq.length);
    while (prefix < maxPrefix && domInfo.text[prefix] === modelSeq[prefix]) prefix++;
    let suffix = 0;
    while (suffix < maxPrefix - prefix && domInfo.text[domInfo.text.length - 1 - suffix] === modelSeq[modelSeq.length - 1 - suffix]) suffix++;

    const removedLength = modelSeq.length - prefix - suffix;
    const insertedText = domInfo.text.slice(prefix, domInfo.text.length - suffix);
    if (insertedText.includes(INLINE_OBJECT_PLACEHOLDER)) {
      // Structural change we cannot reconcile textually: restore the DOM from the model.
      editor.editing.reconvertItem(modelElement);
      return;
    }

    const caretOffset = domInfo.caretOffset;

    model.enqueueChange(this._getBatch(), writer => {
      const start = ModelPosition._createAt(modelElement, prefix);
      const end = ModelPosition._createAt(modelElement, prefix + removedLength);
      let attributes: Iterable<[string, unknown]> = [];
      const nodeBefore = start.textNode || start.nodeBefore;
      const nodeAfter = end.textNode || end.nodeAfter;
      if (nodeBefore && (nodeBefore as any).is('$text')) attributes = nodeBefore.getAttributes();
      else if (nodeAfter && (nodeAfter as any).is('$text')) attributes = nodeAfter.getAttributes();
      else attributes = model.document.selection.getAttributes();

      if (removedLength > 0) {
        writer.remove(new ModelRange(start, end));
      }
      if (insertedText.length > 0) {
        writer.insertText(insertedText, attributes as any, start);
      }
      if (caretOffset !== null) {
        const offset = Math.min(caretOffset, modelElement.maxOffset);
        writer.setSelection(ModelPosition._createAt(modelElement, offset));
      }
    });
    // Make sure the DOM matches the (possibly normalised) model.
    editor.editing.reconvertItem(modelElement);
  }

  private _getBatch() {
    const command = this.editor.commands.get('insertText') as InsertTextCommand;
    return command.buffer.batch;
  }
}

function readDomSequence(domElement: HTMLElement, domConverter: any): { text: string; caretOffset: number | null } {
  const selection = domElement.ownerDocument.getSelection();
  const anchorNode = selection && selection.rangeCount ? selection.focusNode : null;
  const anchorOffset = selection && selection.rangeCount ? selection.focusOffset : 0;
  let text = '';
  let caretOffset: number | null = null;

  const walk = (node: Node): void => {
    if (node === anchorNode && node.nodeType !== Node.TEXT_NODE) {
      // Caret between children: resolved when iterating children.
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const data = (node as Text).data.replace(/ /g, ' ').replace(/⁠/g, '');
      if (node === anchorNode) {
        caretOffset = text.length + Math.min(anchorOffset, data.length);
      }
      text += data;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (domConverter.isBlockFiller(el)) return;
    const viewNode = domConverter.mapDomToView(el);
    if (viewNode && (viewNode.is('uiElement') || viewNode.is('rawElement'))) return;
    const isInlineObject = viewNode && viewNode.is('element') && (viewNode.is('emptyElement') || el.tagName === 'BR' || el.tagName === 'IMG');
    if (isInlineObject) {
      text += INLINE_OBJECT_PLACEHOLDER;
      return;
    }
    const children = Array.from(el.childNodes);
    children.forEach((child, index) => {
      if (el === anchorNode && index === anchorOffset) caretOffset = text.length;
      walk(child);
    });
    if (el === anchorNode && anchorOffset >= children.length) caretOffset = text.length;
  };
  walk(domElement);
  return { text, caretOffset };
}

function readModelSequence(element: ModelElement): string {
  let text = '';
  for (const child of element.getChildren()) {
    if ((child as any).is('$text')) {
      text += (child as any).data;
    } else {
      text += INLINE_OBJECT_PLACEHOLDER;
    }
  }
  return text;
}

import { MutationObserver } from '../../engine/view/observer/mutationobserver';
function MutationObserverRef(): typeof MutationObserver {
  return MutationObserver;
}

export type { ViewRange, ViewText };
