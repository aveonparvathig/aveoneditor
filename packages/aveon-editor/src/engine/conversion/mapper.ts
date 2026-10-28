import { Emitter } from '../../utils/emitter';
import { Position as ModelPosition } from '../model/position';
import { Range as ModelRange } from '../model/range';
import type { Element as ModelElement } from '../model/element';
import type { DocumentFragment as ModelDocumentFragment } from '../model/documentfragment';
import { Position as ViewPosition } from '../view/position';
import { Range as ViewRange } from '../view/range';
import type { Element as ViewElement } from '../view/element';
import type { DocumentFragment as ViewDocumentFragment } from '../view/documentfragment';
import type { Node as ViewNode } from '../view/node';
import { Text as ViewText } from '../view/text';

export interface MapperModelToViewPositionEvent {
  modelPosition: ModelPosition;
  viewPosition?: ViewPosition;
  mapper: Mapper;
  isPhantom?: boolean;
}

export interface MapperViewToModelPositionEvent {
  viewPosition: ViewPosition;
  modelPosition?: ModelPosition;
  mapper: Mapper;
}

/**
 * Maps model elements/positions to view elements/positions and back.
 * Positions are mapped through events so features can customise the mapping.
 */
export class Mapper extends Emitter {
  private _modelToViewMapping = new WeakMap<ModelElement | ModelDocumentFragment, ViewElement | ViewDocumentFragment>();
  private _viewToModelMapping = new WeakMap<ViewElement | ViewDocumentFragment, ModelElement | ModelDocumentFragment>();
  private _viewToModelLengthCallbacks = new Map<string, (element: ViewElement) => number>();
  private _markerNameToElements = new Map<string, Set<ViewElement>>();
  private _elementToMarkerNames = new Map<ViewElement, Set<string>>();
  private _deferredBindingRemovals = new Map<ViewElement, ViewElement | ViewDocumentFragment>();
  private _unboundMarkerNames = new Set<string>();

  constructor() {
    super();
    this.on('modelToViewPosition', (evt, data: MapperModelToViewPositionEvent) => {
      if (data.viewPosition) return;
      const viewContainer = this._modelToViewMapping.get(data.modelPosition.parent as ModelElement);
      if (!viewContainer) {
        throw new Error('mapper-model-position-view-parent-not-found: Cannot find a view parent for a model position.');
      }
      data.viewPosition = this.findPositionIn(viewContainer, data.modelPosition.offset);
    }, { priority: 'low' });

    this.on('viewToModelPosition', (evt, data: MapperViewToModelPositionEvent) => {
      if (data.modelPosition) return;
      const viewBlock = this.findMappedViewAncestor(data.viewPosition);
      const modelParent = this._viewToModelMapping.get(viewBlock)!;
      const modelOffset = this._toModelOffset(data.viewPosition.parent as ViewElement, data.viewPosition.offset, viewBlock);
      data.modelPosition = ModelPosition._createAt(modelParent, modelOffset);
    }, { priority: 'low' });
  }

  public bindElements(modelElement: ModelElement | ModelDocumentFragment, viewElement: ViewElement | ViewDocumentFragment): void {
    this._modelToViewMapping.set(modelElement, viewElement);
    this._viewToModelMapping.set(viewElement, modelElement);
  }

  public unbindViewElement(viewElement: ViewElement, options: { defer?: boolean } = {}): void {
    const modelElement = this.toModelElement(viewElement);
    if (this._elementToMarkerNames.has(viewElement)) {
      for (const markerName of this._elementToMarkerNames.get(viewElement)!) {
        this.unbindElementFromMarkerName(viewElement, markerName);
      }
    }
    if (options.defer) {
      this._deferredBindingRemovals.set(viewElement, viewElement.root as ViewElement);
    } else {
      this._viewToModelMapping.delete(viewElement);
      if (modelElement && this._modelToViewMapping.get(modelElement) === viewElement) {
        this._modelToViewMapping.delete(modelElement);
      }
    }
  }

  /** Unbinds the view element and all mapped descendants. */
  public unbindViewTree(viewElement: ViewElement): void {
    this.unbindViewElement(viewElement);
    for (const child of viewElement.getChildren()) {
      if ((child as ViewElement).is && (child as ViewElement).is('element')) {
        this.unbindViewTree(child as ViewElement);
      }
    }
  }

  public unbindModelElement(modelElement: ModelElement): void {
    const viewElement = this.toViewElement(modelElement);
    this._modelToViewMapping.delete(modelElement);
    if (viewElement && this._viewToModelMapping.get(viewElement) === modelElement) {
      this._viewToModelMapping.delete(viewElement);
    }
  }

  public bindElementToMarker(element: ViewElement, name: string): void {
    const elements = this._markerNameToElements.get(name) || new Set();
    elements.add(element);
    const names = this._elementToMarkerNames.get(element) || new Set();
    names.add(name);
    this._markerNameToElements.set(name, elements);
    this._elementToMarkerNames.set(element, names);
  }

  public unbindElementFromMarkerName(element: ViewElement, name: string): void {
    const nameToElements = this._markerNameToElements.get(name);
    if (nameToElements) {
      nameToElements.delete(element);
      if (nameToElements.size === 0) this._markerNameToElements.delete(name);
    }
    const elementToNames = this._elementToMarkerNames.get(element);
    if (elementToNames) {
      elementToNames.delete(name);
      if (elementToNames.size === 0) this._elementToMarkerNames.delete(element);
    }
    this._unboundMarkerNames.add(name);
  }

  public flushUnboundMarkerNames(): string[] {
    const markerNames = Array.from(this._unboundMarkerNames);
    this._unboundMarkerNames.clear();
    return markerNames;
  }

  public flushDeferredBindings(): void {
    for (const [viewElement, root] of this._deferredBindingRemovals) {
      if (viewElement.root === root) {
        this.unbindViewElement(viewElement);
      }
    }
    this._deferredBindingRemovals = new Map();
  }

  public clearBindings(): void {
    this._modelToViewMapping = new WeakMap();
    this._viewToModelMapping = new WeakMap();
    this._markerNameToElements = new Map();
    this._elementToMarkerNames = new Map();
    this._unboundMarkerNames = new Set();
    this._deferredBindingRemovals = new Map();
  }

  public toModelElement(viewElement: ViewElement | ViewDocumentFragment): ModelElement | ModelDocumentFragment | undefined {
    return this._viewToModelMapping.get(viewElement);
  }

  public toViewElement(modelElement: ModelElement | ModelDocumentFragment): ViewElement | ViewDocumentFragment | undefined {
    return this._modelToViewMapping.get(modelElement);
  }

  public toModelRange(viewRange: ViewRange): ModelRange {
    return new ModelRange(this.toModelPosition(viewRange.start), this.toModelPosition(viewRange.end));
  }

  public toViewRange(modelRange: ModelRange): ViewRange {
    return new ViewRange(this.toViewPosition(modelRange.start), this.toViewPosition(modelRange.end));
  }

  public toModelPosition(viewPosition: ViewPosition): ModelPosition {
    const data: MapperViewToModelPositionEvent = { viewPosition, mapper: this };
    this.fire('viewToModelPosition', data);
    return data.modelPosition!;
  }

  public toViewPosition(modelPosition: ModelPosition, options: { isPhantom?: boolean } = {}): ViewPosition {
    const data: MapperModelToViewPositionEvent = { modelPosition, mapper: this, isPhantom: options.isPhantom };
    this.fire('modelToViewPosition', data);
    return data.viewPosition!;
  }

  public markerNameToElements(name: string): Set<ViewElement> | null {
    const boundElements = this._markerNameToElements.get(name);
    if (!boundElements) return null;
    const elements = new Set<ViewElement>();
    for (const element of boundElements) {
      if ((element as any).is('attributeElement')) {
        for (const clone of (element as any).getElementsWithSameId ? safeClones(element) : [element]) elements.add(clone);
      } else {
        elements.add(element);
      }
    }
    return elements;
  }

  public registerViewToModelLength(viewElementName: string, lengthCallback: (element: ViewElement) => number): void {
    this._viewToModelLengthCallbacks.set(viewElementName, lengthCallback);
  }

  public findMappedViewAncestor(viewPosition: ViewPosition): ViewElement {
    let parent: any = viewPosition.parent;
    while (!this._viewToModelMapping.has(parent)) {
      parent = parent.parent;
      if (!parent) throw new Error('mapper-view-position-mapped-ancestor-not-found');
    }
    return parent;
  }

  public getModelLength(viewNode: ViewNode | ViewDocumentFragment): number {
    const name = (viewNode as ViewElement).name;
    if (name && this._viewToModelLengthCallbacks.get(name)) {
      return this._viewToModelLengthCallbacks.get(name)!(viewNode as ViewElement);
    }
    if (this._viewToModelMapping.has(viewNode as ViewElement)) {
      return 1;
    }
    if (viewNode instanceof ViewText) {
      return viewNode.data.length;
    }
    if ((viewNode as any).is && (viewNode as any).is('uiElement')) {
      return 0;
    }
    let len = 0;
    for (const child of (viewNode as ViewElement).getChildren()) {
      len += this.getModelLength(child);
    }
    return len;
  }

  public findPositionIn(viewParent: ViewNode | ViewDocumentFragment, expectedOffset: number): ViewPosition {
    if (viewParent instanceof ViewText) {
      return new ViewPosition(viewParent, expectedOffset);
    }
    let modelOffset = 0;
    let viewOffset = 0;
    let lastLength = 0;
    let viewNode: ViewNode | null = null;
    const parent = viewParent as ViewElement;
    while (modelOffset < expectedOffset) {
      viewNode = parent.getChild(viewOffset);
      if (!viewNode) break;
      lastLength = this.getModelLength(viewNode);
      modelOffset += lastLength;
      viewOffset++;
    }
    if (modelOffset === expectedOffset || !viewNode) {
      return this._moveViewPositionToTextNode(new ViewPosition(viewParent, viewOffset));
    }
    return this.findPositionIn(viewNode, expectedOffset - (modelOffset - lastLength));
  }

  private _toModelOffset(viewParent: ViewElement | ViewText, viewOffset: number, viewBlock: ViewElement): number {
    if (viewBlock !== viewParent) {
      const offsetToParentStart = this._toModelOffset(viewParent.parent as ViewElement, viewParent.index!, viewBlock);
      const offsetInParent = this._toModelOffset(viewParent, viewOffset, viewParent as ViewElement);
      return offsetToParentStart + offsetInParent;
    }
    if (viewParent instanceof ViewText) {
      return viewOffset;
    }
    let modelOffset = 0;
    for (let i = 0; i < viewOffset; i++) {
      modelOffset += this.getModelLength(viewParent.getChild(i)!);
    }
    return modelOffset;
  }

  private _moveViewPositionToTextNode(viewPosition: ViewPosition): ViewPosition {
    const nodeBefore = viewPosition.nodeBefore;
    const nodeAfter = viewPosition.nodeAfter;
    if (nodeBefore instanceof ViewText) {
      return new ViewPosition(nodeBefore, nodeBefore.data.length);
    } else if (nodeAfter instanceof ViewText) {
      return new ViewPosition(nodeAfter, 0);
    }
    return viewPosition;
  }
}

function safeClones(element: any): Iterable<ViewElement> {
  try {
    return element.id !== null ? element.getElementsWithSameId() : [element];
  } catch {
    return [element];
  }
}
