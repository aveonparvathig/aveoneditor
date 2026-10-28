import { Element } from './element';
import { Text } from './text';
import { TextProxy } from './textproxy';
import { Position } from './position';
import type { Range } from './range';
import type { Node } from './node';
import type { DocumentFragment } from './documentfragment';

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

/** Iterates over the view tree. */
export class TreeWalker implements Iterable<TreeWalkerValue> {
  public readonly boundaries: Range | null;
  public position: Position;
  public readonly direction: TreeWalkerDirection;
  public readonly singleCharacters: boolean;
  public readonly shallow: boolean;
  public readonly ignoreElementEnd: boolean;
  private _boundaryStartParent: Node | DocumentFragment | null;
  private _boundaryEndParent: Node | DocumentFragment | null;

  constructor(options: TreeWalkerOptions = {}) {
    if (!options.boundaries && !options.startPosition) {
      throw new Error('view-tree-walker-no-start-position');
    }
    if (options.direction && options.direction !== 'forward' && options.direction !== 'backward') {
      throw new Error('view-tree-walker-unknown-direction');
    }
    this.boundaries = options.boundaries || null;
    if (options.startPosition) {
      this.position = Position._createAt(options.startPosition);
    } else {
      this.position = Position._createAt(options.boundaries![options.direction === 'backward' ? 'end' : 'start']);
    }
    this.direction = options.direction || 'forward';
    this.singleCharacters = !!options.singleCharacters;
    this.shallow = !!options.shallow;
    this.ignoreElementEnd = !!options.ignoreElementEnd;
    this._boundaryStartParent = this.boundaries ? this.boundaries.start.parent : null;
    this._boundaryEndParent = this.boundaries ? this.boundaries.end.parent : null;
  }

  public [Symbol.iterator](): Iterator<TreeWalkerValue> {
    return this;
  }

  public skip(skip: (value: TreeWalkerValue) => boolean): void {
    let nextResult: IteratorResult<TreeWalkerValue>;
    let prevPosition: Position;
    do {
      prevPosition = this.position;
      nextResult = this.next();
    } while (!nextResult.done && skip(nextResult.value));
    if (!nextResult.done) {
      this.position = prevPosition;
    }
  }

  public next(): IteratorResult<TreeWalkerValue> {
    return this.direction === 'forward' ? this._next() : this._previous();
  }

  private _next(): IteratorResult<TreeWalkerValue> {
    let position = this.position.clone();
    const previousPosition = this.position;
    const parent = position.parent;

    if (parent.parent === null && position.offset === (parent as Element).childCount) {
      return { done: true, value: undefined };
    }
    if (parent === this._boundaryEndParent && position.offset === this.boundaries!.end.offset) {
      return { done: true, value: undefined };
    }

    let node: Node | null;
    if (parent instanceof Text) {
      if (position.isAtEnd) {
        this.position = Position._createAfter(parent);
        return this._next();
      }
      node = parent.data[position.offset] as any;
    } else {
      node = (parent as Element).getChild(position.offset);
    }

    if (node instanceof Element) {
      if (!this.shallow) {
        position = new Position(node, 0);
      } else {
        if (this.boundaries && this.boundaries.end.isBefore(position)) {
          return { done: true, value: undefined };
        }
        position = new Position(position.parent, position.offset + 1);
      }
      this.position = position;
      return this._formatReturnValue('elementStart', node, previousPosition, position, 1);
    }

    if (node instanceof Text) {
      if (this.singleCharacters) {
        position = new Position(node, 0);
        this.position = position;
        return this._next();
      }
      let charactersCount = node.data.length;
      let item: TextProxy;
      if (node === this._boundaryEndParent) {
        charactersCount = this.boundaries!.end.offset;
        item = new TextProxy(node, 0, charactersCount);
        position = Position._createAfter(item);
      } else {
        item = new TextProxy(node, 0, node.data.length);
        position = new Position(position.parent, position.offset + 1);
      }
      this.position = position;
      return this._formatReturnValue('text', item, previousPosition, position, charactersCount);
    }

    if (typeof node === 'string') {
      let textLength: number;
      if (this.singleCharacters) {
        textLength = 1;
      } else {
        const endOffset = parent === this._boundaryEndParent ? this.boundaries!.end.offset : (parent as Text).data.length;
        textLength = endOffset - position.offset;
      }
      const textProxy = new TextProxy(parent as Text, position.offset, textLength);
      position = new Position(position.parent, position.offset + textLength);
      this.position = position;
      return this._formatReturnValue('text', textProxy, previousPosition, position, textLength);
    }

    // End of the parent.
    position = Position._createAfter(parent as Node);
    this.position = position;
    if (this.ignoreElementEnd) {
      return this._next();
    }
    return this._formatReturnValue('elementEnd', parent as Element, previousPosition, position);
  }

  private _previous(): IteratorResult<TreeWalkerValue> {
    let position = this.position.clone();
    const previousPosition = this.position;
    const parent = position.parent;

    if (parent.parent === null && position.offset === 0) {
      return { done: true, value: undefined };
    }
    if (parent === this._boundaryStartParent && position.offset === this.boundaries!.start.offset) {
      return { done: true, value: undefined };
    }

    let node: Node | null;
    if (parent instanceof Text) {
      if (position.isAtStart) {
        this.position = Position._createBefore(parent);
        return this._previous();
      }
      node = parent.data[position.offset - 1] as any;
    } else {
      node = (parent as Element).getChild(position.offset - 1);
    }

    if (node instanceof Element) {
      if (!this.shallow) {
        position = new Position(node, node.childCount);
        this.position = position;
        if (this.ignoreElementEnd) {
          return this._previous();
        }
        return this._formatReturnValue('elementEnd', node, previousPosition, position);
      }
      position = new Position(position.parent, position.offset - 1);
      this.position = position;
      return this._formatReturnValue('elementStart', node, previousPosition, position, 1);
    }

    if (node instanceof Text) {
      if (this.singleCharacters) {
        position = new Position(node, node.data.length);
        this.position = position;
        return this._previous();
      }
      let charactersCount = node.data.length;
      let item: TextProxy;
      if (node === this._boundaryStartParent) {
        const offset = this.boundaries!.start.offset;
        item = new TextProxy(node, offset, node.data.length - offset);
        charactersCount = item.data.length;
        position = Position._createBefore(item);
      } else {
        item = new TextProxy(node, 0, node.data.length);
        position = new Position(position.parent, position.offset - 1);
      }
      this.position = position;
      return this._formatReturnValue('text', item, previousPosition, position, charactersCount);
    }

    if (typeof node === 'string') {
      let textLength: number;
      if (!this.singleCharacters) {
        const startOffset = parent === this._boundaryStartParent ? this.boundaries!.start.offset : 0;
        textLength = position.offset - startOffset;
      } else {
        textLength = 1;
      }
      position = new Position(position.parent, position.offset - textLength);
      const textProxy = new TextProxy(parent as Text, position.offset, textLength);
      this.position = position;
      return this._formatReturnValue('text', textProxy, previousPosition, position, textLength);
    }

    position = Position._createBefore(parent as Node);
    this.position = position;
    return this._formatReturnValue('elementStart', parent as Element, previousPosition, position, 1);
  }

  private _formatReturnValue(type: TreeWalkerValueType, item: Element | TextProxy, previousPosition: Position, nextPosition: Position, length?: number): IteratorResult<TreeWalkerValue> {
    if (item instanceof TextProxy) {
      if (item.offsetInText + item.data.length === item.textNode.data.length) {
        if (this.direction === 'forward' && !(this.boundaries && this.boundaries.end.isEqual(this.position))) {
          nextPosition = Position._createAfter(item.textNode);
          this.position = nextPosition;
        } else {
          previousPosition = Position._createAfter(item.textNode);
        }
      }
      if (item.offsetInText === 0) {
        if (this.direction === 'backward' && !(this.boundaries && this.boundaries.start.isEqual(this.position))) {
          nextPosition = Position._createBefore(item.textNode);
          this.position = nextPosition;
        } else {
          previousPosition = Position._createBefore(item.textNode);
        }
      }
    }
    return { done: false, value: { type, item, previousPosition, nextPosition, length } };
  }
}
