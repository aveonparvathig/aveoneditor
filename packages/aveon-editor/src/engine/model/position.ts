import type { Node } from './node';
import { Element } from './element';
import { Text } from './text';
import { TextProxy } from './textproxy';
import { DocumentFragment } from './documentfragment';
import { TreeWalker, type TreeWalkerOptions, type TreeWalkerValue } from './treewalker';
import { compareArrays } from '../../utils/misc';
import type { Operation } from './operation/operation';
import type { InsertOperation } from './operation/insertoperation';
import type { MoveOperation } from './operation/moveoperation';
import type { SplitOperation } from './operation/splitoperation';
import type { MergeOperation } from './operation/mergeoperation';

export type PositionStickiness = 'toNone' | 'toNext' | 'toPrevious';
export type PositionRelation = 'before' | 'after' | 'same' | 'different';
export type PositionOffset = number | 'before' | 'after' | 'end';

/**
 * Position in the model tree, expressed as a path of offsets from a root.
 */
export class Position {
  public readonly root: Element | DocumentFragment;
  public path: number[];
  public stickiness: PositionStickiness;

  constructor(root: Element | DocumentFragment, path: number[], stickiness: PositionStickiness = 'toNone') {
    if (!(root instanceof Element) && !(root instanceof DocumentFragment)) {
      throw new Error('model-position-root-invalid');
    }
    if (!Array.isArray(path) || path.length === 0) {
      throw new Error('model-position-path-incorrect-format');
    }
    if (root instanceof Element && (root as any).rootName === undefined && root.parent) {
      // Not a root element: convert to a root-based path.
      path = [...root.getPath(), ...path];
      root = root.root as Element | DocumentFragment;
    }
    this.root = root;
    this.path = path.slice();
    this.stickiness = stickiness;
  }

  public get offset(): number {
    return this.path[this.path.length - 1];
  }

  public set offset(newOffset: number) {
    this.path[this.path.length - 1] = newOffset;
  }

  public get parent(): Element | DocumentFragment {
    let parent: any = this.root;
    for (let i = 0; i < this.path.length - 1; i++) {
      parent = parent.getChildAtOffset(this.path[i]);
      if (!parent) throw new Error('model-position-path-incorrect');
    }
    if (parent instanceof Text) throw new Error('model-position-path-incorrect');
    return parent;
  }

  public get index(): number {
    return this.parent.offsetToIndex(this.offset);
  }

  /** Text node containing this position, if the position is inside text. */
  public get textNode(): Text | null {
    return getTextNodeAtPosition(this, this.parent);
  }

  public get nodeAfter(): Node | null {
    const parent = this.parent;
    return getNodeAfterPosition(this, parent, getTextNodeAtPosition(this, parent));
  }

  public get nodeBefore(): Node | null {
    const parent = this.parent;
    return getNodeBeforePosition(this, parent, getTextNodeAtPosition(this, parent));
  }

  public get isAtStart(): boolean {
    return this.offset === 0;
  }

  public get isAtEnd(): boolean {
    return this.offset === this.parent.maxOffset;
  }

  public compareWith(otherPosition: Position): PositionRelation {
    if (this.root !== otherPosition.root) return 'different';
    const result = compareArrays(this.path, otherPosition.path);
    switch (result) {
      case 'same':
        return 'same';
      case 'prefix':
        return 'before';
      case 'extension':
        return 'after';
      default:
        return this.path[result as number] < otherPosition.path[result as number] ? 'before' : 'after';
    }
  }

  public getWalker(options: Partial<TreeWalkerOptions> = {}): TreeWalker {
    return new TreeWalker({ ...options, startPosition: this });
  }

  public getParentPath(): number[] {
    return this.path.slice(0, -1);
  }

  public getAncestors(): Array<Element | DocumentFragment> {
    const parent = this.parent;
    if (parent instanceof DocumentFragment) return [parent];
    return parent.getAncestors({ includeSelf: true }) as Array<Element | DocumentFragment>;
  }

  public findAncestor(parentName: string): Element | null {
    const parent = this.parent;
    if (parent instanceof Element) return parent.findAncestor(parentName, { includeSelf: true });
    return null;
  }

  public getCommonPath(position: Position): number[] {
    if (this.root !== position.root) return [];
    const cmp = compareArrays(this.path, position.path);
    const diffAt = typeof cmp === 'string' ? Math.min(this.path.length, position.path.length) : cmp;
    return this.path.slice(0, diffAt);
  }

  public getCommonAncestor(position: Position): Element | DocumentFragment | null {
    const ancestorsA = this.getAncestors();
    const ancestorsB = position.getAncestors();
    let i = 0;
    while (ancestorsA[i] === ancestorsB[i] && ancestorsA[i]) i++;
    return i === 0 ? null : ancestorsA[i - 1];
  }

  public getShiftedBy(shift: number): Position {
    const shifted = this.clone();
    const offset = shifted.offset + shift;
    shifted.offset = offset < 0 ? 0 : offset;
    return shifted;
  }

  public isAfter(otherPosition: Position): boolean {
    return this.compareWith(otherPosition) === 'after';
  }

  public isBefore(otherPosition: Position): boolean {
    return this.compareWith(otherPosition) === 'before';
  }

  public isEqual(otherPosition: Position): boolean {
    return this.compareWith(otherPosition) === 'same';
  }

  /** `true` if the positions are the same or only separated by element boundaries (no content between). */
  public isTouching(otherPosition: Position): boolean {
    if (this.root !== otherPosition.root) return false;
    const cmp = this.compareWith(otherPosition);
    if (cmp === 'same') return true;
    const [left, right] = cmp === 'before' ? [this, otherPosition] : [otherPosition, this];
    const walker = new TreeWalker({ startPosition: left });
    let step = walker.next();
    while (!step.done) {
      const value = step.value;
      if (value.nextPosition.isAfter(right)) break;
      if (value.type === 'text') return false;
      if (value.type === 'elementStart' && isObjectLike(value.item as Element)) return false;
      if (value.nextPosition.isEqual(right)) break;
      step = walker.next();
    }
    return true;
  }

  public hasSameParentAs(position: Position): boolean {
    if (this.root !== position.root) return false;
    return compareArrays(this.getParentPath(), position.getParentPath()) === 'same';
  }

  public getLastMatchingPosition(skip: (value: TreeWalkerValue) => boolean, options: Partial<TreeWalkerOptions> = {}): Position {
    options.startPosition = this;
    const walker = new TreeWalker(options as TreeWalkerOptions);
    walker.skip(skip);
    return walker.position;
  }

  public clone(): Position {
    return new Position(this.root, this.path.slice(), this.stickiness);
  }

  public is(type: string): boolean {
    return type === 'position' || type === 'model:position';
  }

  public toJSON(): { root: string; path: number[]; stickiness: PositionStickiness } {
    return { root: (this.root as any).rootName ?? '$documentFragment', path: Array.from(this.path), stickiness: this.stickiness };
  }

  // Transformations ---------------------------------------------------------

  public getTransformedByOperation(operation: Operation): Position {
    let result: Position;
    switch (operation.type) {
      case 'insert':
        result = this._getTransformedByInsertOperation(operation as InsertOperation);
        break;
      case 'move':
      case 'remove':
      case 'reinsert':
        result = this._getTransformedByMoveOperation(operation as MoveOperation);
        break;
      case 'split':
        result = this._getTransformedBySplitOperation(operation as SplitOperation);
        break;
      case 'merge':
        result = this._getTransformedByMergeOperation(operation as MergeOperation);
        break;
      default:
        result = Position._createAt(this);
    }
    return result;
  }

  /** @internal */
  public _getTransformedByInsertOperation(operation: InsertOperation): Position {
    return this._getTransformedByInsertion(operation.position, operation.howMany);
  }

  /** @internal */
  public _getTransformedByMoveOperation(operation: MoveOperation): Position {
    return this._getTransformedByMove(operation.sourcePosition, operation.targetPosition, operation.howMany);
  }

  /** @internal */
  public _getTransformedBySplitOperation(operation: SplitOperation): Position {
    const movedRange = operation.movedRange;
    const isContained = movedRange.containsPosition(this) || (movedRange.start.isEqual(this) && this.stickiness === 'toNext');
    if (isContained) {
      return this._getCombined(operation.splitPosition, operation.moveTargetPosition);
    }
    if (operation.graveyardPosition) {
      return this._getTransformedByMove(operation.graveyardPosition, operation.insertionPosition, 1);
    }
    return this._getTransformedByInsertion(operation.insertionPosition, 1);
  }

  /** @internal */
  public _getTransformedByMergeOperation(operation: MergeOperation): Position {
    const movedRange = operation.movedRange;
    const isContained = movedRange.containsPosition(this) || movedRange.start.isEqual(this);
    let pos: Position;
    if (isContained) {
      pos = this._getCombined(operation.sourcePosition, operation.targetPosition);
      if (operation.sourcePosition.isBefore(operation.targetPosition)) {
        pos = pos._getTransformedByDeletion(operation.deletionPosition, 1)!;
      }
    } else if (this.isEqual(operation.deletionPosition)) {
      pos = Position._createAt(operation.deletionPosition);
    } else {
      pos = this._getTransformedByMove(operation.deletionPosition, operation.graveyardPosition, 1);
    }
    return pos;
  }

  /** @internal */
  public _getTransformedByDeletion(deletePosition: Position, howMany: number): Position | null {
    const transformed = Position._createAt(this);
    if (this.root !== deletePosition.root) return transformed;
    if (compareArrays(deletePosition.getParentPath(), this.getParentPath()) === 'same') {
      if (deletePosition.offset < this.offset) {
        if (deletePosition.offset + howMany > this.offset) return null;
        transformed.offset -= howMany;
      }
    } else if (compareArrays(deletePosition.getParentPath(), this.getParentPath()) === 'prefix') {
      const i = deletePosition.path.length - 1;
      if (deletePosition.offset <= this.path[i]) {
        if (deletePosition.offset + howMany > this.path[i]) return null;
        transformed.path[i] -= howMany;
      }
    }
    return transformed;
  }

  /** @internal */
  public _getTransformedByInsertion(insertPosition: Position, howMany: number): Position {
    const transformed = Position._createAt(this);
    if (this.root !== insertPosition.root) return transformed;
    if (compareArrays(insertPosition.getParentPath(), this.getParentPath()) === 'same') {
      if (insertPosition.offset < this.offset || (insertPosition.offset === this.offset && this.stickiness !== 'toPrevious')) {
        transformed.offset += howMany;
      }
    } else if (compareArrays(insertPosition.getParentPath(), this.getParentPath()) === 'prefix') {
      const i = insertPosition.path.length - 1;
      if (insertPosition.offset <= this.path[i]) {
        transformed.path[i] += howMany;
      }
    }
    return transformed;
  }

  /** @internal */
  public _getTransformedByMove(sourcePosition: Position, targetPosition: Position, howMany: number): Position {
    targetPosition = targetPosition._getTransformedByDeletion(sourcePosition, howMany)!;
    if (sourcePosition.isEqual(targetPosition)) return Position._createAt(this);
    const transformed = this._getTransformedByDeletion(sourcePosition, howMany);
    const isMoved =
      transformed === null ||
      (sourcePosition.isEqual(this) && this.stickiness === 'toNext') ||
      (sourcePosition.getShiftedBy(howMany).isEqual(this) && this.stickiness === 'toPrevious');
    if (isMoved) {
      return this._getCombined(sourcePosition, targetPosition);
    }
    return transformed._getTransformedByInsertion(targetPosition, howMany);
  }

  /** @internal */
  public _getCombined(source: Position, target: Position): Position {
    const i = source.path.length - 1;
    const combined = Position._createAt(target);
    combined.stickiness = this.stickiness;
    combined.offset = combined.offset + this.path[i] - source.offset;
    combined.path = [...combined.path, ...this.path.slice(i + 1)];
    return combined;
  }

  // Static factories --------------------------------------------------------

  public static _createAt(itemOrPosition: Position | Node | TextProxy | Element | DocumentFragment, offset?: PositionOffset, stickiness: PositionStickiness = 'toNone'): Position {
    if (itemOrPosition instanceof Position) {
      return new Position(itemOrPosition.root, itemOrPosition.path, itemOrPosition.stickiness);
    }
    const node = itemOrPosition as any;
    if (offset === 'end') {
      offset = node.maxOffset;
    } else if (offset === 'before') {
      return this._createBefore(node, stickiness);
    } else if (offset === 'after') {
      return this._createAfter(node, stickiness);
    } else if (offset !== 0 && !offset) {
      throw new Error('model-createpositionat-offset-required');
    }
    if (!(node instanceof Element) && !(node instanceof DocumentFragment)) {
      throw new Error('model-position-parent-incorrect');
    }
    const path = node.getPath();
    path.push(offset as number);
    return new this(node.root as Element | DocumentFragment, path, stickiness);
  }

  public static _createAfter(item: Node | TextProxy, stickiness?: PositionStickiness): Position {
    if (!item.parent) throw new Error('model-position-after-root');
    return this._createAt(item.parent as Element | DocumentFragment, item.endOffset!, stickiness);
  }

  public static _createBefore(item: Node | TextProxy, stickiness?: PositionStickiness): Position {
    if (!item.parent) throw new Error('model-position-before-root');
    return this._createAt(item.parent as Element | DocumentFragment, item.startOffset!, stickiness);
  }

  public static fromJSON(json: { root: string; path: number[]; stickiness?: PositionStickiness }, doc: any): Position {
    if (json.root === '$graveyard') {
      return new Position(doc.graveyard, json.path, json.stickiness);
    }
    if (!doc.getRoot(json.root)) throw new Error('model-position-fromjson-no-root');
    return new Position(doc.getRoot(json.root), json.path, json.stickiness);
  }
}

export function getTextNodeAtPosition(position: Position, positionParent: Element | DocumentFragment): Text | null {
  const node = positionParent.getChildAtOffset(position.offset) as Node | null;
  if (node instanceof Text && node.startOffset! < position.offset) {
    return node;
  }
  return null;
}

export function getNodeAfterPosition(position: Position, positionParent: Element | DocumentFragment, textNode: Text | null): Node | null {
  if (textNode !== null) return null;
  return positionParent.getChild(positionParent.offsetToIndex(position.offset));
}

export function getNodeBeforePosition(position: Position, positionParent: Element | DocumentFragment, textNode: Text | null): Node | null {
  if (textNode !== null) return null;
  return positionParent.getChild(positionParent.offsetToIndex(position.offset) - 1);
}

function isObjectLike(element: Element): boolean {
  // Empty elements (inline objects, images, horizontal lines) count as content between positions.
  return element.childCount === 0;
}
