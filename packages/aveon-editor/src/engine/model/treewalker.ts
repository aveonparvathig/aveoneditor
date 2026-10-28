import { Position } from './position';
import type { Range } from './range';
import { Element } from './element';
import { Text } from './text';
import { TextProxy } from './textproxy';
import type { Node } from './node';
import { DocumentFragment } from './documentfragment';

export type TreeWalkerValueType = 'elementStart' | 'elementEnd' | 'text';
export type TreeWalkerDirection = 'forward' | 'backward';

export interface TreeWalkerValue {
  type: TreeWalkerValueType;
  item: Element | TextProxy;
  previousPosition: Position;
  nextPosition: Position;
  length?: number;
}

export interface TreeWalkerOptions {
  direction?: TreeWalkerDirection;
  boundaries?: Range | null;
  startPosition?: Position;
  singleCharacters?: boolean;
  shallow?: boolean;
  ignoreElementEnd?: boolean;
}

/** Iterates over model tree items between positions. */
export class TreeWalker implements Iterable<TreeWalkerValue> {
  public readonly direction: TreeWalkerDirection;
  public readonly boundaries: Range | null;
  public readonly singleCharacters: boolean;
  public readonly shallow: boolean;
  public readonly ignoreElementEnd: boolean;
  public position: Position;
  private _boundaryStartParent: Element | DocumentFragment | null;
  private _boundaryEndParent: Element | DocumentFragment | null;
  private _visitedParent: Element | DocumentFragment;

  constructor(options: TreeWalkerOptions) {
    if (!options || (!options.boundaries && !options.startPosition)) {
      throw new Error('model-tree-walker-no-start-position');
    }
    const direction = options.direction || 'forward';
    if (direction !== 'forward' && direction !== 'backward') {
      throw new Error('model-tree-walker-unknown-direction');
    }
    this.direction = direction;
    this.boundaries = options.boundaries || null;
    if (options.startPosition) {
      this.position = options.startPosition.clone();
    } else {
      this.position = Position._createAt(this.boundaries![this.direction === 'backward' ? 'end' : 'start']);
    }
    this.position.stickiness = 'toNone';
    this.singleCharacters = !!options.singleCharacters;
    this.shallow = !!options.shallow;
    this.ignoreElementEnd = !!options.ignoreElementEnd;
    this._boundaryStartParent = this.boundaries ? this.boundaries.start.parent : null;
    this._boundaryEndParent = this.boundaries ? this.boundaries.end.parent : null;
    this._visitedParent = this.position.parent;
  }

  public [Symbol.iterator](): Iterator<TreeWalkerValue> {
    return this;
  }

  public next(): IteratorResult<TreeWalkerValue> {
    return this.direction === 'forward' ? this._next() : this._previous();
  }

  public skip(skip: (value: TreeWalkerValue) => boolean): void {
    let done: boolean | undefined, value: TreeWalkerValue, prevPosition: Position, prevVisitedParent: Element | DocumentFragment;
    do {
      prevPosition = this.position;
      prevVisitedParent = this._visitedParent;
      ({ done, value } = this.next());
    } while (!done && skip(value));
    if (!done) {
      this.position = prevPosition;
      this._visitedParent = prevVisitedParent;
    }
  }

  public jumpTo(position: Position): void {
    if (this._boundaryStartParent && position.isBefore(this.boundaries!.start)) {
      position = this.boundaries!.start;
    } else if (this._boundaryEndParent && position.isAfter(this.boundaries!.end)) {
      position = this.boundaries!.end;
    }
    this.position = position.clone();
    this._visitedParent = this.position.parent;
  }

  private _next(): IteratorResult<TreeWalkerValue> {
    const previousPosition = this.position;
    const position = this.position.clone();
    const parent = this._visitedParent;

    if (parent.parent === null && position.offset === parent.maxOffset) {
      return { done: true, value: undefined };
    }
    if (parent === this._boundaryEndParent && position.offset === this.boundaries!.end.offset) {
      return { done: true, value: undefined };
    }

    const textNodeAtPosition = getTextNodeAtPosition(position, parent);
    const node = textNodeAtPosition || getNodeAfterPosition(position, parent, textNodeAtPosition);

    if (node instanceof Element) {
      if (!this.shallow) {
        position.path.push(0);
        this._visitedParent = node;
      } else {
        if (this.boundaries && this.boundaries.end.isBefore(position)) {
          return { done: true, value: undefined };
        }
        position.offset++;
      }
      this.position = position;
      return formatReturnValue('elementStart', node, previousPosition, position, 1);
    }

    if (node instanceof Text) {
      let charactersCount: number;
      if (this.singleCharacters) {
        charactersCount = 1;
      } else {
        let offset = node.endOffset!;
        if (this._boundaryEndParent === parent && this.boundaries!.end.offset < offset) {
          offset = this.boundaries!.end.offset;
        }
        charactersCount = offset - position.offset;
      }
      const offsetInTextNode = position.offset - node.startOffset!;
      const item = new TextProxy(node, offsetInTextNode, charactersCount);
      position.offset += charactersCount;
      this.position = position;
      return formatReturnValue('text', item, previousPosition, position, charactersCount);
    }

    // End of the parent element.
    position.path.pop();
    position.offset++;
    this.position = position;
    this._visitedParent = parent.parent as Element | DocumentFragment;
    if (this.ignoreElementEnd) {
      return this._next();
    }
    return formatReturnValue('elementEnd', parent as Element, previousPosition, position);
  }

  private _previous(): IteratorResult<TreeWalkerValue> {
    const previousPosition = this.position;
    const position = this.position.clone();
    const parent = this._visitedParent;

    if (parent.parent === null && position.offset === 0) {
      return { done: true, value: undefined };
    }
    if (parent === this._boundaryStartParent && position.offset === this.boundaries!.start.offset) {
      return { done: true, value: undefined };
    }

    const textNodeAtPosition = getTextNodeAtPosition(position, parent);
    const node = textNodeAtPosition || getNodeBeforePosition(position, parent, textNodeAtPosition);

    if (node instanceof Element) {
      position.offset--;
      if (this.shallow) {
        this.position = position;
        return formatReturnValue('elementStart', node, previousPosition, position, 1);
      }
      position.path.push(node.maxOffset);
      this.position = position;
      this._visitedParent = node;
      if (this.ignoreElementEnd) {
        return this._previous();
      }
      return formatReturnValue('elementEnd', node, previousPosition, position);
    }

    if (node instanceof Text) {
      let charactersCount: number;
      if (this.singleCharacters) {
        charactersCount = 1;
      } else {
        let offset = node.startOffset!;
        if (this._boundaryStartParent === parent && this.boundaries!.start.offset > offset) {
          offset = this.boundaries!.start.offset;
        }
        charactersCount = position.offset - offset;
      }
      const offsetInTextNode = position.offset - node.startOffset!;
      const item = new TextProxy(node, offsetInTextNode - charactersCount, charactersCount);
      position.offset -= charactersCount;
      this.position = position;
      return formatReturnValue('text', item, previousPosition, position, charactersCount);
    }

    position.path.pop();
    this.position = position;
    this._visitedParent = parent.parent as Element | DocumentFragment;
    return formatReturnValue('elementStart', parent as Element, previousPosition, position, 1);
  }
}

function formatReturnValue(type: TreeWalkerValueType, item: Element | TextProxy, previousPosition: Position, nextPosition: Position, length?: number): IteratorResult<TreeWalkerValue> {
  return { done: false, value: { type, item, previousPosition, nextPosition, length } };
}

function getTextNodeAtPosition(position: Position, positionParent: Element | DocumentFragment): Text | null {
  const node = positionParent.getChildAtOffset(position.offset) as Node | null;
  if (node instanceof Text && node.startOffset! < position.offset) return node;
  return null;
}

function getNodeAfterPosition(position: Position, positionParent: Element | DocumentFragment, textNode: Text | null): Node | null {
  if (textNode !== null) return null;
  return positionParent.getChild(positionParent.offsetToIndex(position.offset));
}

function getNodeBeforePosition(position: Position, positionParent: Element | DocumentFragment, textNode: Text | null): Node | null {
  if (textNode !== null) return null;
  return positionParent.getChild(positionParent.offsetToIndex(position.offset) - 1);
}
