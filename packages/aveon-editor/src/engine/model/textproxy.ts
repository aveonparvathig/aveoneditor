import type { Text } from './text';
import type { Element } from './element';
import type { DocumentFragment } from './documentfragment';
import type { Node } from './node';

/** A fragment of a text node, as returned by tree walkers. */
export class TextProxy {
  public readonly textNode: Text;
  public readonly data: string;
  public readonly offsetInText: number;

  constructor(textNode: Text, offsetInText: number, length: number) {
    this.textNode = textNode;
    if (offsetInText < 0 || offsetInText > textNode.offsetSize) throw new Error('model-textproxy-wrong-offsetintext');
    if (length < 0 || offsetInText + length > textNode.offsetSize) throw new Error('model-textproxy-wrong-length');
    this.data = textNode.data.substring(offsetInText, offsetInText + length);
    this.offsetInText = offsetInText;
  }

  public get startOffset(): number | null {
    return this.textNode.startOffset !== null ? this.textNode.startOffset + this.offsetInText : null;
  }

  public get offsetSize(): number {
    return this.data.length;
  }

  public get endOffset(): number | null {
    return this.startOffset !== null ? this.startOffset + this.offsetSize : null;
  }

  public get isPartial(): boolean {
    return this.offsetSize !== this.textNode.offsetSize;
  }

  public get parent(): Element | DocumentFragment | null {
    return this.textNode.parent;
  }

  public get root(): Node | Element | DocumentFragment {
    return this.textNode.root;
  }

  public is(type: string, name?: string): boolean {
    if (name) return false;
    return type === '$textProxy' || type === 'model:$textProxy' || type === 'textProxy' || type === 'model:textProxy';
  }

  public getPath(): number[] {
    const path = this.textNode.getPath();
    if (path.length > 0) path[path.length - 1] += this.offsetInText;
    return path;
  }

  public getAncestors(options: { includeSelf?: boolean; parentFirst?: boolean } = {}): Array<Node | Element | DocumentFragment | TextProxy> {
    const ancestors: Array<Node | Element | DocumentFragment | TextProxy> = [];
    let parent: Node | Element | DocumentFragment | TextProxy | null = options.includeSelf ? this : this.parent;
    while (parent) {
      ancestors[options.parentFirst ? 'push' : 'unshift'](parent);
      parent = parent.parent;
    }
    return ancestors;
  }

  public hasAttribute(key: string): boolean {
    return this.textNode.hasAttribute(key);
  }

  public getAttribute(key: string): unknown {
    return this.textNode.getAttribute(key);
  }

  public getAttributes(): Iterable<[string, unknown]> {
    return this.textNode.getAttributes();
  }

  public getAttributeKeys(): Iterable<string> {
    return this.textNode.getAttributeKeys();
  }
}
