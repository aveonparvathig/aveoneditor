import { Node } from './node';
import { Text } from './text';
import { TextProxy } from './textproxy';
import type { Document } from './document';
import type { Item } from './item';
import { isIterable, toMap } from '../../utils/misc';

export type ElementAttributes = Record<string, unknown> | Iterable<[string, unknown]> | null | undefined;

/**
 * View element. Base class for container, attribute, empty, UI, raw and editable elements.
 */
export class Element extends Node {
  public readonly name: string;
  protected _attrs: Map<string, string>;
  protected _children: Node[] = [];
  protected _classes = new Set<string>();
  protected _styles = new Map<string, string>();
  protected _customProperties = new Map<string | symbol, unknown>();
  protected _unsafeAttributesToRender: string[] = [];

  constructor(document: Document, name: string, attrs?: ElementAttributes, children?: Node | Iterable<Node>) {
    super(document);
    this.name = name;
    this._attrs = parseAttributes(attrs);
    if (children) this._insertChild(0, children);
    if (this._attrs.has('class')) {
      const classString = this._attrs.get('class')!;
      parseClasses(this._classes, classString);
      this._attrs.delete('class');
    }
    if (this._attrs.has('style')) {
      parseInlineStyles(this._styles, this._attrs.get('style')!);
      this._attrs.delete('style');
    }
  }

  public get childCount(): number {
    return this._children.length;
  }

  public get isEmpty(): boolean {
    return this._children.length === 0;
  }

  public override is(type: string, name?: string): boolean {
    if (!name) {
      return type === 'element' || type === 'view:element' || type === 'node' || type === 'view:node';
    }
    return name === this.name && (type === 'element' || type === 'view:element');
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

  public *getAttributeKeys(): IterableIterator<string> {
    if (this._classes.size > 0) yield 'class';
    if (this._styles.size > 0) yield 'style';
    yield* this._attrs.keys();
  }

  public *getAttributes(): IterableIterator<[string, string]> {
    yield* this._attrs.entries();
    if (this._classes.size > 0) yield ['class', this.getAttribute('class')!];
    if (this._styles.size > 0) yield ['style', this.getAttribute('style')!];
  }

  public getAttribute(key: string): string | undefined {
    if (key === 'class') {
      if (this._classes.size > 0) return [...this._classes].join(' ');
      return undefined;
    }
    if (key === 'style') {
      const inlineStyle = stylesToString(this._styles);
      return inlineStyle === '' ? undefined : inlineStyle;
    }
    return this._attrs.get(key);
  }

  public hasAttribute(key: string): boolean {
    if (key === 'class') return this._classes.size > 0;
    if (key === 'style') return this._styles.size > 0;
    return this._attrs.has(key);
  }

  public override isSimilar(otherElement: Node): boolean {
    if (!(otherElement instanceof Element)) return false;
    if (this === otherElement) return true;
    if (this.name !== otherElement.name) return false;
    if (this._attrs.size !== otherElement._attrs.size || this._classes.size !== otherElement._classes.size || this._styles.size !== otherElement._styles.size) {
      return false;
    }
    for (const [key, value] of this._attrs) {
      if (!otherElement._attrs.has(key) || otherElement._attrs.get(key) !== value) return false;
    }
    for (const className of this._classes) {
      if (!otherElement._classes.has(className)) return false;
    }
    for (const [property, value] of this._styles) {
      if (!otherElement._styles.has(property) || otherElement._styles.get(property) !== value) return false;
    }
    return true;
  }

  public hasClass(...className: string[]): boolean {
    for (const name of className) {
      if (!this._classes.has(name)) return false;
    }
    return true;
  }

  public getClassNames(): IterableIterator<string> {
    return this._classes.keys();
  }

  public getStyle(property: string): string | undefined {
    return this._styles.get(property);
  }

  public getNormalizedStyle(property: string): string | undefined {
    return this._styles.get(property);
  }

  public getStyleNames(): IterableIterator<string> {
    return this._styles.keys();
  }

  public hasStyle(...property: string[]): boolean {
    for (const name of property) {
      if (!this._styles.has(name)) return false;
    }
    return true;
  }

  public findAncestor(...patterns: Array<string | ((el: Element) => boolean)>): Element | null {
    let parent = this.parent as Element | null;
    while (parent && (parent as any).is('element')) {
      for (const pattern of patterns) {
        if (typeof pattern === 'string' ? parent.name === pattern : pattern(parent)) return parent;
      }
      parent = parent.parent as Element | null;
    }
    return null;
  }

  public getCustomProperty(key: string | symbol): unknown {
    return this._customProperties.get(key);
  }

  public *getCustomProperties(): IterableIterator<[string | symbol, unknown]> {
    yield* this._customProperties.entries();
  }

  public getIdentity(): string {
    const classes = Array.from(this._classes).sort().join(',');
    const styles = stylesToString(this._styles);
    const attributes = Array.from(this._attrs)
      .map(i => `${i[0]}="${i[1]}"`)
      .sort()
      .join(' ');
    return this.name + (classes === '' ? '' : ` class="${classes}"`) + (!styles ? '' : ` style="${styles}"`) + (attributes === '' ? '' : ` ${attributes}`);
  }

  public shouldRenderUnsafeAttribute(attributeName: string): boolean {
    return this._unsafeAttributesToRender.includes(attributeName);
  }

  /** Returns the offset where a filler should be rendered, or `null`. */
  public getFillerOffset(): number | null {
    return null;
  }

  public override _clone(deep = false): Element {
    const childrenClone: Node[] = [];
    if (deep) {
      for (const child of this.getChildren()) childrenClone.push(child._clone(true));
    }
    const cloned = new (this.constructor as any)(this.document, this.name, this._attrs, childrenClone);
    cloned._classes = new Set(this._classes);
    cloned._styles = new Map(this._styles);
    cloned._customProperties = new Map(this._customProperties);
    cloned.getFillerOffset = this.getFillerOffset;
    cloned._unsafeAttributesToRender = this._unsafeAttributesToRender;
    return cloned;
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
  public _setAttribute(key: string, value: unknown): void {
    const stringValue = String(value);
    this._fireChange('attributes', this);
    if (key === 'class') {
      parseClasses(this._classes, stringValue);
    } else if (key === 'style') {
      parseInlineStyles(this._styles, stringValue);
    } else {
      this._attrs.set(key, stringValue);
    }
  }

  /** @internal */
  public _removeAttribute(key: string): boolean {
    this._fireChange('attributes', this);
    if (key === 'class') {
      if (this._classes.size > 0) {
        this._classes.clear();
        return true;
      }
      return false;
    }
    if (key === 'style') {
      if (this._styles.size > 0) {
        this._styles.clear();
        return true;
      }
      return false;
    }
    return this._attrs.delete(key);
  }

  /** @internal */
  public _addClass(className: string | string[]): void {
    this._fireChange('attributes', this);
    for (const name of toArray(className)) this._classes.add(name);
  }

  /** @internal */
  public _removeClass(className: string | string[]): void {
    this._fireChange('attributes', this);
    for (const name of toArray(className)) this._classes.delete(name);
  }

  /** @internal */
  public _setStyle(property: string | Record<string, string>, value?: string): void {
    this._fireChange('attributes', this);
    if (typeof property === 'string') {
      this._styles.set(property, value!);
    } else {
      for (const [key, val] of Object.entries(property)) this._styles.set(key, val);
    }
  }

  /** @internal */
  public _removeStyle(property: string | string[]): void {
    this._fireChange('attributes', this);
    for (const name of toArray(property)) this._styles.delete(name);
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

function parseAttributes(attrs?: ElementAttributes): Map<string, string> {
  const attrsMap = toMap<string, unknown>(attrs as any);
  const result = new Map<string, string>();
  for (const [key, value] of attrsMap) {
    if (value === null || value === undefined) {
      result.set(key, '');
    } else {
      result.set(key, String(value));
    }
  }
  return result;
}

function parseClasses(classesSet: Set<string>, classesString: string): void {
  const classArray = classesString.split(/\s+/);
  classesSet.clear();
  classArray.forEach(name => {
    if (name) classesSet.add(name);
  });
}

export function parseInlineStyles(stylesMap: Map<string, string>, stylesString: string): void {
  stylesMap.clear();
  let quoteType: string | null = null;
  let propertyNameStart = 0;
  let propertyValueStart = 0;
  let propertyName: string | null = null;
  for (let i = 0; i < stylesString.length; i++) {
    const char = stylesString.charAt(i);
    if (quoteType === null) {
      switch (char) {
        case ':':
          if (!propertyName) {
            propertyName = stylesString.substr(propertyNameStart, i - propertyNameStart);
            propertyValueStart = i + 1;
          }
          break;
        case '"':
        case "'":
          quoteType = char;
          break;
        case ';': {
          const propertyValue = stylesString.substr(propertyValueStart, i - propertyValueStart);
          if (propertyName) {
            stylesMap.set(propertyName.trim(), propertyValue.trim());
          }
          propertyName = null;
          propertyNameStart = i + 1;
          break;
        }
      }
    } else if (char === quoteType) {
      quoteType = null;
    }
  }
  if (propertyName) {
    const propertyValue = stylesString.substr(propertyValueStart);
    if (propertyValue.trim()) stylesMap.set(propertyName.trim(), propertyValue.trim());
  }
}

export function stylesToString(styles: Map<string, string>): string {
  return Array.from(styles)
    .map(([key, value]) => `${key}:${value}`)
    .join(';') + (styles.size ? ';' : '');
}

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
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
