import type { Element } from './element';
import type { DocumentFragment } from './documentfragment';
import { toMap } from '../../utils/misc';

export type NodeAttributes = Record<string, unknown> | Map<string, unknown> | Iterable<[string, unknown]>;

/**
 * Abstract model node. Both elements and text nodes may carry attributes.
 */
export abstract class Node {
  public parent: Element | DocumentFragment | null = null;
  protected _attrs: Map<string, unknown>;

  constructor(attrs?: NodeAttributes) {
    this._attrs = toMap(attrs as any);
  }

  /** Index of this node in its parent, or `null` if detached. */
  public get index(): number | null {
    if (!this.parent) return null;
    const index = this.parent.getChildIndex(this as any);
    if (index === null) throw new Error('model-node-not-found-in-parent');
    return index;
  }

  /** Offset at which this node starts in its parent, or `null` if detached. */
  public get startOffset(): number | null {
    if (!this.parent) return null;
    const offset = this.parent.getChildStartOffset(this as any);
    if (offset === null) throw new Error('model-node-not-found-in-parent');
    return offset;
  }

  public abstract get offsetSize(): number;

  public get endOffset(): number | null {
    if (!this.parent) return null;
    return this.startOffset! + this.offsetSize;
  }

  public get nextSibling(): Node | null {
    const index = this.index;
    return index !== null && this.parent ? this.parent.getChild(index + 1) : null;
  }

  public get previousSibling(): Node | null {
    const index = this.index;
    return index !== null && this.parent && index > 0 ? this.parent.getChild(index - 1) : null;
  }

  public get root(): Element | DocumentFragment | Node {
    let root: Node | Element | DocumentFragment = this;
    while (root.parent) root = root.parent;
    return root;
  }

  public isAttached(): boolean {
    return (this.root as any).is('rootElement');
  }

  /** Path of offsets from the root to this node. */
  public getPath(): number[] {
    const path: number[] = [];
    let node: Node | Element | DocumentFragment = this;
    while (node.parent) {
      path.unshift(node.startOffset!);
      node = node.parent;
    }
    return path;
  }

  public getAncestors(options: { includeSelf?: boolean; parentFirst?: boolean } = {}): Array<Node | Element | DocumentFragment> {
    const ancestors: Array<Node | Element | DocumentFragment> = [];
    let parent: Node | Element | DocumentFragment | null = options.includeSelf ? this : this.parent;
    while (parent) {
      ancestors[options.parentFirst ? 'push' : 'unshift'](parent);
      parent = parent.parent;
    }
    return ancestors;
  }

  public getCommonAncestor(node: Node, options: { includeSelf?: boolean } = {}): Element | DocumentFragment | null {
    const ancestorsA = this.getAncestors(options);
    const ancestorsB = node.getAncestors(options);
    let i = 0;
    while (ancestorsA[i] === ancestorsB[i] && ancestorsA[i]) i++;
    return i === 0 ? null : (ancestorsA[i - 1] as Element | DocumentFragment);
  }

  public isBefore(node: Node): boolean {
    if (this === node) return false;
    if (this.root !== node.root) return false;
    const thisPath = this.getPath();
    const nodePath = node.getPath();
    const len = Math.min(thisPath.length, nodePath.length);
    for (let i = 0; i < len; i++) {
      if (thisPath[i] < nodePath[i]) return true;
      if (thisPath[i] > nodePath[i]) return false;
    }
    return thisPath.length < nodePath.length;
  }

  public isAfter(node: Node): boolean {
    if (this === node) return false;
    if (this.root !== node.root) return false;
    return !this.isBefore(node);
  }

  public hasAttribute(key: string): boolean {
    return this._attrs.has(key);
  }

  public getAttribute(key: string): unknown {
    return this._attrs.get(key);
  }

  public getAttributes(): Iterable<[string, unknown]> {
    return this._attrs.entries();
  }

  public getAttributeKeys(): Iterable<string> {
    return this._attrs.keys();
  }

  public abstract is(type: string, name?: string): boolean;

  public toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = {};
    if (this._attrs.size) json.attributes = Object.fromEntries(this._attrs);
    return json;
  }

  /** @internal */
  public _clone(_deep?: boolean): Node {
    throw new Error('abstract');
  }

  /** @internal */
  public _remove(): void {
    this.parent?._removeChildren(this.index!);
  }

  /** @internal */
  public _setAttribute(key: string, value: unknown): void {
    this._attrs.set(key, value);
  }

  /** @internal */
  public _setAttributesTo(attrs?: NodeAttributes): void {
    this._attrs = toMap(attrs as any);
  }

  /** @internal */
  public _removeAttribute(key: string): boolean {
    return this._attrs.delete(key);
  }

  /** @internal */
  public _clearAttributes(): void {
    this._attrs.clear();
  }
}
