import { ConversionHelpers } from './conversionhelpers';
import type { DowncastDispatcher, DowncastConversionApi, DowncastInsertEvent, DowncastAttributeEvent, DowncastMarkerEvent } from './downcastdispatcher';
import type { Element as ModelElement } from '../model/element';
import type { Item as ModelItem } from '../model/item';
import { Range as ModelRange } from '../model/range';
import { Position as ModelPosition } from '../model/position';
import type { Element as ViewElement } from '../view/element';
import type { AttributeElement as ViewAttributeElement } from '../view/attributeelement';
import { ContainerElement as ViewContainerElement } from '../view/containerelement';
import type { DowncastWriter } from '../view/downcastwriter';
import type { EventInfo } from '../../utils/eventinfo';
import type { PriorityString } from '../../utils/priorities';
import type { Node as ViewNode } from '../view/node';

export interface ElementDefinition {
  name: string;
  classes?: string | string[];
  styles?: Record<string, string>;
  attributes?: Record<string, string>;
  priority?: number;
}

export type ElementCreatorFunction = (modelElement: ModelElement, conversionApi: DowncastConversionApi, data: DowncastInsertEvent) => ViewElement | null;
export type AttributeElementCreatorFunction = (value: unknown, conversionApi: DowncastConversionApi, data: DowncastAttributeEvent) => ViewAttributeElement | null;
export type AttributeCreatorFunction = (value: unknown, conversionApi: DowncastConversionApi, data: DowncastAttributeEvent) => { key: string; value: unknown } | null;
export type MarkerElementCreatorFunction = (data: DowncastMarkerEvent & { isOpening: boolean }, conversionApi: DowncastConversionApi) => ViewElement | null;

export interface HighlightDescriptor {
  classes?: string | string[];
  id?: string;
  priority?: number;
  attributes?: Record<string, string>;
}
export type HighlightDescriptorCreatorFunction = (data: DowncastMarkerEvent, conversionApi: DowncastConversionApi) => HighlightDescriptor | null | undefined;

export interface ElementToElementConfig {
  model: string | { name: string; attributes?: string | string[]; children?: boolean };
  view: string | ElementDefinition | ElementCreatorFunction;
  converterPriority?: PriorityString;
}

export interface AttributeToElementConfig {
  model: string | { key: string; name?: string; values?: string[] };
  view: string | ElementDefinition | AttributeElementCreatorFunction | Record<string, string | ElementDefinition>;
  converterPriority?: PriorityString;
}

export interface AttributeToAttributeConfig {
  model: string | { key: string; name?: string; values?: string[] };
  view: string | { key: string; value?: unknown; name?: string } | AttributeCreatorFunction | Record<string, { key: string; value: unknown }>;
  converterPriority?: PriorityString;
}

/** Downcast (model → view) conversion helpers. */
export class DowncastHelpers extends ConversionHelpers<DowncastDispatcher> {
  public elementToElement(config: ElementToElementConfig): this {
    return this.add(downcastElementToElement(config));
  }

  public elementToStructure(config: ElementToElementConfig): this {
    return this.add(downcastElementToStructure(config));
  }

  public attributeToElement(config: AttributeToElementConfig): this {
    return this.add(downcastAttributeToElement(config));
  }

  public attributeToAttribute(config: AttributeToAttributeConfig): this {
    return this.add(downcastAttributeToAttribute(config));
  }

  public markerToElement(config: { model: string; view: ElementDefinition | MarkerElementCreatorFunction; converterPriority?: PriorityString }): this {
    return this.add(downcastMarkerToElement(config));
  }

  public markerToHighlight(config: { model: string; view: HighlightDescriptor | HighlightDescriptorCreatorFunction; converterPriority?: PriorityString }): this {
    return this.add(downcastMarkerToHighlight(config));
  }

  public markerToData(config: { model: string; view?: (markerName: string, conversionApi: DowncastConversionApi) => { group: string; name: string } | null; converterPriority?: PriorityString }): this {
    return this.add(downcastMarkerToData(config));
  }
}

/** Default `insert:$text` converter. */
export function insertText() {
  return (evt: EventInfo, data: DowncastInsertEvent, conversionApi: DowncastConversionApi): void => {
    if (!conversionApi.consumable.consume(data.item, evt.name)) return;
    const viewWriter = conversionApi.writer;
    const viewPosition = conversionApi.mapper.toViewPosition(data.range.start);
    const viewText = viewWriter.createText((data.item as any).data);
    viewWriter.insert(viewPosition, viewText);
  };
}

/** Default lowest-priority `insert` handler that converts attributes and children of the inserted item. */
export function insertAttributesAndChildren() {
  return (evt: EventInfo, data: DowncastInsertEvent, conversionApi: DowncastConversionApi): void => {
    conversionApi.convertAttributes(data.item);
    if (!data.reconversion && (data.item as any).is('element') && !(data.item as ModelElement).isEmpty && conversionApi.mapper.toViewElement(data.item as ModelElement)) {
      conversionApi.convertChildren(data.item as ModelElement);
    }
  };
}

/** Fallback for model elements without a converter: converts the children in place. */
export function insertUnknownElementChildren() {
  return (evt: EventInfo, data: DowncastInsertEvent, conversionApi: DowncastConversionApi): void => {
    if (!(data.item as any).is('element')) return;
    if (conversionApi.consumable.test(data.item, 'insert') !== true) return;
    const element = data.item as ModelElement;
    conversionApi.consumable.consume(element, 'insert');
    const viewElement = conversionApi.writer.createContainerElement('div', { 'data-aveon-unknown': element.name });
    conversionApi.writer.insert(conversionApi.mapper.toViewPosition(data.range.start), viewElement);
    conversionApi.mapper.bindElements(element, viewElement);
  };
}

/** Default `remove` converter. */
export function remove() {
  return (evt: EventInfo, data: { position: ModelPosition; length: number }, conversionApi: DowncastConversionApi): void => {
    const viewStart = conversionApi.mapper.toViewPosition(data.position);
    const modelEnd = data.position.getShiftedBy(data.length);
    const viewEnd = conversionApi.mapper.toViewPosition(modelEnd, { isPhantom: true });
    const viewRange = conversionApi.writer.createRange(viewStart, viewEnd);
    const removed = conversionApi.writer.remove(viewRange.getTrimmed());
    for (const child of Array.from(removed.getChildren())) {
      if ((child as any).is('element')) conversionApi.mapper.unbindViewTree(child as ViewElement);
    }
  };
}

/** Default `selection` converter for non-collapsed selections. */
export function convertRangeSelection() {
  return (evt: EventInfo, data: { selection: any }, conversionApi: DowncastConversionApi): void => {
    const selection = data.selection;
    if (selection.isCollapsed) return;
    if (!conversionApi.consumable.consume(selection, 'selection')) return;
    const viewRanges = [];
    for (const range of selection.getRanges()) {
      viewRanges.push(conversionApi.mapper.toViewRange(range));
    }
    conversionApi.writer.setSelection(viewRanges, { backward: selection.isBackward });
  };
}

/** Default `selection` converter for collapsed selections. */
export function convertCollapsedSelection() {
  return (evt: EventInfo, data: { selection: any }, conversionApi: DowncastConversionApi): void => {
    const selection = data.selection;
    if (!selection.isCollapsed) return;
    if (!conversionApi.consumable.consume(selection, 'selection')) return;
    const viewWriter = conversionApi.writer;
    const modelPosition = selection.getFirstPosition();
    const viewPosition = conversionApi.mapper.toViewPosition(modelPosition);
    viewWriter.setSelection(viewPosition);
  };
}

/** Clears the view selection before it gets re-converted (and merges attribute elements left behind). */
export function clearAttributes() {
  return (evt: EventInfo, data: unknown, conversionApi: DowncastConversionApi): void => {
    const viewWriter = conversionApi.writer;
    const viewSelection = viewWriter.document.selection;
    for (const range of viewSelection.getRanges()) {
      if (range.isCollapsed) {
        if ((range.end.parent as any).isAttached && (range.end.parent as any).isAttached()) {
          try {
            conversionApi.writer.mergeAttributes(range.start);
          } catch {
            /* ignore */
          }
        }
      }
    }
    viewWriter.setSelection(null);
  };
}

export function createViewElementFromDefinition(viewElementDefinition: ElementDefinition | string, conversionApi: DowncastConversionApi, viewElementType: 'container' | 'attribute' | 'ui'): ViewElement {
  const writer = conversionApi.writer;
  if (typeof viewElementDefinition === 'string') {
    viewElementDefinition = { name: viewElementDefinition };
  }
  let element: ViewElement;
  const attributes = Object.assign({}, viewElementDefinition.attributes);
  if (viewElementType === 'container') {
    element = writer.createContainerElement(viewElementDefinition.name, attributes);
  } else if (viewElementType === 'attribute') {
    const options = { priority: viewElementDefinition.priority || (10 as number) };
    element = writer.createAttributeElement(viewElementDefinition.name, attributes, options);
  } else {
    element = writer.createUIElement(viewElementDefinition.name, attributes);
  }
  if (viewElementDefinition.styles) {
    const keys = Object.keys(viewElementDefinition.styles);
    for (const key of keys) {
      writer.setStyle(key, viewElementDefinition.styles[key], element);
    }
  }
  if (viewElementDefinition.classes) {
    const classes = viewElementDefinition.classes;
    if (typeof classes === 'string') {
      writer.addClass(classes, element);
    } else {
      for (const className of classes) writer.addClass(className, element);
    }
  }
  return element;
}

function downcastElementToElement(config: ElementToElementConfig) {
  const model = normalizeModelElementConfig(config.model);
  const view = normalizeToElementConfig(config.view, 'container');
  return (dispatcher: DowncastDispatcher) => {
    dispatcher.on(`insert:${model.name}`, insertElement(view), { priority: config.converterPriority || 'normal' });
  };
}

function downcastElementToStructure(config: ElementToElementConfig) {
  const model = normalizeModelElementConfig(config.model);
  const view = normalizeToElementConfig(config.view, 'container');
  return (dispatcher: DowncastDispatcher) => {
    dispatcher.on(`insert:${model.name}`, insertStructure(view), { priority: config.converterPriority || 'normal' });
  };
}

function downcastAttributeToElement(config: AttributeToElementConfig) {
  const model = typeof config.model === 'string' ? { key: config.model } : config.model;
  const modelKey = model.key;
  let eventName = `attribute:${modelKey}`;
  if (model.name) eventName += ':' + model.name;
  let elementCreator: AttributeElementCreatorFunction;
  if (model.values) {
    const map = config.view as Record<string, string | ElementDefinition>;
    elementCreator = (value, conversionApi, data) => {
      const def = map[value as string];
      if (!def) return null;
      return createViewElementFromDefinition(def, conversionApi, 'attribute') as ViewAttributeElement;
    };
  } else {
    elementCreator = normalizeToElementConfig(config.view as any, 'attribute') as AttributeElementCreatorFunction;
  }
  return (dispatcher: DowncastDispatcher) => {
    dispatcher.on(eventName, wrap(elementCreator), { priority: config.converterPriority || 'normal' });
  };
}

function downcastAttributeToAttribute(config: AttributeToAttributeConfig) {
  const model = typeof config.model === 'string' ? { key: config.model } : config.model;
  const modelKey = model.key;
  let eventName = `attribute:${modelKey}`;
  if (model.name) eventName += ':' + model.name;
  let attributeCreator: AttributeCreatorFunction;
  if (model.values) {
    const map = config.view as Record<string, { key: string; value: unknown }>;
    attributeCreator = value => (map[value as string] ? { key: map[value as string].key, value: map[value as string].value } : null);
  } else {
    attributeCreator = normalizeToAttributeConfig(config.view as any);
  }
  return (dispatcher: DowncastDispatcher) => {
    dispatcher.on(eventName, changeAttribute(attributeCreator), { priority: config.converterPriority || 'normal' });
  };
}

function downcastMarkerToElement(config: { model: string; view: ElementDefinition | MarkerElementCreatorFunction; converterPriority?: PriorityString }) {
  const view = typeof config.view === 'function' ? config.view : (data: any, conversionApi: DowncastConversionApi) => createViewElementFromDefinition(config.view as ElementDefinition, conversionApi, 'ui');
  return (dispatcher: DowncastDispatcher) => {
    dispatcher.on(`addMarker:${config.model}`, insertUIElement(view), { priority: config.converterPriority || 'normal' });
    dispatcher.on(`removeMarker:${config.model}`, removeUIElement(), { priority: config.converterPriority || 'normal' });
  };
}

function downcastMarkerToHighlight(config: { model: string; view: HighlightDescriptor | HighlightDescriptorCreatorFunction; converterPriority?: PriorityString }) {
  return (dispatcher: DowncastDispatcher) => {
    dispatcher.on(`addMarker:${config.model}`, highlightText(config.view), { priority: config.converterPriority || 'normal' });
    dispatcher.on(`addMarker:${config.model}`, highlightElement(config.view), { priority: config.converterPriority || 'normal' });
    dispatcher.on(`removeMarker:${config.model}`, removeHighlight(config.view), { priority: config.converterPriority || 'normal' });
  };
}

function downcastMarkerToData(config: { model: string; view?: (markerName: string, conversionApi: DowncastConversionApi) => { group: string; name: string } | null; converterPriority?: PriorityString }) {
  const group = config.model;
  const view = config.view || ((markerName: string) => {
    const [, name] = markerName.split(':');
    return { group, name: name || markerName };
  });
  return (dispatcher: DowncastDispatcher) => {
    dispatcher.on(`addMarker:${group}`, insertMarkerData(view), { priority: config.converterPriority || 'normal' });
  };
}

function insertElement(elementCreator: ElementCreatorFunction) {
  return (evt: EventInfo, data: DowncastInsertEvent, conversionApi: DowncastConversionApi): void => {
    if (!conversionApi.consumable.test(data.item, evt.name)) return;
    const viewElement = elementCreator(data.item as ModelElement, conversionApi, data);
    if (!viewElement) return;
    conversionApi.consumable.consume(data.item, evt.name);
    const viewPosition = conversionApi.mapper.toViewPosition(data.range.start);
    conversionApi.writer.insert(viewPosition, viewElement);
    conversionApi.mapper.bindElements(data.item as ModelElement, viewElement);
    conversionApi.convertAttributes(data.item);
    conversionApi.convertChildren(data.item as ModelElement);
  };
}

const SLOT_NAME = '$slot';

function insertStructure(elementCreator: ElementCreatorFunction) {
  return (evt: EventInfo, data: DowncastInsertEvent, conversionApi: DowncastConversionApi): void => {
    if (!conversionApi.consumable.test(data.item, evt.name)) return;
    const writer = conversionApi.writer;
    const slots: Array<{ element: ViewElement; filter: 'children' | ((node: ModelItem) => boolean) }> = [];
    writer._registerSlotFactory((w: DowncastWriter, modeOrFilter: 'children' | ((node: any) => boolean)) => {
      const slot = w.createContainerElement(SLOT_NAME);
      slots.push({ element: slot, filter: modeOrFilter });
      return slot;
    });
    let viewElement: ViewElement | null;
    try {
      viewElement = elementCreator(data.item as ModelElement, conversionApi, data);
    } finally {
      writer._clearSlotFactory();
    }
    if (!viewElement) return;
    conversionApi.consumable.consume(data.item, evt.name);
    const modelElement = data.item as ModelElement;

    // Convert children into a temporary container bound to the model element, then distribute them to slots.
    const temp = new ViewContainerElement(writer.document, '$structure');
    conversionApi.mapper.bindElements(modelElement, temp);
    conversionApi.convertChildren(modelElement);

    const viewPosition = conversionApi.mapper.toViewPosition(data.range.start);
    writer.insert(viewPosition, viewElement);
    conversionApi.mapper.bindElements(modelElement, viewElement);
    conversionApi.convertAttributes(modelElement);

    const tempChildren = Array.from(temp.getChildren());
    const childToModel = new Map<ViewNode, ModelItem | undefined>();
    const modelChildren = Array.from(modelElement.getChildren());
    // Map converted view children to model children by order of mapped elements.
    let mi = 0;
    for (const child of tempChildren) {
      const mapped = (child as any).is('element') ? conversionApi.mapper.toModelElement(child as ViewElement) : undefined;
      if (mapped) {
        childToModel.set(child, mapped as ModelItem);
      } else {
        childToModel.set(child, modelChildren[mi]);
      }
      mi++;
    }
    for (const { element: slot, filter } of slots) {
      const nodesForSlot = tempChildren.filter(child => {
        if (filter === 'children') return true;
        const modelNode = childToModel.get(child);
        return modelNode ? filter(modelNode) : false;
      });
      for (const node of nodesForSlot) {
        node._remove();
      }
      const parent = slot.parent as ViewElement;
      const index = slot.index!;
      slot._remove();
      parent._insertChild(index, nodesForSlot);
    }
    for (const child of Array.from(temp.getChildren())) {
      // Children not assigned to any slot are dropped from the view.
      child._remove();
    }
    void ModelRange;
  };
}

function wrap(elementCreator: AttributeElementCreatorFunction) {
  return (evt: EventInfo, data: DowncastAttributeEvent, conversionApi: DowncastConversionApi): void => {
    if (!conversionApi.consumable.test(data.item as any, evt.name)) return;
    const oldViewElement = data.attributeOldValue === null || data.attributeOldValue === undefined ? null : elementCreator(data.attributeOldValue, conversionApi, data);
    const newViewElement = data.attributeNewValue === null || data.attributeNewValue === undefined ? null : elementCreator(data.attributeNewValue, conversionApi, data);
    if (!oldViewElement && !newViewElement) return;
    conversionApi.consumable.consume(data.item as any, evt.name);
    const viewWriter = conversionApi.writer;
    if ((data.item as any).is('selection') || (data.item as any).is('documentSelection')) {
      return;
    }
    let viewRange = conversionApi.mapper.toViewRange(data.range);
    if (data.attributeOldValue !== null && data.attributeOldValue !== undefined && oldViewElement) {
      viewRange = viewWriter.unwrap(viewRange, oldViewElement);
    }
    if (data.attributeNewValue !== null && data.attributeNewValue !== undefined && newViewElement) {
      viewWriter.wrap(viewRange, newViewElement);
    }
  };
}

function changeAttribute(attributeCreator: AttributeCreatorFunction) {
  return (evt: EventInfo, data: DowncastAttributeEvent, conversionApi: DowncastConversionApi): void => {
    if (!conversionApi.consumable.test(data.item as any, evt.name)) return;
    const oldAttribute = data.attributeOldValue === null || data.attributeOldValue === undefined ? null : attributeCreator(data.attributeOldValue, conversionApi, data);
    const newAttribute = data.attributeNewValue === null || data.attributeNewValue === undefined ? null : attributeCreator(data.attributeNewValue, conversionApi, data);
    if (!oldAttribute && !newAttribute) return;
    conversionApi.consumable.consume(data.item as any, evt.name);
    const viewElement = conversionApi.mapper.toViewElement(data.item as ModelElement) as ViewElement | undefined;
    const writer = conversionApi.writer;
    if (!viewElement) {
      throw new Error('conversion-attribute-to-attribute-on-text: Cannot set an attribute on a text node.');
    }
    if (oldAttribute) {
      if (oldAttribute.key === 'class') {
        const classes = toArray(oldAttribute.value as string | string[]);
        for (const className of classes) writer.removeClass(className, viewElement);
      } else if (oldAttribute.key === 'style') {
        const keys = Object.keys(oldAttribute.value as Record<string, string>);
        for (const key of keys) writer.removeStyle(key, viewElement);
      } else {
        writer.removeAttribute(oldAttribute.key, viewElement);
      }
    }
    if (newAttribute) {
      if (newAttribute.key === 'class') {
        const classes = toArray(newAttribute.value as string | string[]);
        for (const className of classes) writer.addClass(className, viewElement);
      } else if (newAttribute.key === 'style') {
        const styles = newAttribute.value as Record<string, string>;
        for (const key of Object.keys(styles)) writer.setStyle(key, styles[key], viewElement);
      } else {
        writer.setAttribute(newAttribute.key, newAttribute.value as string, viewElement);
      }
    }
  };
}

function insertUIElement(elementCreator: (data: any, conversionApi: DowncastConversionApi) => ViewElement | null) {
  return (evt: EventInfo, data: DowncastMarkerEvent, conversionApi: DowncastConversionApi): void => {
    if (data.item) return;
    const markerRange = data.markerRange;
    const viewStartElement = elementCreator({ ...data, isOpening: true }, conversionApi);
    const viewEndElement = elementCreator({ ...data, isOpening: false }, conversionApi);
    if (!viewStartElement || !viewEndElement) return;
    if (!conversionApi.consumable.consume(markerRange, evt.name)) return;
    const mapper = conversionApi.mapper;
    const viewWriter = conversionApi.writer;
    viewWriter.insert(mapper.toViewPosition(markerRange.start), viewStartElement);
    conversionApi.mapper.bindElementToMarker(viewStartElement, data.markerName);
    if (!markerRange.isCollapsed) {
      viewWriter.insert(mapper.toViewPosition(markerRange.end), viewEndElement);
      conversionApi.mapper.bindElementToMarker(viewEndElement, data.markerName);
    }
    evt.stop();
  };
}

function removeUIElement() {
  return (evt: EventInfo, data: DowncastMarkerEvent, conversionApi: DowncastConversionApi): void => {
    const elements = conversionApi.mapper.markerNameToElements(data.markerName);
    if (!elements) return;
    for (const element of elements) {
      conversionApi.mapper.unbindElementFromMarkerName(element, data.markerName);
      conversionApi.writer.clear(conversionApi.writer.createRangeOn(element), element);
    }
    conversionApi.writer.clearClonedElementsGroup(data.markerName);
    evt.stop();
  };
}

function insertMarkerData(viewCreator: (markerName: string, conversionApi: DowncastConversionApi) => { group: string; name: string } | null) {
  return (evt: EventInfo, data: DowncastMarkerEvent, conversionApi: DowncastConversionApi): void => {
    const viewMarkerData = viewCreator(data.markerName, conversionApi);
    if (!viewMarkerData) return;
    const markerRange = data.markerRange;
    if (!conversionApi.consumable.consume(markerRange, evt.name)) return;
    const writer = conversionApi.writer;
    const mapper = conversionApi.mapper;
    const attrName = `data-${viewMarkerData.group}`;
    for (const position of [markerRange.start, markerRange.end]) {
      const isStart = position === markerRange.start;
      const viewPosition = mapper.toViewPosition(position);
      const element = writer.createUIElement(`${viewMarkerData.group}-${isStart ? 'start' : 'end'}`, { name: viewMarkerData.name });
      writer.insert(viewPosition, element);
      mapper.bindElementToMarker(element, data.markerName);
      void attrName;
      if (markerRange.isCollapsed) break;
    }
  };
}

function highlightText(highlightDescriptor: HighlightDescriptor | HighlightDescriptorCreatorFunction) {
  return (evt: EventInfo, data: DowncastMarkerEvent, conversionApi: DowncastConversionApi): void => {
    if (!data.item) return;
    if (!(data.item as any).is('$textProxy')) return;
    const descriptor = prepareDescriptor(highlightDescriptor, data, conversionApi);
    if (!descriptor) return;
    if (!conversionApi.consumable.consume(data.item as any, evt.name)) return;
    const viewWriter = conversionApi.writer;
    const viewElement = createViewElementFromHighlightDescriptor(viewWriter, descriptor);
    const viewRange = conversionApi.mapper.toViewRange(data.range!);
    const rangeAfterWrap = viewWriter.wrap(viewRange, viewElement);
    for (const element of rangeAfterWrap.getItems()) {
      if ((element as any).is('attributeElement') && (element as ViewAttributeElement).isSimilar(viewElement)) {
        conversionApi.mapper.bindElementToMarker(element as ViewElement, data.markerName);
        break;
      }
    }
  };
}

function highlightElement(highlightDescriptor: HighlightDescriptor | HighlightDescriptorCreatorFunction) {
  return (evt: EventInfo, data: DowncastMarkerEvent, conversionApi: DowncastConversionApi): void => {
    if (!data.item) return;
    if (!(data.item as any).is('element')) return;
    const descriptor = prepareDescriptor(highlightDescriptor, data, conversionApi);
    if (!descriptor) return;
    if (!conversionApi.consumable.test(data.item as any, evt.name)) return;
    const viewElement = conversionApi.mapper.toViewElement(data.item as ModelElement) as ViewElement | undefined;
    if (viewElement && viewElement.getCustomProperty('addHighlight')) {
      conversionApi.consumable.consume(data.item as any, evt.name);
      for (const value of ModelRange._createIn(data.item as ModelElement)) {
        conversionApi.consumable.consume(value.item, evt.name);
      }
      (viewElement.getCustomProperty('addHighlight') as any)(viewElement, descriptor, conversionApi.writer);
      conversionApi.mapper.bindElementToMarker(viewElement, data.markerName);
    }
  };
}

function removeHighlight(highlightDescriptor: HighlightDescriptor | HighlightDescriptorCreatorFunction) {
  return (evt: EventInfo, data: DowncastMarkerEvent, conversionApi: DowncastConversionApi): void => {
    if (data.markerRange.isCollapsed) return;
    const descriptor = prepareDescriptor(highlightDescriptor, data, conversionApi);
    if (!descriptor) return;
    const elements = conversionApi.mapper.markerNameToElements(data.markerName);
    if (!elements) return;
    for (const element of elements) {
      conversionApi.mapper.unbindElementFromMarkerName(element, data.markerName);
      if ((element as any).is('attributeElement')) {
        conversionApi.writer.unwrap(conversionApi.writer.createRangeOn(element), createViewElementFromHighlightDescriptor(conversionApi.writer, descriptor));
      } else {
        (element.getCustomProperty('removeHighlight') as any)(element, descriptor.id, conversionApi.writer);
      }
    }
    conversionApi.writer.clearClonedElementsGroup(data.markerName);
    evt.stop();
  };
}

function prepareDescriptor(highlightDescriptor: HighlightDescriptor | HighlightDescriptorCreatorFunction, data: DowncastMarkerEvent, conversionApi: DowncastConversionApi): HighlightDescriptor | null {
  const descriptor = typeof highlightDescriptor === 'function' ? highlightDescriptor(data, conversionApi) : highlightDescriptor;
  if (!descriptor) return null;
  if (!descriptor.priority) descriptor.priority = 10;
  if (!descriptor.id) descriptor.id = data.markerName;
  return descriptor;
}

export function createViewElementFromHighlightDescriptor(writer: DowncastWriter, descriptor: HighlightDescriptor): ViewAttributeElement {
  const viewElement = writer.createAttributeElement('span', descriptor.attributes, { id: descriptor.id, priority: descriptor.priority });
  if (descriptor.classes) {
    writer.addClass(descriptor.classes, viewElement);
  }
  return viewElement;
}

function normalizeModelElementConfig(model: ElementToElementConfig['model']): { name: string; attributes: string[]; children: boolean } {
  if (typeof model === 'string') {
    return { name: model, attributes: [], children: false };
  }
  return { name: model.name, attributes: model.attributes ? toArray(model.attributes) : [], children: !!model.children };
}

function normalizeToElementConfig(view: string | ElementDefinition | ElementCreatorFunction | AttributeElementCreatorFunction, viewElementType: 'container' | 'attribute'): ElementCreatorFunction {
  if (typeof view === 'function') {
    return view as ElementCreatorFunction;
  }
  return (modelData, conversionApi) => createViewElementFromDefinition(view, conversionApi, viewElementType);
}

function normalizeToAttributeConfig(view: string | { key: string; value?: unknown; name?: string } | AttributeCreatorFunction): AttributeCreatorFunction {
  if (typeof view === 'string') {
    return modelAttributeValue => ({ key: view, value: modelAttributeValue });
  }
  if (typeof view === 'object') {
    if (view.value === undefined) {
      return modelAttributeValue => ({ key: view.key, value: modelAttributeValue });
    }
    if (typeof view.value === 'function') {
      return (modelAttributeValue, conversionApi, data) => ({ key: view.key, value: (view.value as any)(modelAttributeValue, conversionApi, data) });
    }
    return () => ({ key: view.key, value: view.value });
  }
  return view;
}

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
