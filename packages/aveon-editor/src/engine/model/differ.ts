import type { Operation } from './operation/operation';
import type { MarkerCollection } from './markercollection';
import type { RootElement } from './rootelement';
import { Range } from './range';
import { Position } from './position';
import { Element } from './element';
import type { Node } from './node';
import type { Item } from './item';
import type { InsertOperation } from './operation/insertoperation';
import type { MoveOperation } from './operation/moveoperation';
import type { AttributeOperation } from './operation/attributeoperation';
import type { SplitOperation } from './operation/splitoperation';
import type { MergeOperation } from './operation/mergeoperation';
import type { RenameOperation } from './operation/renameoperation';
import type { RootAttributeOperation } from './operation/rootattributeoperation';

export interface DiffItemInsert {
  type: 'insert';
  position: Position;
  name: string;
  length: number;
  node: Node;
  attributes: Map<string, unknown>;
}

export interface DiffItemRemove {
  type: 'remove';
  position: Position;
  name: string;
  length: number;
  node: Node;
  attributes: Map<string, unknown>;
}

export interface DiffItemRefresh {
  type: 'refresh';
  position: Position;
  name: string;
  length: number;
  node: Element;
}

export interface DiffItemAttribute {
  type: 'attribute';
  range: Range;
  attributeKey: string;
  attributeOldValue: unknown;
  attributeNewValue: unknown;
}

export type DiffItem = DiffItemInsert | DiffItemRemove | DiffItemRefresh | DiffItemAttribute;

export interface MarkerChange {
  name: string;
  data: { oldRange: Range | null; newRange: Range | null; affectsData: boolean };
}

interface RootState {
  snapshot: Node[];
  dirty: Set<Node>;
}

/**
 * Buffers operations applied in a change block and computes a diff of changed
 * top-level blocks per root. Blocks are re-converted as a unit, which keeps the
 * editing pipeline simple and predictable.
 */
export class Differ {
  private _roots = new Map<RootElement, RootState>();
  private _rootAttributeChanges: DiffItemAttribute[] = [];
  private _changedMarkers = new Map<string, MarkerChange['data']>();
  private _changeCount = 0;
  private _cachedChanges: DiffItem[] | null = null;
  private _refreshedItems = new Set<Item>();
  private _markerCollection: MarkerCollection;

  constructor(markerCollection: MarkerCollection) {
    this._markerCollection = markerCollection;
  }

  public get isEmpty(): boolean {
    return this._changeCount === 0 && this._changedMarkers.size === 0 && this._rootAttributeChanges.length === 0;
  }

  public bufferOperation(operation: Operation): void {
    this._cachedChanges = null;
    switch (operation.type) {
      case 'insert': {
        const op = operation as InsertOperation;
        this._markPosition(op.position);
        this._changeCount++;
        break;
      }
      case 'addAttribute':
      case 'removeAttribute':
      case 'changeAttribute':
      case 'attribute': {
        const op = operation as AttributeOperation;
        this._markRange(op.range);
        this._changeCount++;
        break;
      }
      case 'remove':
      case 'move':
      case 'reinsert': {
        const op = operation as MoveOperation;
        this._markPosition(op.sourcePosition);
        this._markPosition(op.targetPosition);
        // Items moved out of a root: mark them so they are removed from the view.
        this._changeCount++;
        break;
      }
      case 'rename': {
        const op = operation as RenameOperation;
        this._markPosition(op.position);
        this._markRange(null, op.position.nodeAfter as Element);
        this._changeCount++;
        break;
      }
      case 'split': {
        const op = operation as SplitOperation;
        this._markPosition(op.splitPosition);
        this._markPosition(op.insertionPosition);
        if (op.graveyardPosition) this._markPosition(op.graveyardPosition);
        this._changeCount++;
        break;
      }
      case 'merge': {
        const op = operation as MergeOperation;
        this._markPosition(op.sourcePosition);
        this._markPosition(op.targetPosition);
        this._markPosition(op.graveyardPosition);
        this._changeCount++;
        break;
      }
      case 'rootAttribute': {
        const op = operation as RootAttributeOperation;
        const root = op.root;
        this._rootAttributeChanges.push({
          type: 'attribute',
          range: Range._createIn(root),
          attributeKey: op.key,
          attributeOldValue: op.oldValue,
          attributeNewValue: op.newValue
        } as any);
        this._changeCount++;
        break;
      }
      default:
        break;
    }
  }

  public bufferMarkerChange(markerName: string, oldMarkerData: { range: Range | null; affectsData: boolean }, newMarkerData: { range: Range | null; affectsData: boolean }): void {
    const buffered = this._changedMarkers.get(markerName);
    if (!buffered) {
      this._changedMarkers.set(markerName, { oldRange: oldMarkerData.range, newRange: newMarkerData.range, affectsData: newMarkerData.affectsData });
    } else {
      buffered.newRange = newMarkerData.range;
      buffered.affectsData = newMarkerData.affectsData;
      if (buffered.oldRange === null && buffered.newRange === null) {
        this._changedMarkers.delete(markerName);
      }
    }
    this._cachedChanges = null;
  }

  public getMarkersToRemove(): Array<{ name: string; range: Range }> {
    const result: Array<{ name: string; range: Range }> = [];
    for (const [name, change] of this._changedMarkers) {
      if (change.oldRange !== null) result.push({ name, range: change.oldRange });
    }
    return result;
  }

  public getMarkersToAdd(): Array<{ name: string; range: Range }> {
    const result: Array<{ name: string; range: Range }> = [];
    for (const [name, change] of this._changedMarkers) {
      if (change.newRange !== null) result.push({ name, range: change.newRange });
    }
    return result;
  }

  public getChangedMarkers(): MarkerChange[] {
    return Array.from(this._changedMarkers).map(([name, data]) => ({ name, data }));
  }

  public hasDataChanges(): boolean {
    if (this._changeCount > 0) return true;
    for (const [, change] of this._changedMarkers) {
      if (change.affectsData) return true;
    }
    return false;
  }

  /** Returns the list of changes to apply to the view, in document order. */
  public getChanges(): DiffItem[] {
    if (this._cachedChanges) return this._cachedChanges;
    const result: DiffItem[] = [];

    // Marker range changes mark affected blocks as dirty.
    for (const [, change] of this._changedMarkers) {
      for (const range of [change.oldRange, change.newRange]) {
        if (range) this._markRange(range);
      }
    }

    for (const [root, state] of this._roots) {
      if (root.rootName === '$graveyard') continue;
      const current = Array.from(root.getChildren());
      const currentSet = new Set(current);
      const oldSet = new Set(state.snapshot);
      const old = state.snapshot;
      const removedForReorder = new Set<Node>();
      let i = 0;
      let j = 0;
      let viewOffset = 0;

      while (i < old.length || j < current.length) {
        const oldNode = old[i];
        const newNode = current[j];
        if (i < old.length && (!currentSet.has(oldNode) || removedForReorder.has(oldNode))) {
          result.push(this._removeItem(root, oldNode, viewOffset));
          i++;
          continue;
        }
        if (j < current.length && (!oldSet.has(newNode) || removedForReorder.has(newNode))) {
          removedForReorder.delete(newNode);
          result.push(this._insertItem(root, newNode, viewOffset));
          j++;
          viewOffset++;
          continue;
        }
        if (i < old.length && j < current.length) {
          if (oldNode === newNode) {
            if (state.dirty.has(oldNode) && oldNode instanceof Element) {
              result.push({ type: 'refresh', position: Position._createAt(root, viewOffset), name: oldNode.name, length: 1, node: oldNode });
            }
            i++;
            j++;
            viewOffset++;
          } else {
            // Reordered: remove the old node now and re-insert it later.
            removedForReorder.add(oldNode);
            result.push(this._removeItem(root, oldNode, viewOffset));
            i++;
          }
          continue;
        }
        break;
      }
    }

    result.push(...this._rootAttributeChanges);
    this._cachedChanges = result;
    return result;
  }

  public reset(): void {
    this._roots.clear();
    this._rootAttributeChanges = [];
    this._changedMarkers.clear();
    this._changeCount = 0;
    this._cachedChanges = null;
    this._refreshedItems = new Set();
  }

  /** @internal Marks an item for re-conversion. */
  public _refreshItem(item: Item): void {
    const node = (item as any).is('$textProxy') ? (item as any).textNode : item;
    this._markNode(node);
    this._refreshedItems.add(item);
    this._changeCount++;
    this._cachedChanges = null;
  }

  public getRefreshedItems(): Set<Item> {
    return new Set(this._refreshedItems);
  }

  private _getRootState(root: RootElement): RootState {
    let state = this._roots.get(root);
    if (!state) {
      state = { snapshot: Array.from(root.getChildren()), dirty: new Set() };
      this._roots.set(root, state);
    }
    return state;
  }

  private _markPosition(position: Position): void {
    const root = position.root as RootElement;
    if (!root.is || !root.is('rootElement')) return;
    const state = this._getRootState(root);
    if (position.path.length <= 1) {
      // Structural change among root children: snapshot comparison handles it.
      return;
    }
    const topNode = root.getChildAtOffset(position.path[0]);
    if (topNode) state.dirty.add(topNode);
  }

  private _markNode(node: Node): void {
    const root = node.root as RootElement;
    if (!root.is || !root.is('rootElement')) return;
    const state = this._getRootState(root);
    const path = node.getPath();
    if (path.length === 0) return;
    const topNode = root.getChildAtOffset(path[0]);
    if (topNode) state.dirty.add(topNode);
  }

  private _markRange(range: Range | null, element?: Element): void {
    if (element) {
      this._markNode(element);
      return;
    }
    if (!range) return;
    const root = range.root as RootElement;
    if (!root.is || !root.is('rootElement')) return;
    const state = this._getRootState(root);
    const startIndex = range.start.path[0];
    const endPath = range.end.path;
    let endOffset = endPath[0];
    if (endPath.length === 1) endOffset = endPath[0] - 1;
    for (let offset = startIndex; offset <= endOffset; offset++) {
      const topNode = root.getChildAtOffset(offset);
      if (topNode) state.dirty.add(topNode);
    }
  }

  private _removeItem(root: RootElement, node: Node, viewOffset: number): DiffItemRemove {
    return {
      type: 'remove',
      position: Position._createAt(root, viewOffset),
      name: node instanceof Element ? node.name : '$text',
      length: node.offsetSize,
      node,
      attributes: new Map(node.getAttributes())
    };
  }

  private _insertItem(root: RootElement, node: Node, viewOffset: number): DiffItemInsert {
    return {
      type: 'insert',
      position: Position._createAt(root, viewOffset),
      name: node instanceof Element ? node.name : '$text',
      length: node.offsetSize,
      node,
      attributes: new Map(node.getAttributes())
    };
  }
}

