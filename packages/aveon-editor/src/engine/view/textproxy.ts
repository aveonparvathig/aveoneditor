import type { Text } from './text';
import type { Element } from './element';
import type { DocumentFragment } from './documentfragment';
import type { Node } from './node';
import type { Document } from './document';

/** A fragment of a view text node. */
export class TextProxy {
  public readonly textNode: Text;
  public readonly data: string;
  public readonly offsetInText: number;

  constructor(textNode: Text, offsetInText: number, length: number) {
    this.textNode = textNode;
    if (offsetInText < 0 || offsetInText > textNode.data.length) throw new Error('view-textproxy-wrong-offsetintext');
    if (length < 0 || offsetInText + length > textNode.data.length) throw new Error('view-textproxy-wrong-length');
    this.data = textNode.data.substring(offsetInText, offsetInText + length);
    this.offsetInText = offsetInText;
  }

  public get offsetSize(): number {
    return this.data.length;
  }

  public get isPartial(): boolean {
    return this.data.length !== this.textNode.data.length;
  }

  public get parent(): Element | DocumentFragment | null {
    return this.textNode.parent;
  }

  public get root(): Node | DocumentFragment {
    return this.textNode.root;
  }

  public get document(): Document {
    return this.textNode.document;
  }

  public is(type: string, name?: string): boolean {
    if (name) return false;
    return type === '$textProxy' || type === 'view:$textProxy';
  }

  public getAncestors(options: { includeSelf?: boolean; parentFirst?: boolean } = {}): Array<Node | DocumentFragment | TextProxy> {
    const ancestors: Array<Node | DocumentFragment | TextProxy> = [];
    let parent: Node | DocumentFragment | TextProxy | null = options.includeSelf ? this : this.parent;
    while (parent) {
      ancestors[options.parentFirst ? 'push' : 'unshift'](parent);
      parent = parent.parent;
    }
    return ancestors;
  }
}
