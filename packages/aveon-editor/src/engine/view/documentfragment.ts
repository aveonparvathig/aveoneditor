import { Emitter } from '../../utils/emitter';
import { Node, type ChangeType } from './node';
import { Text } from './text';
import { TextProxy } from './textproxy';
import type { Document } from './document';
import type { Item } from './item';
import { isIterable } from '../../utils/misc';

/** Detached fragment of view nodes. */
export class DocumentFragment extends Emitter implements Iterable<Node> {
  public readonly document: Document;
  public readonly parent: null = null;
  private _children: Node[] = [];
  private _customProperties = new Map<string | symbol, unknown>();

  constructor(document: Document, children?: Node | Iterable<Node>) {
    super();
    this.document = document;
    if (children) this._insertChild(0, children);
  }

  public [Symbol.iterator](): Iterator<Node> {
    return this._children[Symbol.iterator]();
  }

  public get childCount(): number {
    return this._children.length;
  }

  public get isEmpty(): boolean {
    return this.childCount === 0;
  }

  public get root(): DocumentFragment {
    return this;
  }

  public is(type: string): boolean {
    return type === 'documentFragment' || type === 'view:documentFragment';
  }

  public getChild(index: number): Node | null {
    return this._children[index] ?? null;
  }

  public getChildIndex(node: Node): number {
    return this._children.indexOf(node);
  }

  public getChildren(): IterableIterator<Node> {
    return this._children[Symbol.iterator]();
  }

  public getCustomProperty(key: string | symbol): unknown {
    return this._customProperties.get(key);
  }

  public *getCustomProperties(): IterableIterator<[string | symbol, unknown]> {
    yield* this._customProperties.entries();
  }

  public getPath(): number[] {
    return [];
  }

  public getAncestors(): never[] {
    return [];
  }

  /** @internal */
  public _appendChild(items: Item | string | Iterable<Item | string>): number {
    return this._insertChild(this.childCount, items);
  }

  /** @internal */
  public _insertChild(index: number, items: Item | string | Iterable<Item | string>): number {
    this._fireChange('children', this);
    let count = 0;
    const nodes = normalize(this.document, items);
    for (const node of nodes) {
      if (node.parent !== null) node._remove();
      node.parent = this;
      this._children.splice(index, 0, node);
      index++;
      count++;
    }
    return count;
  }

  /** @internal */
  public _removeChildren(index: number, howMany = 1): Node[] {
    this._fireChange('children', this);
    for (let i = index; i < index + howMany; i++) {
      this._children[i].parent = null;
    }
    return this._children.splice(index, howMany);
  }

  /** @internal */
  public _fireChange(type: ChangeType, node: Node | DocumentFragment): void {
    this.fire('change:' + type, node);
  }

  /** @internal */
  public _setCustomProperty(key: string | symbol, value: unknown): void {
    this._customProperties.set(key, value);
  }

  /** @internal */
  public _removeCustomProperty(key: string | symbol): boolean {
    return this._customProperties.delete(key);
  }
}

function normalize(document: Document, nodes: Item | string | Iterable<Item | string>): Node[] {
  if (typeof nodes === 'string') return [new Text(document, nodes)];
  if (!isIterable(nodes)) nodes = [nodes as any];
  return Array.from(nodes as Iterable<Item | string>).map(node => {
    if (typeof node === 'string') return new Text(document, node);
    if (node instanceof TextProxy) return new Text(document, node.data);
    return node as Node;
  });
}
