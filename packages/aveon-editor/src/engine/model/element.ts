import { Node, type NodeAttributes } from './node';
import { NodeList } from './nodelist';
import { Text } from './text';
import { TextProxy } from './textproxy';
import { isIterable } from '../../utils/misc';

/** Model element: a named node with attributes and children. */
export class Element extends Node {
  public name: string;
  private _children = new NodeList();

  constructor(name: string, attrs?: NodeAttributes, children?: string | Node | Iterable<string | Node>) {
    super(attrs);
    this.name = name;
    if (children) this._insertChild(0, children);
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

  public override get offsetSize(): number {
    return 1;
  }

  public override is(type: string, name?: string): boolean {
    if (!name) {
      return type === 'element' || type === 'model:element' || type === 'node' || type === 'model:node';
    }
    return name === this.name && (type === 'element' || type === 'model:element');
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

  public offsetToIndex(offset: number): number {
    return this._children.offsetToIndex(offset);
  }

  public getNodeByPath(relativePath: number[]): Node | Element {
    let node: Node | Element = this;
    for (const offset of relativePath) {
      node = (node as Element).getChildAtOffset(offset)!;
    }
    return node;
  }

  public findAncestor(parentName: string, options: { includeSelf?: boolean } = {}): Element | null {
    let parent: any = options.includeSelf ? this : this.parent;
    while (parent) {
      if (parent.name === parentName) return parent;
      parent = parent.parent;
    }
    return null;
  }

  public override toJSON(): Record<string, unknown> {
    const json = super.toJSON();
    json.name = this.name;
    if (this._children.length > 0) json.children = this._children.toJSON();
    return json;
  }

  /** @internal */
  public override _clone(deep = false): Element {
    const children = deep ? Array.from(this._children).map(node => node._clone(true)) : undefined;
    return new Element(this.name, this.getAttributes(), children);
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
      node.parent = this;
    }
    this._children._insertNodes(index, nodes);
  }

  /** @internal */
  public _removeChildren(index: number, howMany = 1): Node[] {
    const nodes = this._children._removeNodes(index, howMany);
    for (const node of nodes) node.parent = null;
    return nodes;
  }

  public static fromJSON(json: any): Element {
    let children: Node[] | undefined;
    if (json.children) {
      children = [];
      for (const child of json.children) {
        children.push(child.name ? Element.fromJSON(child) : Text.fromJSON(child));
      }
    }
    return new Element(json.name, json.attributes, children);
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
