import { Emitter } from '../../utils/emitter';
import { Selection, type Selectable } from './selection';
import { LiveRange } from './liverange';
import { Range } from './range';
import { Position, type PositionOffset } from './position';
import { Text } from './text';
import { TextProxy } from './textproxy';
import { Element } from './element';
import type { Node } from './node';
import type { Document } from './document';
import type { Model } from './model';
import type { Marker } from './markercollection';
import type { Batch } from './batch';
import type { Item } from './item';

const storePrefix = 'selection:';

/**
 * The document selection: a live selection bound to the model document. Read-only
 * from outside; modify it through the writer (`writer.setSelection()`).
 */
export class DocumentSelection extends Emitter {
  private _selection: LiveSelection;

  constructor(doc: Document) {
    super();
    this._selection = new LiveSelection(doc);
    this._selection.delegate('change:range').to(this);
    this._selection.delegate('change:attribute').to(this);
    this._selection.delegate('change:marker').to(this);
  }

  public get isCollapsed(): boolean {
    return this._selection.isCollapsed;
  }

  public get anchor(): Position | null {
    return this._selection.anchor;
  }

  public get focus(): Position | null {
    return this._selection.focus;
  }

  public get rangeCount(): number {
    return this._selection.rangeCount;
  }

  public get hasOwnRange(): boolean {
    return this._selection.hasOwnRange;
  }

  public get isBackward(): boolean {
    return this._selection.isBackward;
  }

  public get isGravityOverridden(): boolean {
    return this._selection.isGravityOverridden;
  }

  public get markers(): Marker[] {
    return this._selection.markers;
  }

  public getRanges(): IterableIterator<Range> {
    return this._selection.getRanges();
  }

  public getFirstPosition(): Position | null {
    return this._selection.getFirstPosition();
  }

  public getLastPosition(): Position | null {
    return this._selection.getLastPosition();
  }

  public getFirstRange(): Range | null {
    return this._selection.getFirstRange();
  }

  public getLastRange(): Range | null {
    return this._selection.getLastRange();
  }

  public getSelectedBlocks(): IterableIterator<Element> {
    return this._selection.getSelectedBlocks();
  }

  public getSelectedElement(): Element | null {
    return this._selection.getSelectedElement();
  }

  public containsEntireContent(element?: Element): boolean {
    return this._selection.containsEntireContent(element);
  }

  public destroy(): void {
    this._selection.destroy();
  }

  public getAttributeKeys(): Iterable<string> {
    return this._selection.getAttributeKeys();
  }

  public getAttributes(): Iterable<[string, unknown]> {
    return this._selection.getAttributes();
  }

  public getAttribute(key: string): unknown {
    return this._selection.getAttribute(key);
  }

  public hasAttribute(key: string): boolean {
    return this._selection.hasAttribute(key);
  }

  public refresh(): void {
    this._selection.updateMarkers();
    this._selection._updateAttributes(false);
  }

  public observeMarkers(prefixOrName: string): void {
    this._selection.observeMarkers(prefixOrName);
  }

  public is(type: string): boolean {
    return type === 'selection' || type === 'model:selection' || type === 'documentSelection' || type === 'model:documentSelection';
  }

  /** @internal */
  public _setFocus(itemOrPosition: Position | Node | Element, offset?: PositionOffset): void {
    this._selection.setFocus(itemOrPosition, offset);
  }

  /** @internal */
  public _setTo(selectable: Selectable, placeOrOffset?: any, options?: { backward?: boolean }): void {
    this._selection.setTo(selectable, placeOrOffset, options);
  }

  /** @internal */
  public _setAttribute(key: string, value: unknown): void {
    this._selection.setAttribute(key, value);
  }

  /** @internal */
  public _removeAttribute(key: string): void {
    this._selection.removeAttribute(key);
  }

  /** @internal */
  public _getStoredAttributes(): Iterable<[string, unknown]> {
    return this._selection.getStoredAttributes();
  }

  /** @internal */
  public _overrideGravity(): string {
    return this._selection.overrideGravity();
  }

  /** @internal */
  public _restoreGravity(uid: string): void {
    this._selection.restoreGravity(uid);
  }

  public static _getStoreAttributeKey(key: string): string {
    return storePrefix + key;
  }

  public static _isStoreAttributeKey(key: string): boolean {
    return key.startsWith(storePrefix);
  }
}

/** Internal live selection with live ranges and attribute tracking. */
class LiveSelection extends Selection {
  public markers: Marker[] = [];
  private _model: Model;
  private _document: Document;
  private _attributePriority = new Map<string, 'low' | 'normal'>();
  private _selectionRestorePosition: Position | null = null;
  private _hasChangedRange = false;
  private _overriddenGravityRegister = new Set<string>();
  private _observedMarkers = new Map<string, string>();

  constructor(doc: Document) {
    super();
    this._model = doc.model;
    this._document = doc;

    this.listenTo(this._model, 'applyOperation', (evt, args: any[]) => {
      const operation = args[0];
      if (!operation.isDocumentOperation || operation.type === 'marker' || operation.type === 'rename' || operation.type === 'noop') return;
      // Ensure a range exists when a root gets content.
      if (this._ranges.length === 0 && this._selectionRestorePosition === null) {
        this._fixGraveyardSelection(operation);
      }
      this._hasChangedRange = true;
    }, { priority: 'lowest' });

    this.on('change:range', () => {
      this._validateSelectionRanges(this.getRanges());
    });

    this.listenTo(this._model.markers, 'update', (evt, marker: Marker, oldRange: Range | null, newRange: Range | null) => {
      this._updateMarker(marker, newRange);
    });

    this.listenTo(this._document, 'change', (evt, batch: Batch) => {
      clearAttributesStoredInElement(this._model, batch);
    });
  }

  public override get isCollapsed(): boolean {
    const length = this._ranges.length;
    return length === 0 ? this._document._getDefaultRange().isCollapsed : super.isCollapsed;
  }

  public override get anchor(): Position | null {
    return super.anchor || this._document._getDefaultRange().start;
  }

  public override get focus(): Position | null {
    return super.focus || this._document._getDefaultRange().end;
  }

  public override get rangeCount(): number {
    return this._ranges.length ? this._ranges.length : 1;
  }

  public get hasOwnRange(): boolean {
    return this._ranges.length > 0;
  }

  public get isGravityOverridden(): boolean {
    return !!this._overriddenGravityRegister.size;
  }

  public destroy(): void {
    for (const range of this._ranges) (range as LiveRange).detach();
    this.stopListening();
  }

  public override *getRanges(): IterableIterator<Range> {
    if (this._ranges.length) {
      yield* super.getRanges();
    } else {
      yield this._document._getDefaultRange();
    }
  }

  public override getFirstRange(): Range | null {
    return super.getFirstRange() || this._document._getDefaultRange();
  }

  public override getLastRange(): Range | null {
    return super.getLastRange() || this._document._getDefaultRange();
  }

  public override setTo(selectable: Selectable, optionsOrPlaceOrOffset?: any, options?: { backward?: boolean }): void {
    super.setTo(selectable, optionsOrPlaceOrOffset, options);
    this._updateAttributes(true);
    this.updateMarkers();
  }

  public override setFocus(itemOrPosition: Position | Node | Element, offset?: PositionOffset): void {
    super.setFocus(itemOrPosition, offset);
    this._updateAttributes(true);
    this.updateMarkers();
  }

  public override setAttribute(key: string, value: unknown): void {
    if (this._setAttribute(key, value)) {
      const attributeKeys = [key];
      this.fire('change:attribute', { attributeKeys, directChange: true });
    }
  }

  public override removeAttribute(key: string): void {
    if (this._removeAttribute(key)) {
      const attributeKeys = [key];
      this.fire('change:attribute', { attributeKeys, directChange: true });
    }
  }

  public overrideGravity(): string {
    const overrideUid = 'g' + Math.random().toString(36).slice(2, 10);
    this._overriddenGravityRegister.add(overrideUid);
    if (this._overriddenGravityRegister.size === 1) {
      this._updateAttributes(true);
    }
    return overrideUid;
  }

  public restoreGravity(uid: string): void {
    if (!this._overriddenGravityRegister.has(uid)) throw new Error('document-selection-gravity-wrong-restore');
    this._overriddenGravityRegister.delete(uid);
    if (!this.isGravityOverridden) {
      this._updateAttributes(true);
    }
  }

  public observeMarkers(prefixOrName: string): void {
    this._observedMarkers.set(prefixOrName, prefixOrName);
    this.updateMarkers();
  }

  public *getStoredAttributes(): IterableIterator<[string, unknown]> {
    const selectionParent = this.getFirstPosition()!.parent as Element;
    if (this.isCollapsed && selectionParent.isEmpty) {
      for (const key of selectionParent.getAttributeKeys()) {
        if (key.startsWith(storePrefix)) {
          const realKey = key.substr(storePrefix.length);
          yield [realKey, selectionParent.getAttribute(key)];
        }
      }
    }
  }

  public updateMarkers(): void {
    if (!this._observedMarkers.size) return;
    const markers: Marker[] = [];
    let changed = false;
    for (const marker of this._model.markers) {
      const markerGroup = marker.name.split(':', 1)[0];
      if (!this._observedMarkers.has(markerGroup) && !this._observedMarkers.has(marker.name)) continue;
      const markerRange = marker.getRange();
      for (const selectionRange of this.getRanges()) {
        if (markerRange.containsRange(selectionRange, !selectionRange.isCollapsed)) {
          markers.push(marker);
        }
      }
    }
    const oldMarkers = Array.from(this.markers);
    for (const marker of markers) {
      if (!this.markers.includes(marker)) {
        this.markers.push(marker);
        changed = true;
      }
    }
    for (const marker of oldMarkers) {
      if (!markers.includes(marker)) {
        this.markers.splice(this.markers.indexOf(marker), 1);
        changed = true;
      }
    }
    if (changed) {
      this.fire('change:marker', { oldMarkers, directChange: false });
    }
  }

  public _updateAttributes(clearAll: boolean): void {
    const newAttributes = new Map(this._getSurroundingAttributes());
    const oldAttributes = new Map(this.getAttributes());

    if (clearAll) {
      this._attributePriority = new Map();
      this._attrs = new Map();
    } else {
      for (const [key, priority] of this._attributePriority) {
        if (priority === 'low') {
          this._attrs.delete(key);
          this._attributePriority.delete(key);
        }
      }
    }

    this._setAttributesTo(newAttributes);

    const changed: string[] = [];
    for (const [newKey, newValue] of this.getAttributes()) {
      if (!oldAttributes.has(newKey) || oldAttributes.get(newKey) !== newValue) {
        changed.push(newKey);
      }
    }
    for (const [oldKey] of oldAttributes) {
      if (!this.hasAttribute(oldKey)) changed.push(oldKey);
    }
    if (changed.length > 0) {
      this.fire('change:attribute', { attributeKeys: changed, directChange: false });
    }
  }

  protected override _popRange(): void {
    (this._ranges.pop() as LiveRange).detach();
  }

  protected override _pushRange(range: Range): void {
    // A direct selection change supersedes any pending restore after a removal.
    this._selectionRestorePosition = null;
    const liveRange = this._prepareRange(range);
    if (liveRange) this._ranges.push(liveRange);
  }

  private _validateSelectionRanges(ranges: Iterable<Range>): void {
    for (const range of ranges) {
      if (!this._document._validateSelectionRange(range)) {
        throw new Error('document-selection-wrong-position');
      }
    }
  }

  private _prepareRange(range: Range): LiveRange | undefined {
    this._checkRange(range);
    if (range.root === this._document.graveyard) {
      return undefined;
    }
    const liveRange = LiveRange.fromRange(range);
    liveRange.on('change:range', (evt, oldRange, { deletionPosition }) => {
      this._hasChangedRange = true;
      if (liveRange.root === this._document.graveyard) {
        this._selectionRestorePosition = deletionPosition;
        const index = this._ranges.indexOf(liveRange);
        this._ranges.splice(index, 1);
        liveRange.detach();
      }
    });
    return liveRange;
  }

  private _updateMarker(marker: Marker, markerRange: Range | null): void {
    const markerGroup = marker.name.split(':', 1)[0];
    if (!this._observedMarkers.has(markerGroup) && !this._observedMarkers.has(marker.name)) return;
    let changed = false;
    const oldMarkers = Array.from(this.markers);
    const hasMarker = this.markers.includes(marker);
    if (!markerRange) {
      if (hasMarker) {
        this.markers.splice(this.markers.indexOf(marker), 1);
        changed = true;
      }
    } else {
      let contained = false;
      for (const selectionRange of this.getRanges()) {
        if (markerRange.containsRange(selectionRange, !selectionRange.isCollapsed)) {
          contained = true;
          break;
        }
      }
      if (contained && !hasMarker) {
        this.markers.push(marker);
        changed = true;
      } else if (!contained && hasMarker) {
        this.markers.splice(this.markers.indexOf(marker), 1);
        changed = true;
      }
    }
    if (changed) this.fire('change:marker', { oldMarkers, directChange: false });
  }

  /** @internal Called after each change block to settle ranges removed to the graveyard. */
  public _fixSelectionAfterChange(): void {
    if (this._selectionRestorePosition) {
      let restore = this._selectionRestorePosition;
      this._selectionRestorePosition = null;
      // The position may have gone stale if the parent changed after the removal; clamp it.
      if (restore.offset > restore.parent.maxOffset) {
        restore = Position._createAt(restore.parent, restore.parent.maxOffset);
      }
      const range = this._model.schema.getNearestSelectionRange(restore) || new Range(restore);
      this._setRanges([range], false);
      this._updateAttributes(true);
    } else if (this._hasChangedRange) {
      this._hasChangedRange = false;
      this.fire('change:range', { directChange: false });
      this._updateAttributes(false);
    }
    this._hasChangedRange = false;
  }

  private _fixGraveyardSelection(_operation: any): void {
    // No own ranges: default range is used, nothing to fix.
  }

  private _setAttribute(key: string, value: unknown, directChange = true): boolean {
    const priority = directChange ? 'normal' : 'low';
    if (priority === 'low' && this._attributePriority.get(key) === 'normal') {
      return false;
    }
    const oldValue = super.getAttribute(key);
    if (oldValue === value) return false;
    this._attrs.set(key, value);
    this._attributePriority.set(key, priority);
    if (directChange) this._storeAttribute(key, value);
    return true;
  }

  private _removeAttribute(key: string, directChange = true): boolean {
    const priority = directChange ? 'normal' : 'low';
    if (priority === 'low' && this._attributePriority.get(key) === 'normal') {
      return false;
    }
    if (!super.hasAttribute(key)) return false;
    this._attrs.delete(key);
    this._attributePriority.set(key, priority);
    if (directChange) this._storeAttribute(key, undefined);
    return true;
  }

  private _setAttributesTo(attrs: Map<string, unknown>): Set<string> {
    const changed = new Set<string>();
    for (const [oldKey, oldValue] of this.getAttributes()) {
      if (attrs.get(oldKey) === oldValue) continue;
      if (this._removeAttribute(oldKey, false)) changed.add(oldKey);
    }
    for (const [key, value] of attrs) {
      const gotAdded = this._setAttribute(key, value, false);
      if (gotAdded) changed.add(key);
    }
    return changed;
  }

  private _storeAttribute(key: string, value: unknown): void {
    const parent = this.getFirstPosition()!.parent;
    if (!(parent instanceof Element) || !parent.isEmpty || !this.isCollapsed) return;
    const storeKey = storePrefix + key;
    const current = parent.getAttribute(storeKey);
    if (current === value) return;
    this._model.enqueueChange({ isUndoable: false }, writer => {
      if (value === undefined) {
        writer.removeAttribute(storeKey, parent);
      } else {
        writer.setAttribute(storeKey, value, parent);
      }
    });
  }

  private *_getSurroundingAttributes(): IterableIterator<[string, unknown]> {
    const position = this.getFirstPosition()!;
    const schema = this._model.schema;
    if ((position.root as any).rootName === '$graveyard') return;

    let attrs: Iterable<[string, unknown]> | null = null;

    if (!this.isCollapsed) {
      const range = this.getFirstRange()!;
      for (const item of range.getItems()) {
        if (item instanceof Element && schema.isObject(item)) break;
        if (item instanceof TextProxy) {
          attrs = item.getAttributes();
          break;
        }
      }
    } else {
      const nodeBefore = position.textNode ? position.textNode : position.nodeBefore;
      const nodeAfter = position.textNode ? position.textNode : position.nodeAfter;

      if (!this.isGravityOverridden) {
        attrs = getAttrsIfTextNode(nodeBefore, schema);
      }
      if (!attrs) {
        attrs = getAttrsIfTextNode(nodeAfter, schema);
      }
      if (!this.isGravityOverridden && !attrs) {
        let node: Node | null = nodeBefore;
        while (node && !schema.isInline(node as any) && !attrs) {
          node = node.previousSibling;
          attrs = getAttrsIfTextNode(node, schema);
        }
      }
      if (!attrs) {
        let node: Node | null = nodeAfter;
        while (node && !schema.isInline(node as any) && !attrs) {
          node = node.nextSibling;
          attrs = getAttrsIfTextNode(node, schema);
        }
      }
      if (!attrs) {
        attrs = this.getStoredAttributes();
      }
    }

    if (attrs) {
      for (const [key, value] of attrs) {
        if (schema.checkAttributeInSelection(this, key)) {
          yield [key, value];
        }
      }
    }
  }
}

function getAttrsIfTextNode(node: Node | Item | null, schema: any): Iterable<[string, unknown]> | null {
  if (!node) return null;
  if (node instanceof TextProxy) return node.getAttributes();
  if (!node.is('$text')) return null;
  return node.getAttributes();
}

function clearAttributesStoredInElement(model: Model, batch: Batch): void {
  const selection = model.document.selection;
  const parent = selection.anchor ? selection.anchor.parent : null;
  if (!(parent instanceof Element) || parent.isEmpty) return;
  const keys = Array.from(parent.getAttributeKeys()).filter(k => k.startsWith(storePrefix));
  if (keys.length) {
    model.enqueueChange(batch, writer => {
      for (const key of keys) writer.removeAttribute(key, parent);
    });
  }
}
