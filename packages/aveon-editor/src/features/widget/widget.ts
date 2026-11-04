import { Plugin } from '../../core/plugin';
import { DomEventObserver } from '../../engine/view/observer/domeventobserver';
import { isWidget, getLabel, WIDGET_SELECTED_CLASS_NAME, findWidget } from './utils';
import { getLocalizedArrowKeyCodeDirection, keyCodes } from '../../utils/keyboard';
import { env } from '../../utils/env';
import { Delete } from '../typing/delete';
import type { Element as ViewElement } from '../../engine/view/element';
import type { Element as ModelElement } from '../../engine/model/element';
import type { DowncastWriter } from '../../engine/view/downcastwriter';

/** Fires `mousedown`, `mouseup`, `mouseover`, `mouseout` on the view document. */
export class MouseObserver extends DomEventObserver<MouseEvent> {
  public readonly domEventType = ['mousedown', 'mouseup', 'mouseover', 'mouseout'] as const;

  public onDomEvent(domEvent: MouseEvent): void {
    this.fire(domEvent.type, domEvent);
  }
}

/**
 * Widget support: selecting widgets with the mouse and keyboard, fake selection,
 * deleting widgets with Backspace/Delete and inserting paragraphs around them with Enter.
 */
export class Widget extends Plugin {
  private _previouslySelected = new Set<ViewElement>();

  public static override get pluginName(): string {
    return 'Widget';
  }

  public static override get requires() {
    return [Delete];
  }

  public override init(): void {
    const editor = this.editor;
    const view = editor.editing.view;
    const viewDocument = view.document;

    // Fake selection for selected widgets.
    this.listenTo(editor.editing.downcastDispatcher, 'selection', (evt, data: any, conversionApi: any) => {
      const viewWriter: DowncastWriter = conversionApi.writer;
      const modelSelection = data.selection;
      if (modelSelection.isCollapsed) return;
      const selectedModelElement = modelSelection.getSelectedElement();
      if (!selectedModelElement) return;
      const selectedViewElement = editor.editing.mapper.toViewElement(selectedModelElement) as ViewElement | undefined;
      if (!selectedViewElement || !isWidget(selectedViewElement)) return;
      if (!conversionApi.consumable.consume(modelSelection, 'selection')) return;
      viewWriter.setSelection(viewWriter.createRangeOn(selectedViewElement), { fake: true, label: getLabel(selectedViewElement) });
    });

    // Mark selected widgets with a class.
    this.listenTo(editor.editing.downcastDispatcher, 'selection', (evt, data: any, conversionApi: any) => {
      this._clearPreviouslySelectedWidgets(conversionApi.writer);
      const viewWriter: DowncastWriter = conversionApi.writer;
      const viewSelection = viewWriter.document.selection;
      let lastMarked: ViewElement | null = null;
      for (const range of viewSelection.getRanges()) {
        for (const value of range) {
          const node = value.item as ViewElement;
          if (isWidget(node) && !isChild(node, lastMarked)) {
            viewWriter.addClass(WIDGET_SELECTED_CLASS_NAME, node);
            this._previouslySelected.add(node);
            lastMarked = node;
          }
        }
      }
    }, { priority: 'low' });

    view.addObserver(MouseObserver);
    this.listenTo(viewDocument, 'mousedown', (...args) => this._onMousedown(...(args as [any, any])));

    this.listenTo(viewDocument, 'arrowKey', (...args) => {
      this._handleSelectionChangeOnArrowKeyPress(...(args as [any, any]));
    }, { context: [isWidget as any, '$text'] });

    this.listenTo(viewDocument, 'arrowKey', (...args) => {
      this._preventDefaultOnArrowKeyPress(...(args as [any, any]));
    }, { context: '$root' });

    this.listenTo(viewDocument, 'delete', (evt, data: any) => {
      if (this._handleDelete(data.direction === 'forward')) {
        data.preventDefault();
        evt.stop();
      }
    }, { context: '$root' });

    this.listenTo(viewDocument, 'enter', (evt, data: any) => {
      const selectedElement = editor.model.document.selection.getSelectedElement();
      if (!selectedElement || !editor.model.schema.isObject(selectedElement)) return;
      data.preventDefault();
      evt.stop();
      editor.model.change(writer => {
        const position = data.isSoft ? writer.createPositionBefore(selectedElement) : writer.createPositionAfter(selectedElement);
        editor.execute('insertParagraph', { position });
      });
    }, { context: isWidget as any, priority: 'high' });

    // Typing on a selected widget replaces it; pressing Esc unselects (moves caret after the widget).
    this.listenTo(viewDocument, 'keydown', (evt, data: any) => {
      if (data.keyCode !== keyCodes.esc) return;
      const selectedElement = editor.model.document.selection.getSelectedElement();
      if (!selectedElement || !editor.model.schema.isObject(selectedElement)) return;
      const range = editor.model.schema.getNearestSelectionRange(editor.model.createPositionAfter(selectedElement), 'forward');
      if (range) {
        editor.model.change(writer => writer.setSelection(range));
      }
    });
  }

  private _onMousedown(eventInfo: any, domEventData: any): void {
    const editor = this.editor;
    const view = editor.editing.view;
    const viewDocument = view.document;
    let element: ViewElement | null = domEventData.target;

    // A press inside a raw element (a drawn sketch or diagram) has no view node of its own: use the
    // widget around it, so the widget gets selected even while a caption has the focus.
    if (!element) {
      const domTarget = domEventData.domEvent?.target as HTMLElement | null;
      const domWidget = domTarget && typeof domTarget.closest === 'function' ? domTarget.closest('.ck-widget') : null;
      element = domWidget ? ((view.domConverter.mapDomToView(domWidget) as ViewElement | undefined) || null) : null;
    }

    if (isInsideNestedEditable(element)) {
      if ((env.isSafari || env.isGecko) && domEventData.domEvent.detail >= 3) {
        const mapper = editor.editing.mapper;
        const viewElement = element!.is('attributeElement') ? element!.findAncestor(el => !el.is('attributeElement'))! : element!;
        const modelElement = mapper.toModelElement(viewElement);
        domEventData.preventDefault();
        this.editor.model.change(writer => {
          writer.setSelection(modelElement as any, 'in');
        });
      }
      return;
    }

    if (!isWidget(element)) {
      element = findWidget(element);
      if (!element) return;
    }

    if (env.isAndroid) {
      domEventData.preventDefault();
    }
    if (!viewDocument.isFocused) {
      view.focus();
    }
    const modelElement = editor.editing.mapper.toModelElement(element!) as ModelElement;
    this._setSelectionOverElement(modelElement);
    // A press on the drag grip must keep its default, or the browser never starts the drag.
    const domTarget = domEventData.domEvent?.target as HTMLElement | null;
    if (domTarget && typeof domTarget.closest === 'function' && domTarget.closest('.ck-widget__selection-handle')) return;
    domEventData.preventDefault();
  }

  private _handleSelectionChangeOnArrowKeyPress(eventInfo: any, domEventData: any): void {
    // Alt+Arrow combinations belong to other features (Alt+Shift+↑/↓ moves a figure).
    if (domEventData.altKey) return;
    const keyCode = domEventData.keyCode;
    const model = this.editor.model;
    const schema = model.schema;
    const modelSelection = model.document.selection;
    const objectElement = modelSelection.getSelectedElement();
    const direction = getLocalizedArrowKeyCodeDirection(keyCode, this.editor.locale.contentLanguageDirection);
    const isForward = direction === 'down' || direction === 'right';
    const isVerticalNavigation = direction === 'up' || direction === 'down';

    if (objectElement && schema.isObject(objectElement)) {
      const position = isForward ? modelSelection.getLastPosition()! : modelSelection.getFirstPosition()!;
      const newRange = schema.getNearestSelectionRange(position, isForward ? 'forward' : 'backward');
      if (newRange) {
        model.change(writer => writer.setSelection(newRange));
        domEventData.preventDefault();
        eventInfo.stop();
      }
      return;
    }

    if (!modelSelection.isCollapsed && !domEventData.shiftKey) {
      const firstPosition = modelSelection.getFirstPosition()!;
      const lastPosition = modelSelection.getLastPosition()!;
      const after = firstPosition.nodeAfter;
      const before = lastPosition.nodeBefore;
      if ((after && schema.isObject(after as any)) || (before && schema.isObject(before as any))) {
        model.change(writer => writer.setSelection(isForward ? lastPosition : firstPosition));
        domEventData.preventDefault();
        eventInfo.stop();
      }
      return;
    }

    if (!modelSelection.isCollapsed) return;

    const objectElementNextToSelection = this._getObjectElementNextToSelection(isForward);
    if (objectElementNextToSelection && schema.isObject(objectElementNextToSelection)) {
      if (schema.isInline(objectElementNextToSelection) && isVerticalNavigation) return;
      this._setSelectionOverElement(objectElementNextToSelection);
      domEventData.preventDefault();
      eventInfo.stop();
    }
  }

  private _preventDefaultOnArrowKeyPress(eventInfo: any, domEventData: any): void {
    // Alt+Arrow combinations belong to other features (Alt+Shift+↑/↓ moves a figure).
    if (domEventData.altKey) return;
    const model = this.editor.model;
    const schema = model.schema;
    const objectElement = model.document.selection.getSelectedElement();
    if (objectElement && schema.isObject(objectElement)) {
      domEventData.preventDefault();
      eventInfo.stop();
    }
  }

  private _handleDelete(isForward: boolean): boolean {
    const editor = this.editor;
    if (editor.isReadOnly) return false;
    const model = editor.model;
    const schema = model.schema;
    const modelDocument = model.document;
    const modelSelection = modelDocument.selection;
    const selected = modelSelection.getSelectedElement();
    if (selected && schema.isObject(selected) && schema.isBlock(selected)) {
      model.change(writer => {
        const parent = selected.parent as ModelElement;
        const position = writer.createPositionBefore(selected);
        writer.remove(selected);
        // The caret goes to the neighbouring block (another widget there gets selected, so the
        // next key press removes it too); a paragraph is added only where nothing would be left.
        const range = schema.getNearestSelectionRange(position, isForward ? 'forward' : 'backward') || schema.getNearestSelectionRange(position, isForward ? 'backward' : 'forward');
        if (range && parent.childCount > 0) {
          writer.setSelection(range);
        } else {
          const paragraph = writer.createElement('paragraph');
          writer.insert(paragraph, position);
          writer.setSelection(paragraph, 0);
        }
      });
      return true;
    }
    if (!modelSelection.isCollapsed) return false;
    const objectElement = this._getObjectElementNextToSelection(isForward);
    if (objectElement) {
      editor.model.change(writer => {
        let previousNode: any = modelSelection.anchor!.parent;
        while (previousNode.isEmpty) {
          const nodeToRemove = previousNode;
          previousNode = nodeToRemove.parent;
          writer.remove(nodeToRemove);
        }
        this._setSelectionOverElement(objectElement);
      });
      return true;
    }
    return false;
  }

  private _setSelectionOverElement(element: ModelElement): void {
    this.editor.model.change(writer => {
      writer.setSelection(writer.createRangeOn(element));
    });
  }

  private _getObjectElementNextToSelection(forward: boolean): ModelElement | null {
    const model = this.editor.model;
    const schema = model.schema;
    const modelSelection = model.document.selection;
    const probe = model.createSelection(modelSelection as any);
    model.modifySelection(probe, { direction: forward ? 'forward' : 'backward' });
    if (probe.isEqual(modelSelection as any)) return null;
    const objectElement = forward ? probe.focus!.nodeBefore : probe.focus!.nodeAfter;
    if (!!objectElement && schema.isObject(objectElement as any)) return objectElement as ModelElement;
    return null;
  }

  private _clearPreviouslySelectedWidgets(writer: DowncastWriter): void {
    for (const widget of this._previouslySelected) {
      writer.removeClass(WIDGET_SELECTED_CLASS_NAME, widget);
    }
    this._previouslySelected.clear();
  }
}

function isInsideNestedEditable(element: ViewElement | null): boolean {
  let current: any = element;
  while (current) {
    if (current.is && current.is('editableElement') && !current.is('rootElement')) return true;
    if (isWidget(current)) return false;
    current = current.parent;
  }
  return false;
}

function isChild(element: ViewElement, parent: ViewElement | null): boolean {
  if (!parent) return false;
  return Array.from(element.getAncestors()).includes(parent);
}
