import { Emitter } from '../../utils/emitter';
import { ViewConsumable } from './viewconsumable';
import { Range as ModelRange } from '../model/range';
import { Position as ModelPosition } from '../model/position';
import { SchemaContext, type Schema, type SchemaContextDefinition } from '../model/schema';
import type { Writer as ModelWriter } from '../model/writer';
import type { Element as ModelElement } from '../model/element';
import type { DocumentFragment as ModelDocumentFragment } from '../model/documentfragment';
import type { Node as ModelNode } from '../model/node';
import type { Element as ViewElement } from '../view/element';
import type { DocumentFragment as ViewDocumentFragment } from '../view/documentfragment';
import type { Node as ViewNode } from '../view/node';
import type { Item as ViewItem } from '../view/item';
import { isParagraphable, wrapInParagraph } from '../model/utils/autoparagraphing';

export interface UpcastConversionData {
  viewItem: ViewItem | ViewDocumentFragment;
  modelCursor: ModelPosition;
  modelRange: ModelRange | null;
}

export interface UpcastConversionApi {
  dispatcher: UpcastDispatcher;
  consumable: ViewConsumable;
  schema: Schema;
  writer: ModelWriter;
  store: Record<string, unknown>;
  convertItem(viewItem: ViewItem | ViewDocumentFragment, modelCursor: ModelPosition): { modelRange: ModelRange | null; modelCursor: ModelPosition };
  convertChildren(viewItem: ViewElement | ViewDocumentFragment, positionOrElement: ModelPosition | ModelElement): { modelRange: ModelRange; modelCursor: ModelPosition };
  safeInsert(modelNode: ModelNode, position: ModelPosition): boolean;
  updateConversionResult(modelElement: ModelElement, data: UpcastConversionData): void;
  splitToAllowedParent(modelNode: ModelNode, modelCursor: ModelPosition): { position: ModelPosition; cursorParent?: ModelElement | ModelDocumentFragment } | null;
  getSplitParts(modelElement: ModelElement): ModelElement[];
  keepEmptyElement(modelElement: ModelElement): void;
}

/**
 * Fires conversion events (`element:p`, `text`, `documentFragment`) for view items so
 * converters can build the model.
 */
export class UpcastDispatcher extends Emitter {
  public readonly conversionApi: UpcastConversionApi;
  private _splitParts = new Map<ModelElement, ModelElement[]>();
  private _cursorParents = new Map<ModelNode, ModelElement | ModelDocumentFragment>();
  private _modelCursor: ModelPosition | null = null;
  private _emptyElementsToKeep = new Set<ModelElement>();

  constructor(conversionApi: { schema: Schema }) {
    super();
    this.conversionApi = {
      ...conversionApi,
      dispatcher: this,
      convertItem: (viewItem: ViewItem | ViewDocumentFragment, modelCursor: ModelPosition) => this._convertItem(viewItem, modelCursor),
      convertChildren: (viewItem: ViewElement | ViewDocumentFragment, positionOrElement: ModelPosition | ModelElement) => this._convertChildren(viewItem, positionOrElement),
      safeInsert: (modelNode: ModelNode, position: ModelPosition) => this._safeInsert(modelNode, position),
      updateConversionResult: (modelElement: ModelElement, data: UpcastConversionData) => this._updateConversionResult(modelElement, data),
      splitToAllowedParent: (modelNode: ModelNode, modelCursor: ModelPosition) => this._splitToAllowedParent(modelNode, modelCursor),
      getSplitParts: (modelElement: ModelElement) => this._getSplitParts(modelElement),
      keepEmptyElement: (modelElement: ModelElement) => this._keepEmptyElement(modelElement)
    } as unknown as UpcastConversionApi;
  }

  public convert(viewItem: ViewItem | ViewDocumentFragment, writer: ModelWriter, context: SchemaContextDefinition = ['$root']): ModelDocumentFragment {
    this.fire('viewCleanup', viewItem);
    this._modelCursor = createContextTree(context, writer);
    this.conversionApi.writer = writer;
    this.conversionApi.consumable = ViewConsumable.createFrom(viewItem as ViewNode);
    this.conversionApi.store = {};

    const { modelRange } = this._convertItem(viewItem, this._modelCursor);
    const documentFragment = writer.createDocumentFragment();

    if (modelRange) {
      this._removeEmptyElements();
      for (const item of Array.from((this._modelCursor.parent as ModelElement).getChildren())) {
        writer.append(item, documentFragment);
      }
      (documentFragment as any).markers = extractMarkersFromModelFragment(documentFragment, writer);
    }

    this._modelCursor = null;
    this._splitParts.clear();
    this._cursorParents.clear();
    this._emptyElementsToKeep.clear();
    (this.conversionApi as any).writer = null;
    (this.conversionApi as any).store = null;
    return documentFragment;
  }

  private _convertItem(viewItem: ViewItem | ViewDocumentFragment, modelCursor: ModelPosition): { modelRange: ModelRange | null; modelCursor: ModelPosition } {
    const data: UpcastConversionData = { viewItem, modelCursor, modelRange: null };
    if ((viewItem as any).is('element')) {
      this.fire(`element:${(viewItem as ViewElement).name}`, data, this.conversionApi);
    } else if ((viewItem as any).is('$text')) {
      this.fire('text', data, this.conversionApi);
    } else {
      this.fire('documentFragment', data, this.conversionApi);
    }
    if (data.modelRange && !(data.modelRange instanceof ModelRange)) {
      throw new Error('view-conversion-dispatcher-incorrect-result');
    }
    return { modelRange: data.modelRange, modelCursor: data.modelCursor };
  }

  private _convertChildren(viewItem: ViewElement | ViewDocumentFragment, elementOrModelCursor: ModelPosition | ModelElement): { modelRange: ModelRange; modelCursor: ModelPosition } {
    let nextModelCursor = elementOrModelCursor instanceof ModelPosition ? elementOrModelCursor : ModelPosition._createAt(elementOrModelCursor, 0);
    const modelRange = new ModelRange(nextModelCursor);
    for (const viewChild of Array.from(viewItem.getChildren())) {
      const result = this._convertItem(viewChild, nextModelCursor);
      if (result.modelRange instanceof ModelRange) {
        (modelRange as any).end = result.modelRange.end;
        nextModelCursor = result.modelCursor;
      }
    }
    return { modelRange, modelCursor: nextModelCursor };
  }

  private _safeInsert(modelNode: ModelNode, position: ModelPosition): boolean {
    const splitResult = this._splitToAllowedParent(modelNode, position);
    if (!splitResult) return false;
    this.conversionApi.writer.insert(modelNode, splitResult.position);
    return true;
  }

  private _updateConversionResult(modelElement: ModelElement, data: UpcastConversionData): void {
    const parts = this._getSplitParts(modelElement);
    const writer = this.conversionApi.writer;
    if (!data.modelRange) {
      data.modelRange = writer.createRange(writer.createPositionBefore(modelElement), writer.createPositionAfter(parts[parts.length - 1]));
    }
    const savedCursorParent = this._cursorParents.get(modelElement);
    data.modelCursor = savedCursorParent ? writer.createPositionAt(savedCursorParent, 0) : data.modelRange.end;
  }

  private _splitToAllowedParent(node: ModelNode, modelCursor: ModelPosition): { position: ModelPosition; cursorParent?: ModelElement | ModelDocumentFragment } | null {
    const { schema, writer } = this.conversionApi;
    let allowedParent = schema.findAllowedParent(modelCursor, node);
    if (allowedParent) {
      if (allowedParent === modelCursor.parent) {
        return { position: modelCursor };
      }
      if ((this._modelCursor!.parent as ModelElement).getAncestors().includes(allowedParent)) {
        allowedParent = null;
      }
    }
    if (!allowedParent) {
      if (!isParagraphable(modelCursor, node, schema)) return null;
      return { position: wrapInParagraph(modelCursor, writer) };
    }
    const splitResult = writer.split(modelCursor, allowedParent);
    const stack: ModelElement[] = [];
    for (const treeWalkerValue of splitResult.range.getWalker()) {
      if (treeWalkerValue.type === 'elementEnd') {
        stack.push(treeWalkerValue.item as ModelElement);
      } else {
        const previousPart = stack.pop()!;
        const element = treeWalkerValue.item as ModelElement;
        this._registerSplitPair(previousPart, element);
      }
    }
    const cursorParent = splitResult.range.end.parent;
    this._cursorParents.set(node, cursorParent);
    return { position: splitResult.position, cursorParent };
  }

  private _registerSplitPair(originalPart: ModelElement, splitPart: ModelElement): void {
    if (!this._splitParts.has(originalPart)) {
      this._splitParts.set(originalPart, [originalPart]);
    }
    const list = this._splitParts.get(originalPart)!;
    this._splitParts.set(splitPart, list);
    list.push(splitPart);
  }

  private _getSplitParts(element: ModelElement): ModelElement[] {
    const parts = this._splitParts.get(element);
    return parts ? parts : [element];
  }

  private _keepEmptyElement(element: ModelElement): void {
    this._emptyElementsToKeep.add(element);
  }

  private _removeEmptyElements(): void {
    let anyRemoved = false;
    for (const [element] of this._splitParts) {
      if (element.isEmpty && !this._emptyElementsToKeep.has(element)) {
        this.conversionApi.writer.remove(element);
        this._splitParts.delete(element);
        anyRemoved = true;
      }
    }
    if (anyRemoved) this._removeEmptyElements();
  }
}

function createContextTree(contextDefinition: SchemaContextDefinition, writer: ModelWriter): ModelPosition {
  let position: ModelPosition | undefined;
  for (const item of new SchemaContext(contextDefinition)) {
    const attributes: Record<string, unknown> = {};
    for (const key of item.getAttributeKeys()) {
      attributes[key] = item.getAttribute(key);
    }
    const current = writer.createElement(item.name, attributes);
    if (position) {
      writer.insert(current, position);
    }
    position = ModelPosition._createAt(current, 0);
  }
  return position!;
}

function extractMarkersFromModelFragment(modelItem: ModelDocumentFragment, writer: ModelWriter): Map<string, ModelRange> {
  const markerElements = new Set<ModelElement>();
  const markers = new Map<string, ModelRange>();
  const range = ModelRange._createIn(modelItem).getItems();
  for (const item of range) {
    if ((item as any).is('element', '$marker')) {
      markerElements.add(item as ModelElement);
    }
  }
  for (const markerElement of markerElements) {
    const markerName = markerElement.getAttribute('data-name') as string;
    const currentPosition = writer.createPositionBefore(markerElement);
    if (markers.has(markerName)) {
      (markers.get(markerName) as any).end = currentPosition.clone();
    } else {
      markers.set(markerName, new ModelRange(currentPosition.clone()));
    }
    writer.remove(markerElement);
  }
  return markers;
}
