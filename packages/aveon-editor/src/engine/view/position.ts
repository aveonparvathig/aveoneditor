import { Text } from './text';
import { TextProxy } from './textproxy';
import { Element } from './element';
import { DocumentFragment } from './documentfragment';
import { EditableElement } from './editableelement';
import { TreeWalker, type TreeWalkerOptions, type TreeWalkerValue } from './treewalker';
import type { Node } from './node';
import type { Item } from './item';
import { compareArrays } from '../../utils/misc';

export type PositionRelation = 'before' | 'after' | 'same' | 'different';
export type PositionOffset = number | 'before' | 'after' | 'end';

/** Position in the view tree: a parent node and an offset. */
export class Position {
  public parent: Node | DocumentFragment;
  public offset: number;

  constructor(parent: Node | DocumentFragment, offset: number) {
    this.parent = parent;
    this.offset = offset;
  }

  public get nodeAfter(): Node | null {
    if (this.parent instanceof Text) return null;
    return (this.parent as Element).getChild(this.offset) || null;
  }

  public get nodeBefore(): Node | null {
    if (this.parent instanceof Text) return null;
    return (this.parent as Element).getChild(this.offset - 1) || null;
  }

  public get isAtStart(): boolean {
    return this.offset === 0;
  }

  public get isAtEnd(): boolean {
    const endOffset = this.parent instanceof Text ? this.parent.data.length : (this.parent as Element).childCount;
    return this.offset === endOffset;
  }

  public get root(): Node | DocumentFragment {
    return this.parent.root;
  }

  public get editableElement(): EditableElement | null {
    let editable: any = this.parent;
    while (!(editable instanceof EditableElement)) {
      if (editable.parent) {
        editable = editable.parent;
      } else {
        return null;
      }
    }
    return editable;
  }

  public getShiftedBy(shift: number): Position {
    const shifted = Position._createAt(this);
    const offset = shifted.offset + shift;
    return new Position(shifted.parent, offset < 0 ? 0 : offset);
  }

  public getLastMatchingPosition(skip: (value: TreeWalkerValue) => boolean, options: Partial<TreeWalkerOptions> = {}): Position {
    options.startPosition = this;
    const treeWalker = new TreeWalker(options as TreeWalkerOptions);
    treeWalker.skip(skip);
    return treeWalker.position;
  }

  public getAncestors(): Array<Node | DocumentFragment> {
    if (this.parent instanceof DocumentFragment) return [this.parent];
    return (this.parent as Node).getAncestors({ includeSelf: true });
  }

  public getCommonAncestor(position: Position): Node | DocumentFragment | null {
    const ancestorsA = this.getAncestors();
    const ancestorsB = position.getAncestors();
    let i = 0;
    while (ancestorsA[i] === ancestorsB[i] && ancestorsA[i]) i++;
    return i === 0 ? null : ancestorsA[i - 1];
  }

  public is(type: string): boolean {
    return type === 'position' || type === 'view:position';
  }

  public isEqual(otherPosition: Position): boolean {
    return this === otherPosition || (this.parent === otherPosition.parent && this.offset === otherPosition.offset);
  }

  public isBefore(otherPosition: Position): boolean {
    return this.compareWith(otherPosition) === 'before';
  }

  public isAfter(otherPosition: Position): boolean {
    return this.compareWith(otherPosition) === 'after';
  }

  public compareWith(otherPosition: Position): PositionRelation {
    if (this.root !== otherPosition.root) return 'different';
    if (this.isEqual(otherPosition)) return 'same';
    const thisPath = this.parent instanceof DocumentFragment ? [] : (this.parent as Node).getPath();
    const otherPath = otherPosition.parent instanceof DocumentFragment ? [] : (otherPosition.parent as Node).getPath();
    thisPath.push(this.offset);
    otherPath.push(otherPosition.offset);
    const result = compareArrays(thisPath, otherPath);
    switch (result) {
      case 'prefix':
        return 'before';
      case 'extension':
        return 'after';
      default:
        return thisPath[result as number] < otherPath[result as number] ? 'before' : 'after';
    }
  }

  public getWalker(options: Partial<TreeWalkerOptions> = {}): TreeWalker {
    options.startPosition = this;
    return new TreeWalker(options as TreeWalkerOptions);
  }

  public clone(): Position {
    return new Position(this.parent, this.offset);
  }

  public static _createAt(itemOrPosition: Item | Position | DocumentFragment, offset?: PositionOffset): Position {
    if (itemOrPosition instanceof Position) {
      return new this(itemOrPosition.parent, itemOrPosition.offset);
    }
    const node = itemOrPosition as any;
    if (offset === 'end') {
      offset = node instanceof Text ? node.data.length : node.childCount;
    } else if (offset === 'before') {
      return this._createBefore(node);
    } else if (offset === 'after') {
      return this._createAfter(node);
    } else if (offset !== 0 && !offset) {
      throw new Error('view-createpositionat-offset-required');
    }
    return new Position(node, offset as number);
  }

  public static _createAfter(item: Item): Position {
    if (item instanceof TextProxy) {
      return new Position(item.textNode, item.offsetInText + item.data.length);
    }
    if (!item.parent) throw new Error('view-position-after-root');
    return new Position(item.parent, item.index! + 1);
  }

  public static _createBefore(item: Item): Position {
    if (item instanceof TextProxy) {
      return new Position(item.textNode, item.offsetInText);
    }
    if (!item.parent) throw new Error('view-position-before-root');
    return new Position(item.parent, item.index!);
  }
}
