import { Position } from './position';
import { TreeWalker, type TreeWalkerOptions, type TreeWalkerValue } from './treewalker';
import type { Element } from './element';
import type { Node } from './node';
import type { DocumentFragment } from './documentfragment';
import type { Item } from './item';
import { Text } from './text';

/** View range between two positions. */
export class Range implements Iterable<TreeWalkerValue> {
  public start: Position;
  public end: Position;

  constructor(start: Position, end: Position | null = null) {
    this.start = start.clone();
    this.end = end ? end.clone() : start.clone();
  }

  public *[Symbol.iterator](): IterableIterator<TreeWalkerValue> {
    yield* new TreeWalker({ boundaries: this, ignoreElementEnd: true });
  }

  public get isCollapsed(): boolean {
    return this.start.isEqual(this.end);
  }

  public get isFlat(): boolean {
    return this.start.parent === this.end.parent;
  }

  public get root(): Node | DocumentFragment {
    return this.start.root;
  }

  /** Returns a range with boundaries moved outside of attribute elements/text where possible. */
  public getEnlarged(): Range {
    let start = this.start.getLastMatchingPosition(enlargeTrimSkip, { direction: 'backward' });
    let end = this.end.getLastMatchingPosition(enlargeTrimSkip);
    if (start.parent instanceof Text && start.isAtStart) start = Position._createBefore(start.parent);
    if (end.parent instanceof Text && end.isAtEnd) end = Position._createAfter(end.parent);
    return new Range(start, end);
  }

  public getTrimmed(): Range {
    let start = this.start.getLastMatchingPosition(enlargeTrimSkip);
    if (start.isAfter(this.end) || start.isEqual(this.end)) return new Range(start, start);
    let end = this.end.getLastMatchingPosition(enlargeTrimSkip, { direction: 'backward' });
    const nodeAfterStart = start.nodeAfter;
    const nodeBeforeEnd = end.nodeBefore;
    if (nodeAfterStart instanceof Text) start = new Position(nodeAfterStart, 0);
    if (nodeBeforeEnd instanceof Text) end = new Position(nodeBeforeEnd, nodeBeforeEnd.data.length);
    return new Range(start, end);
  }

  public isEqual(otherRange: Range): boolean {
    return this === otherRange || (this.start.isEqual(otherRange.start) && this.end.isEqual(otherRange.end));
  }

  public containsPosition(position: Position): boolean {
    return position.isAfter(this.start) && position.isBefore(this.end);
  }

  public containsRange(otherRange: Range, loose = false): boolean {
    if (otherRange.isCollapsed) loose = false;
    const containsStart = this.containsPosition(otherRange.start) || (loose && this.start.isEqual(otherRange.start));
    const containsEnd = this.containsPosition(otherRange.end) || (loose && this.end.isEqual(otherRange.end));
    return containsStart && containsEnd;
  }

  public getDifference(otherRange: Range): Range[] {
    const ranges: Range[] = [];
    if (this.isIntersecting(otherRange)) {
      if (this.containsPosition(otherRange.start)) ranges.push(new Range(this.start, otherRange.start));
      if (this.containsPosition(otherRange.end)) ranges.push(new Range(otherRange.end, this.end));
    } else {
      ranges.push(this.clone());
    }
    return ranges;
  }

  public getIntersection(otherRange: Range): Range | null {
    if (this.isIntersecting(otherRange)) {
      let commonRangeStart = this.start;
      let commonRangeEnd = this.end;
      if (this.containsPosition(otherRange.start)) commonRangeStart = otherRange.start;
      if (this.containsPosition(otherRange.end)) commonRangeEnd = otherRange.end;
      return new Range(commonRangeStart, commonRangeEnd);
    }
    return null;
  }

  public getWalker(options: Partial<TreeWalkerOptions> = {}): TreeWalker {
    options.boundaries = this;
    return new TreeWalker(options as TreeWalkerOptions);
  }

  public getCommonAncestor(): Node | DocumentFragment | null {
    return this.start.getCommonAncestor(this.end);
  }

  public getContainedElement(): Element | null {
    if (this.isCollapsed) return null;
    let nodeAfterStart = this.start.nodeAfter;
    let nodeBeforeEnd = this.end.nodeBefore;
    if (this.start.parent instanceof Text && this.start.isAtEnd && this.start.parent.nextSibling) {
      nodeAfterStart = this.start.parent.nextSibling;
    }
    if (this.end.parent instanceof Text && this.end.isAtStart && this.end.parent.previousSibling) {
      nodeBeforeEnd = this.end.parent.previousSibling;
    }
    if (nodeAfterStart && (nodeAfterStart as any).is('element') && nodeAfterStart === nodeBeforeEnd) {
      return nodeAfterStart as Element;
    }
    return null;
  }

  public clone(): Range {
    return new Range(this.start, this.end);
  }

  public *getItems(options: Partial<TreeWalkerOptions> = {}): IterableIterator<Item> {
    options.boundaries = this;
    options.ignoreElementEnd = true;
    const treeWalker = new TreeWalker(options as TreeWalkerOptions);
    for (const value of treeWalker) yield value.item;
  }

  public *getPositions(options: Partial<TreeWalkerOptions> = {}): IterableIterator<Position> {
    options.boundaries = this;
    const treeWalker = new TreeWalker(options as TreeWalkerOptions);
    yield treeWalker.position;
    for (const value of treeWalker) yield value.nextPosition;
  }

  public is(type: string): boolean {
    return type === 'range' || type === 'view:range';
  }

  public isIntersecting(otherRange: Range): boolean {
    return this.start.isBefore(otherRange.end) && this.end.isAfter(otherRange.start);
  }

  public static _createFromParentsAndOffsets(startElement: Node | DocumentFragment, startOffset: number, endElement: Node | DocumentFragment, endOffset: number): Range {
    return new this(new Position(startElement, startOffset), new Position(endElement, endOffset));
  }

  public static _createFromPositionAndShift(position: Position, shift: number): Range {
    const start = position;
    const end = position.getShiftedBy(shift);
    return shift > 0 ? new this(start, end) : new this(end, start);
  }

  public static _createIn(element: Element | DocumentFragment): Range {
    return this._createFromParentsAndOffsets(element, 0, element, element.childCount);
  }

  public static _createOn(item: Item): Range {
    const size = item instanceof Text ? item.data.length : (item as any).is('$textProxy') ? (item as any).data.length : 1;
    return this._createFromPositionAndShift(Position._createBefore(item), size);
  }
}

function enlargeTrimSkip(value: TreeWalkerValue): boolean {
  if (value.item.is('attributeElement') || value.item.is('uiElement')) return true;
  return false;
}
