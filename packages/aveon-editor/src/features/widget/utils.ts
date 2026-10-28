import type { DowncastWriter } from '../../engine/view/downcastwriter';
import type { Element as ViewElement } from '../../engine/view/element';
import type { EditableElement } from '../../engine/view/editableelement';
import type { Node as ViewNode } from '../../engine/view/node';
import type { Model } from '../../engine/model/model';
import type { Position as ModelPosition } from '../../engine/model/position';
import type { Mapper } from '../../engine/conversion/mapper';
import type { Selection } from '../../engine/model/selection';
import type { DocumentSelection } from '../../engine/model/documentselection';
import { findOptimalInsertionRange as engineFindOptimalInsertionRange } from '../../engine/model/utils/insertobject';
import { IconView } from '../../ui/icon/iconview';
import { icons } from '../../ui/icons';
import type { HighlightDescriptor } from '../../engine/conversion/downcasthelpers';

export const WIDGET_CLASS_NAME = 'ck-widget';
export const WIDGET_SELECTED_CLASS_NAME = 'ck-widget_selected';

const widgetSymbol = Symbol('isWidget');
const labelSymbol = Symbol('label');

/** Returns `true` if the view element is a widget. */
export function isWidget(node: ViewNode | null | undefined): boolean {
  if (!node || !(node as any).is || !(node as any).is('element')) return false;
  return !!(node as ViewElement).getCustomProperty(widgetSymbol);
}

/** Turns a view element into a widget: non-editable, selectable as a whole, with highlight handling. */
export function toWidget(element: ViewElement, writer: DowncastWriter, options: { label?: string | (() => string); hasSelectionHandle?: boolean } = {}): ViewElement {
  if (!(element as any).is('containerElement')) {
    throw new Error('widget-to-widget-wrong-element-type: The element must be a container element.');
  }
  writer.setAttribute('contenteditable', 'false', element);
  writer.addClass(WIDGET_CLASS_NAME, element);
  writer.setCustomProperty(widgetSymbol, true, element);
  (element as any).getFillerOffset = () => null;
  if (options.label) {
    setLabel(element, options.label);
  }
  if (options.hasSelectionHandle) {
    addSelectionHandle(element, writer);
  }
  setHighlightHandling(element, writer);
  return element;
}

/** Sets the highlight add/remove handlers on the element. */
export function setHighlightHandling(element: ViewElement, writer: DowncastWriter, add?: (element: ViewElement, descriptor: HighlightDescriptor, writer: DowncastWriter) => void, remove?: (element: ViewElement, id: string, writer: DowncastWriter) => void): void {
  const addHighlight = add || ((el: ViewElement, descriptor: HighlightDescriptor, w: DowncastWriter) => {
    if (descriptor.classes) w.addClass(descriptor.classes, el);
    if (descriptor.attributes) {
      for (const key of Object.keys(descriptor.attributes)) w.setAttribute(key, descriptor.attributes[key], el);
    }
  });
  const removeHighlight = remove || ((el: ViewElement, id: string, w: DowncastWriter) => {
    const descriptors = (el.getCustomProperty('highlightDescriptors') as HighlightDescriptor[]) || [];
    const descriptor = descriptors.find(d => d.id === id);
    if (descriptor) {
      if (descriptor.classes) w.removeClass(descriptor.classes, el);
      if (descriptor.attributes) {
        for (const key of Object.keys(descriptor.attributes)) w.removeAttribute(key, el);
      }
    }
  });
  writer.setCustomProperty('addHighlight', (el: ViewElement, descriptor: HighlightDescriptor, w: DowncastWriter) => {
    const descriptors = ((el.getCustomProperty('highlightDescriptors') as HighlightDescriptor[]) || []).slice();
    descriptors.push(descriptor);
    w.setCustomProperty('highlightDescriptors', descriptors, el);
    addHighlight(el, descriptor, w);
  }, element);
  writer.setCustomProperty('removeHighlight', (el: ViewElement, id: string, w: DowncastWriter) => {
    removeHighlight(el, id, w);
    const descriptors = ((el.getCustomProperty('highlightDescriptors') as HighlightDescriptor[]) || []).filter(d => d.id !== id);
    w.setCustomProperty('highlightDescriptors', descriptors, el);
  }, element);
}

export function setLabel(element: ViewElement, labelOrCreator: string | (() => string)): void {
  const creator = typeof labelOrCreator === 'function' ? labelOrCreator : () => labelOrCreator;
  (element as any)._setCustomProperty(labelSymbol, creator);
}

export function getLabel(element: ViewElement): string {
  const labelCreator = element.getCustomProperty(labelSymbol) as (() => string) | undefined;
  return labelCreator ? labelCreator() : '';
}

/** Makes a nested editable element inside a widget (captions, table cells). */
export function toWidgetEditable(editable: EditableElement, writer: DowncastWriter, options: { label?: string } = {}): EditableElement {
  writer.addClass(['ck-editor__editable', 'ck-editor__nested-editable'], editable);
  writer.setAttribute('role', 'textbox', editable);
  writer.setAttribute('tabindex', '-1', editable);
  if (options.label) {
    writer.setAttribute('aria-label', options.label, editable);
  }
  writer.setAttribute('contenteditable', editable.isReadOnly ? 'false' : 'true', editable);
  editable.on('change:isReadOnly', (evt, property, is: boolean) => {
    writer.setAttribute('contenteditable', is ? 'false' : 'true', editable);
  });
  editable.on('change:isFocused', (evt, property, is: boolean) => {
    if (is) {
      writer.addClass('ck-editor__nested-editable_focused', editable);
    } else {
      writer.removeClass('ck-editor__nested-editable_focused', editable);
    }
  });
  setHighlightHandling(editable, writer);
  return editable;
}

/** Returns the optimal range for inserting a block widget at the selection. */
export function findOptimalInsertionRange(selection: Selection | DocumentSelection, model: Model): any {
  const selectedElement = selection.getSelectedElement();
  if (selectedElement) {
    const typeAroundFakeCaretPosition = null;
    void typeAroundFakeCaretPosition;
  }
  return engineFindOptimalInsertionRange(selection, model);
}

/** Maps view positions inside inline widgets to model positions outside them. */
export function viewToModelPositionOutsideModelElement(model: Model, viewElementMatcher: (element: ViewElement) => boolean) {
  return (evt: any, data: { mapper: Mapper; viewPosition: any; modelPosition?: ModelPosition }) => {
    const { mapper, viewPosition } = data;
    const viewParent = mapper.findMappedViewAncestor(viewPosition);
    if (!viewElementMatcher(viewParent)) return;
    const modelParent = mapper.toModelElement(viewParent)!;
    data.modelPosition = model.createPositionAt(modelParent as any, viewPosition.isAtStart ? 'before' : 'after');
  };
}

function addSelectionHandle(widgetElement: ViewElement, writer: DowncastWriter): void {
  const selectionHandle = writer.createUIElement('div', { class: 'ck ck-widget__selection-handle' }, function (domDocument) {
    const domElement = this.toDomElement(domDocument);
    const icon = new IconView();
    icon.set('content', icons.threeVerticalDots);
    icon.render();
    domElement.appendChild(icon.element!);
    return domElement;
  });
  writer.insert(writer.createPositionAt(widgetElement, 0), selectionHandle);
  writer.addClass(['ck-widget_with-selection-handle'], widgetElement);
}

/** Returns the closest widget ancestor (or the element itself). */
export function findWidget(viewElement: ViewElement | null): ViewElement | null {
  let current: any = viewElement;
  while (current) {
    if (isWidget(current)) return current;
    current = current.parent;
  }
  return null;
}
