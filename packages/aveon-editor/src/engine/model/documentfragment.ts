import { NodeList } from './nodelist';
import type { Node } from './node';
import { Text } from './text';
import { TextProxy } from './textproxy';
import { Element } from './element';
import { isIterable } from '../../utils/misc';

/** Detached fragment of model nodes (clipboard, parse results). */
export class DocumentFragment implements Iterable<Node> {
  public readonly markers = new Map<string, any>();
  public readonly parent: null = null;
  private _children = new NodeList();

  constructor(children?: string | Node | Iterable<string | Node>) {
    if (children) this._insertChild(0, children);
  }

  public [Symbol.iterator](): Iterator<Node> {
    return this.getChildren()[Symbol.iterator]();
  }

  public get childCount(): number {
    return this._children.length;
  }

  public get maxOffset(): number {
    return this._children.maxOffset;
  }

  public get isEmpty(): boolean {
    return this.childCount === 0;
  }

  public get nextSibling(): null {
    return null;
  }

  public get previousSibling(): null {
    return null;
  }

  public get root(): DocumentFragment {
    return this;
  }

  public is(type: string): boolean {
    return type === 'documentFragment' || type === 'model:documentFragment';
  }

  public getChild(index: number): Node | null {
    return this._children.getNode(index);
  }

  public getChildren(): Iterable<Node> {
    return this._children;
  }

  public getChildIndex(node: Node): number | null {
    return this._children.getNodeIndex(node);
  }

  public getChildStartOffset(node: Node): number | null {
    return this._children.getNodeStartOffset(node);
  }

  public getChildAtOffset(offset: number): Node | null {
    return this._children.getNodeAtOffset(offset);
  }

  public getPath(): number[] {
    return [];
  }

  public getAncestors(): never[] {
    return [];
  }

  public getNodeByPath(relativePath: number[]): Node | DocumentFragment {
    let node: any = this;
    for (const offset of relativePath) node = node.getChildAtOffset(offset);
    return node;
  }

  public offsetToIndex(offset: number): number {
    return this._children.offsetToIndex(offset);
  }

  public toJSON(): unknown[] {
    return this._children.toJSON();
  }

  public isAttached(): boolean {
    return false;
  }

  public hasAttribute(): boolean {
    return false;
  }

  public getAttribute(): undefined {
    return undefined;
  }

  public getAttributes(): Iterable<[string, unknown]> {
    return [];
  }

  public getAttributeKeys(): Iterable<string> {
    return [];
  }

  /** @internal */
  public _appendChild(nodes: string | Node | Iterable<string | Node>): void {
    this._insertChild(this.childCount, nodes);
  }

  /** @internal */
  public _insertChild(index: number, items: string | Node | Iterable<string | Node>): void {
    const nodes = normalize(items);
    for (const node of nodes) {
      if (node.parent !== null) node._remove();
      node.parent = this as any;
    }
    this._children._insertNodes(index, nodes);
  }

  /** @internal */
  public _removeChildren(index: number, howMany = 1): Node[] {
    const nodes = this._children._removeNodes(index, howMany);
    for (const node of nodes) node.parent = null;
    return nodes;
  }

  public static fromJSON(json: any[]): DocumentFragment {
    const children: Node[] = [];
    for (const child of json) {
      children.push(child.name ? Element.fromJSON(child) : Text.fromJSON(child));
    }
    return new DocumentFragment(children);
  }
}

function normalize(nodes: string | Node | TextProxy | Iterable<string | Node | TextProxy>): Node[] {
  if (typeof nodes === 'string') return [new Text(nodes)];
  if (!isIterable(nodes)) nodes = [nodes as Node];
  return Array.from(nodes as Iterable<string | Node | TextProxy>).map(node => {
    if (typeof node === 'string') return new Text(node);
    if (node instanceof TextProxy) return new Text(node.data, node.getAttributes());
    return node;
  });
}
