import { Emitter } from '../../utils/emitter';
import { ModelConsumable } from './modelconsumable';
import { Range as ModelRange } from '../model/range';
import type { Position as ModelPosition } from '../model/position';
import type { Item as ModelItem } from '../model/item';
import type { Element as ModelElement } from '../model/element';
import type { Selection as ModelSelection } from '../model/selection';
import type { DocumentSelection as ModelDocumentSelection } from '../model/documentselection';
import type { MarkerCollection } from '../model/markercollection';
import type { Schema } from '../model/schema';
import type { Mapper } from './mapper';
import type { DowncastWriter } from '../view/downcastwriter';
import type { Element as ViewElement } from '../view/element';
import type { Node as ViewNode } from '../view/node';
import { ContainerElement as ViewContainerElement } from '../view/containerelement';
import type { TreeWalkerValue } from '../model/treewalker';

export interface DowncastConversionApi {
  dispatcher: DowncastDispatcher;
  consumable: ModelConsumable;
  mapper: Mapper;
  schema: Schema;
  writer: DowncastWriter;
  options: Record<string, unknown>;
  convertItem(item: ModelItem): void;
  convertChildren(element: ModelElement): void;
  convertAttributes(item: ModelItem): void;
  canReuseView(viewElement: ViewElement): boolean;
}

export interface DowncastInsertEvent {
  item: ModelItem;
  range: ModelRange;
  reconversion?: boolean;
}

export interface DowncastAttributeEvent {
  item: ModelItem | ModelSelection | ModelDocumentSelection;
  range: ModelRange;
  attributeKey: string;
  attributeOldValue: unknown;
  attributeNewValue: unknown;
}

export interface DowncastMarkerEvent {
  markerName: string;
  markerRange: ModelRange;
  item?: ModelItem | ModelSelection | ModelDocumentSelection;
  range?: ModelRange;
}

/**
 * Fires conversion events (`insert:paragraph`, `attribute:bold:$text`, `addMarker:comment`,
 * `selection`) for model changes so converters can build the view.
 */
export class DowncastDispatcher extends Emitter {
  private _conversionApi: Pick<DowncastConversionApi, 'dispatcher' | 'mapper' | 'schema'>;
  private _firedEventsMap = new WeakMap<DowncastConversionApi, Map<unknown, Set<string>>>();

  constructor(conversionApi: { mapper: Mapper; schema: Schema }) {
    super();
    this._conversionApi = { dispatcher: this, ...conversionApi };
  }

  /** Converts an inserted range of the document (plus markers intersecting it). */
  public convertInsert(range: ModelRange, writer: DowncastWriter, markers?: MarkerCollection | Map<string, ModelRange>, options: Record<string, unknown> = {}): void {
    const conversionApi = this._createConversionApi(writer, options);
    this._convertInsert(range, conversionApi);
    if (markers) {
      for (const [name, markerRange] of iterateMarkers(markers)) {
        const intersection = markerRange.getIntersection(range);
        if (intersection) {
          this._convertMarkerAdd(name, intersection, conversionApi);
        }
      }
    }
  }

  /** Converts a detached range (data pipeline). */
  public convert(range: ModelRange, markers: Map<string, ModelRange>, writer: DowncastWriter, options: Record<string, unknown> = {}): void {
    const conversionApi = this._createConversionApi(writer, options);
    this._convertInsert(range, conversionApi);
    for (const [name, markerRange] of markers) {
      this._convertMarkerAdd(name, markerRange, conversionApi);
    }
  }

  public convertRemove(position: ModelPosition, length: number, name: string, writer: DowncastWriter): void {
    const conversionApi = this._createConversionApi(writer);
    this.fire(`remove:${name}`, { position, length }, conversionApi);
  }

  public convertRootAttribute(root: ModelElement, key: string, oldValue: unknown, newValue: unknown, writer: DowncastWriter): void {
    const conversionApi = this._createConversionApi(writer);
    const data: DowncastAttributeEvent = { item: root, range: ModelRange._createIn(root), attributeKey: key, attributeOldValue: oldValue, attributeNewValue: newValue };
    conversionApi.consumable.add(root, `attribute:${key}`);
    this.fire(`attribute:${key}:${root.name}`, data, conversionApi);
  }

  public convertMarkerRemove(markerName: string, markerRange: ModelRange, writer: DowncastWriter): void {
    const conversionApi = this._createConversionApi(writer);
    this._convertMarkerRemove(markerName, markerRange, conversionApi);
  }

  public convertSelection(selection: ModelSelection | ModelDocumentSelection, markers: MarkerCollection, writer: DowncastWriter): void {
    const conversionApi = this._createConversionApi(writer);
    const markersAtSelection = Array.from(markers.getMarkersAtPosition(selection.getFirstPosition()!));
    conversionApi.consumable.add(selection as any, 'selection');
    for (const marker of markersAtSelection) {
      const markerRange = marker.getRange();
      if (!shouldMarkerChangeBeConverted(selection.getFirstPosition()!, marker, conversionApi.mapper)) continue;
      conversionApi.consumable.add(selection as any, 'addMarker:' + marker.name);
      void markerRange;
    }
    for (const key of selection.getAttributeKeys()) {
      conversionApi.consumable.add(selection as any, 'attribute:' + key);
    }

    this.fire('selection', { selection }, conversionApi);

    if (!selection.isCollapsed) return;

    for (const marker of markersAtSelection) {
      const markerRange = marker.getRange();
      if (!shouldMarkerChangeBeConverted(selection.getFirstPosition()!, marker, conversionApi.mapper)) continue;
      const data = { item: selection, markerName: marker.name, markerRange };
      if (conversionApi.consumable.test(selection as any, 'addMarker:' + marker.name)) {
        this.fire(`addMarker:${marker.name}`, data, conversionApi);
      }
    }
  }

  private _convertInsert(range: ModelRange, conversionApi: DowncastConversionApi, options: { doNotAddConsumables?: boolean } = {}): void {
    if (!options.doNotAddConsumables) {
      this._addConsumablesForInsert(conversionApi.consumable, Array.from(range));
    }
    for (const data of Array.from(range.getWalker({ shallow: true })).map(walkerValueToEventData)) {
      this._testAndFire('insert', data, conversionApi);
    }
  }

  private _convertMarkerAdd(markerName: string, markerRange: ModelRange, conversionApi: DowncastConversionApi): void {
    if ((markerRange.root as any).rootName === '$graveyard') return;
    const eventName = `addMarker:${markerName}`;
    conversionApi.consumable.add(markerRange, eventName);
    this.fire(eventName, { markerName, markerRange }, conversionApi);
    if (!conversionApi.consumable.test(markerRange, eventName)) return;
    for (const item of markerRange.getItems()) {
      conversionApi.consumable.add(item, eventName);
      if (!conversionApi.consumable.test(item, eventName)) continue;
      const data = { item, range: ModelRange._createOn(item), markerName, markerRange };
      this.fire(eventName, data, conversionApi);
    }
  }

  private _convertMarkerRemove(markerName: string, markerRange: ModelRange, conversionApi: DowncastConversionApi): void {
    if ((markerRange.root as any).rootName === '$graveyard') return;
    this.fire(`removeMarker:${markerName}`, { markerName, markerRange }, conversionApi);
  }

  private _addConsumablesForInsert(consumable: ModelConsumable, walkerValues: Iterable<TreeWalkerValue>): ModelConsumable {
    for (const value of walkerValues) {
      const item = value.item;
      if (consumable.test(item, 'insert') === null) {
        consumable.add(item, 'insert');
        for (const key of item.getAttributeKeys()) {
          consumable.add(item, 'attribute:' + key);
        }
      }
    }
    return consumable;
  }

  private _testAndFire(type: string, data: DowncastInsertEvent | DowncastAttributeEvent, conversionApi: DowncastConversionApi): void {
    const eventName = getEventName(type, data as any);
    const itemKey = (data.item as any).is('$textProxy') ? (data.item as any).textNode : data.item;
    const eventsFiredForConversion = this._firedEventsMap.get(conversionApi)!;
    const eventsFiredForItem = eventsFiredForConversion.get(itemKey);
    if (!eventsFiredForItem) {
      eventsFiredForConversion.set(itemKey, new Set([eventName]));
    } else if (!eventsFiredForItem.has(eventName)) {
      eventsFiredForItem.add(eventName);
    } else {
      return;
    }
    this.fire(eventName, data, conversionApi);
  }

  private _testAndFireAddAttributes(item: ModelItem, conversionApi: DowncastConversionApi): void {
    const data: DowncastAttributeEvent = { item, range: ModelRange._createOn(item), attributeKey: '', attributeOldValue: null, attributeNewValue: null };
    for (const key of data.item.getAttributeKeys()) {
      data.attributeKey = key;
      data.attributeOldValue = null;
      data.attributeNewValue = data.item.getAttribute(key);
      this._testAndFire(`attribute:${key}`, { ...data }, conversionApi);
    }
  }

  private _createConversionApi(writer: DowncastWriter, options: Record<string, unknown> = {}): DowncastConversionApi {
    const conversionApi: DowncastConversionApi = {
      ...this._conversionApi,
      consumable: new ModelConsumable(),
      writer,
      options,
      convertItem: item => this._convertInsert(ModelRange._createOn(item), conversionApi),
      convertChildren: element => this._convertInsert(ModelRange._createIn(element), conversionApi, { doNotAddConsumables: true }),
      convertAttributes: item => this._testAndFireAddAttributes(item, conversionApi),
      canReuseView: () => false
    } as DowncastConversionApi;
    this._firedEventsMap.set(conversionApi, new Map());
    return conversionApi;
  }
}

function* iterateMarkers(markers: MarkerCollection | Map<string, ModelRange>): IterableIterator<[string, ModelRange]> {
  if (markers instanceof Map) {
    yield* markers;
    return;
  }
  for (const marker of markers) {
    yield [marker.name, marker.getRange()];
  }
}

function shouldMarkerChangeBeConverted(modelPosition: ModelPosition, marker: any, mapper: Mapper): boolean {
  const range = marker.getRange();
  const ancestors = Array.from(modelPosition.getAncestors());
  ancestors.shift();
  ancestors.reverse();
  const hasCustomHandling = ancestors.some(element => {
    if (range.containsItem(element)) {
      const viewElement = mapper.toViewElement(element as ModelElement);
      return !!(viewElement && (viewElement as ViewElement).getCustomProperty('addHighlight'));
    }
    return false;
  });
  return !hasCustomHandling;
}

function getEventName(type: string, data: { item: ModelItem }): string {
  const name = (data.item as any).is('element') ? (data.item as ModelElement).name : '$text';
  return `${type}:${name}`;
}

function walkerValueToEventData(value: TreeWalkerValue): DowncastInsertEvent {
  const item = value.item;
  const itemRange = ModelRange._createFromPositionAndShift(value.previousPosition, value.length!);
  return { item, range: itemRange };
}

export type { ViewNode, ViewContainerElement };
