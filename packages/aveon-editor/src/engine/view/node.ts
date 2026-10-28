import { Emitter } from '../../utils/emitter';
import type { Element } from './element';
import type { DocumentFragment } from './documentfragment';
import type { Document } from './document';

export type ChangeType = 'children' | 'attributes' | 'text';

/** Abstract view node. */
export abstract class Node extends Emitter {
  public readonly document: Document;
  public parent: Element | DocumentFragment | null = null;

  constructor(document: Document) {
    super();
    this.document = document;
  }

  public get index(): number | null {
    if (!this.parent) return null;
    const pos = this.parent.getChildIndex(this as any);
    if (pos === -1) throw new Error('view-node-not-found-in-parent');
    return pos;
  }

  public get nextSibling(): Node | null {
    const index = this.index;
    return index !== null && this.parent ? this.parent.getChild(index + 1) : null;
  }

  public get previousSibling(): Node | null {
    const index = this.index;
    return index !== null && this.parent && index > 0 ? this.parent.getChild(index - 1) : null;
  }

  public get root(): Node | DocumentFragment {
    let root: Node | DocumentFragment = this;
    while (root.parent) root = root.parent;
    return root;
  }

  public isAttached(): boolean {
    return (this.root as any).is('rootElement');
  }

  public getPath(): number[] {
    const path: number[] = [];
    let node: Node | DocumentFragment = this;
    while (node.parent) {
      path.unshift(node.index!);
      node = node.parent;
    }
    return path;
  }

  public getAncestors(options: { includeSelf?: boolean; parentFirst?: boolean } = {}): Array<Node | DocumentFragment> {
    const ancestors: Array<Node | DocumentFragment> = [];
    let parent: Node | DocumentFragment | null = options.includeSelf ? this : this.parent;
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

  public abstract is(type: string, name?: string): boolean;

  public abstract _clone(deep?: boolean): Node;

  public abstract isSimilar(other: Node): boolean;

  /** @internal */
  public _remove(): void {
    this.parent!._removeChildren(this.index!);
  }

  /** @internal */
  public _fireChange(type: ChangeType, node: Node): void {
    this.fire('change:' + type, node);
    if (this.parent) this.parent._fireChange(type, node);
  }

  public toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = { ...this } as any;
    delete json.parent;
    delete (json as any)._events;
    delete (json as any)._listening;
    delete (json as any).document;
    return json;
  }
}
