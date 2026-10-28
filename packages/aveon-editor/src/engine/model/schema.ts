import { Observable } from '../../utils/observable';
import { Element } from './element';
import { Text } from './text';
import { TextProxy } from './textproxy';
import { Position } from './position';
import { Range } from './range';
import { DocumentFragment } from './documentfragment';
import type { Node } from './node';
import type { Selection } from './selection';
import type { DocumentSelection } from './documentselection';
import type { Writer } from './writer';
import { TreeWalker, type TreeWalkerValue } from './treewalker';
import type { Item } from './item';

export interface SchemaItemDefinition {
  allowIn?: string | string[];
  allowChildren?: string | string[];
  allowWhere?: string | string[];
  allowContentOf?: string | string[];
  allowAttributes?: string | string[];
  allowAttributesOf?: string | string[];
  inheritTypesFrom?: string | string[];
  inheritAllFrom?: string;
  disallowIn?: string | string[];
  disallowChildren?: string | string[];
  isBlock?: boolean;
  isInline?: boolean;
  isObject?: boolean;
  isLimit?: boolean;
  isSelectable?: boolean;
  isContent?: boolean;
}

export interface SchemaCompiledItemDefinition {
  name: string;
  allowIn: string[];
  allowChildren: string[];
  allowAttributes: string[];
  disallowIn: string[];
  disallowChildren: string[];
  isBlock: boolean;
  isInline: boolean;
  isObject: boolean;
  isLimit: boolean;
  isSelectable: boolean;
  isContent: boolean;
}

export interface AttributeProperties {
  isFormatting?: boolean;
  copyOnEnter?: boolean;
  copyOnReplace?: boolean;
  copyFromObject?: boolean;
  [key: string]: unknown;
}

export type SchemaContextDefinition = Node | Position | SchemaContext | string | Array<string | Node> | DocumentFragment | TextProxy;

export interface SchemaContextItem {
  name: string;
  getAttributeKeys(): Iterable<string>;
  getAttribute(key: string): unknown;
}

export type SchemaChildCheckCallback = (context: SchemaContext, def: SchemaCompiledItemDefinition) => boolean | undefined;
export type SchemaAttributeCheckCallback = (context: SchemaContext, attributeName: string) => boolean | undefined;

/**
 * The schema defines which nodes and attributes are allowed where.
 */
export class Schema extends Observable {
  private _sourceDefinitions: Record<string, SchemaItemDefinition[]> = {};
  private _compiledDefinitions: Record<string, SchemaCompiledItemDefinition> | null = null;
  private _attributeProperties: Record<string, AttributeProperties> = {};
  private _genericChildChecks: SchemaChildCheckCallback[] = [];
  private _genericAttributeChecks: SchemaAttributeCheckCallback[] = [];
  private _childChecks = new Map<string, SchemaChildCheckCallback[]>();
  private _attributeChecks = new Map<string, SchemaAttributeCheckCallback[]>();

  constructor() {
    super();
    this.decorate('checkChild');
    this.decorate('checkAttribute');
    this.on('checkAttribute', (evt, args: any[]) => {
      args[0] = new SchemaContext(args[0]);
    }, { priority: 'highest' });
    this.on('checkChild', (evt, args: any[]) => {
      args[0] = new SchemaContext(args[0]);
      args[1] = this.getDefinition(args[1]);
    }, { priority: 'highest' });
  }

  public register(itemName: string, definition?: SchemaItemDefinition): void {
    if (this._sourceDefinitions[itemName]) {
      throw new Error(`schema-cannot-register-item-twice: Item "${itemName}" is already registered.`);
    }
    this._sourceDefinitions[itemName] = [{ ...(definition || {}) }];
    this._clearCache();
  }

  public extend(itemName: string, definition: SchemaItemDefinition): void {
    if (!this._sourceDefinitions[itemName]) {
      throw new Error(`schema-cannot-extend-missing-item: Cannot extend "${itemName}" which was not registered.`);
    }
    this._sourceDefinitions[itemName].push({ ...definition });
    this._clearCache();
  }

  public getDefinitions(): Record<string, SchemaCompiledItemDefinition> {
    if (!this._compiledDefinitions) this._compile();
    return this._compiledDefinitions!;
  }

  public getDefinition(item: string | Item | SchemaContextItem | DocumentFragment | Element): SchemaCompiledItemDefinition | undefined {
    let itemName: string;
    if (typeof item === 'string') {
      itemName = item;
    } else if ((item as any).is && ((item as any).is('$text') || (item as any).is('$textProxy'))) {
      itemName = '$text';
    } else {
      itemName = (item as any).name;
    }
    return this.getDefinitions()[itemName];
  }

  public isRegistered(item: string | Item | SchemaContextItem): boolean {
    return !!this.getDefinition(item);
  }

  public isBlock(item: string | Item | SchemaContextItem): boolean {
    const def = this.getDefinition(item);
    return !!(def && def.isBlock);
  }

  public isLimit(item: string | Item | SchemaContextItem): boolean {
    const def = this.getDefinition(item);
    if (!def) return false;
    return !!(def.isLimit || def.isObject);
  }

  public isObject(item: string | Item | SchemaContextItem): boolean {
    const def = this.getDefinition(item);
    if (!def) return false;
    return !!(def.isObject || (def.isLimit && def.isSelectable && def.isContent));
  }

  public isInline(item: string | Item | SchemaContextItem): boolean {
    const def = this.getDefinition(item);
    return !!(def && def.isInline);
  }

  public isSelectable(item: string | Item | SchemaContextItem): boolean {
    const def = this.getDefinition(item);
    if (!def) return false;
    return !!(def.isSelectable || def.isObject);
  }

  public isContent(item: string | Item | SchemaContextItem): boolean {
    const def = this.getDefinition(item);
    if (!def) return false;
    return !!(def.isContent || def.isObject);
  }

  /** Checks whether the given node (or node name) is allowed in the given context. */
  public checkChild(context: SchemaContextDefinition, def: string | Node | SchemaCompiledItemDefinition): boolean {
    // Decorated: context is a SchemaContext and def a compiled definition here.
    if (!def) return false;
    const definition = def as SchemaCompiledItemDefinition;
    const ctx = context as unknown as SchemaContext;
    return this._checkContextMatch(definition, ctx);
  }

  public checkAttribute(context: SchemaContextDefinition, attributeName: string): boolean {
    const ctx = context as unknown as SchemaContext;
    const def = this.getDefinition(ctx.last);
    if (!def) return false;
    const checks = this._attributeChecks.get(attributeName) || [];
    for (const callback of [...checks, ...this._genericAttributeChecks]) {
      const result = callback(ctx, attributeName);
      if (typeof result === 'boolean') return result;
    }
    return def.allowAttributes.includes(attributeName);
  }

  public checkMerge(positionOrBaseElement: Position | Element, elementToMerge?: Element): boolean {
    if (positionOrBaseElement instanceof Position) {
      const nodeBefore = positionOrBaseElement.nodeBefore;
      const nodeAfter = positionOrBaseElement.nodeAfter;
      if (!(nodeBefore instanceof Element)) return false;
      if (!(nodeAfter instanceof Element)) return false;
      return this.checkMerge(nodeBefore, nodeAfter);
    }
    const baseElement = positionOrBaseElement;
    if (this.isObject(baseElement) || this.isObject(elementToMerge!)) return false;
    for (const child of elementToMerge!.getChildren()) {
      if (!this.checkChild(baseElement, child)) return false;
    }
    return true;
  }

  public addChildCheck(callback: SchemaChildCheckCallback, childName?: string): void {
    if (childName) {
      if (!this._childChecks.has(childName)) this._childChecks.set(childName, []);
      this._childChecks.get(childName)!.push(callback);
    } else {
      this._genericChildChecks.push(callback);
    }
  }

  public addAttributeCheck(callback: SchemaAttributeCheckCallback, attributeName?: string): void {
    if (attributeName) {
      if (!this._attributeChecks.has(attributeName)) this._attributeChecks.set(attributeName, []);
      this._attributeChecks.get(attributeName)!.push(callback);
    } else {
      this._genericAttributeChecks.push(callback);
    }
  }

  public setAttributeProperties(attributeName: string, properties: AttributeProperties): void {
    this._attributeProperties[attributeName] = Object.assign(this.getAttributeProperties(attributeName), properties);
  }

  public getAttributeProperties(attributeName: string): AttributeProperties {
    return this._attributeProperties[attributeName] || {};
  }

  /** Returns the closest limit element containing the selection or position. */
  public getLimitElement(selectionOrRangeOrPosition: Selection | DocumentSelection | Range | Position): Element {
    let element: Element;
    if (selectionOrRangeOrPosition instanceof Position) {
      element = selectionOrRangeOrPosition.parent as Element;
    } else {
      const ranges = selectionOrRangeOrPosition instanceof Range ? [selectionOrRangeOrPosition] : Array.from(selectionOrRangeOrPosition.getRanges());
      element = ranges.reduce((el: Element | null, range) => {
        const rangeCommonAncestor = range.getCommonAncestor() as Element;
        if (!el) return rangeCommonAncestor;
        return el.getCommonAncestor(rangeCommonAncestor, { includeSelf: true }) as Element;
      }, null)!;
    }
    while (!this.isLimit(element)) {
      if (element.parent) {
        element = element.parent as Element;
      } else {
        break;
      }
    }
    return element;
  }

  public checkAttributeInSelection(selection: Selection | DocumentSelection, attribute: string): boolean {
    if (selection.isCollapsed) {
      const firstPosition = selection.getFirstPosition()!;
      const context = [...(firstPosition.getAncestors() as any), new Text('', selection.getAttributes())];
      return this.checkAttribute(context as any, attribute);
    }
    const ranges = selection.getRanges();
    for (const range of ranges) {
      for (const value of range) {
        if (this.checkAttribute(value.item as any, attribute)) return true;
      }
    }
    return false;
  }

  /** Narrows ranges to those parts where the attribute is allowed. */
  public *getValidRanges(ranges: Iterable<Range>, attribute: string): IterableIterator<Range> {
    ranges = convertToMinimalFlatRanges(ranges);
    for (const range of ranges) {
      yield* this._getValidRangesForRange(range, attribute);
    }
  }

  /** Finds the nearest position where a selection can be placed or an object that can be selected. */
  public getNearestSelectionRange(position: Position, direction: 'both' | 'forward' | 'backward' = 'both'): Range | null {
    if ((position.root as any).rootName === '$graveyard') return null;
    if (this.checkChild(position, '$text')) return new Range(position);

    let backwardWalker: TreeWalker | undefined;
    let forwardWalker: TreeWalker | undefined;
    const limit = (position.getAncestors() as Element[]).reverse().find(item => this.isLimit(item)) || (position.root as Element);

    if (direction === 'both' || direction === 'backward') {
      backwardWalker = new TreeWalker({ boundaries: Range._createIn(limit), startPosition: position, direction: 'backward' });
    }
    if (direction === 'both' || direction === 'forward') {
      forwardWalker = new TreeWalker({ boundaries: Range._createIn(limit), startPosition: position });
    }

    for (const data of combineWalkers(backwardWalker, forwardWalker)) {
      const type = (data.walker === backwardWalker ? 'elementEnd' : 'elementStart');
      const value = data.value;
      if (value.type === type && this.isObject(value.item as Element)) {
        return Range._createOn(value.item as Element);
      }
      if (this.checkChild(value.nextPosition, '$text')) {
        return new Range(value.nextPosition);
      }
    }
    return null;
  }

  /** Finds a parent (from the position upwards) where the node is allowed. */
  public findAllowedParent(position: Position, node: Node | string): Element | null {
    let parent: Element | DocumentFragment | null = position.parent;
    while (parent) {
      if (this.checkChild(parent as Element, node)) return parent as Element;
      if (this.isLimit(parent as Element)) return null;
      parent = parent.parent;
    }
    return null;
  }

  /** Sets attributes allowed by the schema on the given nodes. */
  public setAllowedAttributes(node: Node, attributes: Record<string, unknown>, writer: Writer): void {
    const model = writer.model;
    for (const [attributeName, attributeValue] of Object.entries(attributes)) {
      if (model.schema.checkAttribute(node as any, attributeName)) {
        writer.setAttribute(attributeName, attributeValue, node);
      }
    }
  }

  /** Removes attributes disallowed by the schema. */
  public removeDisallowedAttributes(nodes: Iterable<Node>, writer: Writer): void {
    for (const node of nodes) {
      if (node.is('$text')) {
        removeDisallowedAttributeFromNode(this, node, writer);
      } else {
        const rangeInNode = Range._createIn(node as Element);
        const descendants = rangeInNode.getItems({ shallow: true });
        for (const descendant of [node, ...descendants]) {
          removeDisallowedAttributeFromNode(this, descendant as Node, writer);
        }
      }
    }
  }

  public getAttributesWithProperty(node: Item, propertyName: string, propertyValue?: unknown): Record<string, unknown> {
    const attributes: Record<string, unknown> = {};
    for (const [attributeName, attributeValue] of node.getAttributes()) {
      const attributeProperties = this.getAttributeProperties(attributeName);
      if (attributeProperties[propertyName] === undefined) continue;
      if (propertyValue === undefined || propertyValue === attributeProperties[propertyName]) {
        attributes[attributeName] = attributeValue;
      }
    }
    return attributes;
  }

  public createContext(context: SchemaContextDefinition): SchemaContext {
    return new SchemaContext(context);
  }

  private _clearCache(): void {
    this._compiledDefinitions = null;
  }

  private _compile(): void {
    const compiled: Record<string, SchemaCompiledItemDefinition> = {};
    const sources: Record<string, SchemaItemDefinition[]> = {};
    const names = Object.keys(this._sourceDefinitions);

    // Expand inheritAllFrom into the four inheritance rules.
    for (const name of names) {
      sources[name] = [];
      for (const def of this._sourceDefinitions[name]) {
        const copy: SchemaItemDefinition = { ...def };
        if (copy.inheritAllFrom) {
          copy.allowWhere = [...toArray(copy.allowWhere), copy.inheritAllFrom];
          copy.allowContentOf = [...toArray(copy.allowContentOf), copy.inheritAllFrom];
          copy.allowAttributesOf = [...toArray(copy.allowAttributesOf), copy.inheritAllFrom];
          copy.inheritTypesFrom = [...toArray(copy.inheritTypesFrom), copy.inheritAllFrom];
          delete copy.inheritAllFrom;
        }
        sources[name].push(copy);
      }
      compiled[name] = {
        name,
        allowIn: [],
        allowChildren: [],
        allowAttributes: [],
        disallowIn: [],
        disallowChildren: [],
        isBlock: false,
        isInline: false,
        isObject: false,
        isLimit: false,
        isSelectable: false,
        isContent: false
      };
    }

    // Base rules.
    for (const name of names) {
      const item = compiled[name];
      for (const def of sources[name]) {
        for (const allowIn of toArray(def.allowIn)) pushUnique(item.allowIn, allowIn);
        for (const disallowIn of toArray(def.disallowIn)) pushUnique(item.disallowIn, disallowIn);
        for (const attr of toArray(def.allowAttributes)) pushUnique(item.allowAttributes, attr);
        for (const child of toArray(def.allowChildren)) {
          if (compiled[child]) pushUnique(compiled[child].allowIn, name);
        }
        for (const child of toArray(def.disallowChildren)) {
          if (compiled[child]) pushUnique(compiled[child].disallowIn, name);
        }
        if (def.isBlock) item.isBlock = true;
        if (def.isInline) item.isInline = true;
        if (def.isObject) item.isObject = true;
        if (def.isLimit) item.isLimit = true;
        if (def.isSelectable) item.isSelectable = true;
        if (def.isContent) item.isContent = true;
      }
    }

    // Inheritance rules, resolved iteratively because items reference each other.
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 100) {
      changed = false;
      for (const name of names) {
        const item = compiled[name];
        for (const def of sources[name]) {
          for (const ref of toArray(def.allowWhere)) {
            const refItem = compiled[ref];
            if (!refItem) continue;
            for (const allowIn of refItem.allowIn) {
              if (pushUnique(item.allowIn, allowIn)) changed = true;
            }
          }
          for (const ref of toArray(def.allowContentOf)) {
            for (const other of names) {
              if (compiled[other].allowIn.includes(ref)) {
                if (pushUnique(compiled[other].allowIn, name)) changed = true;
              }
            }
          }
          for (const ref of toArray(def.allowAttributesOf)) {
            const refItem = compiled[ref];
            if (!refItem) continue;
            for (const attr of refItem.allowAttributes) {
              if (pushUnique(item.allowAttributes, attr)) changed = true;
            }
          }
          for (const ref of toArray(def.inheritTypesFrom)) {
            const refItem = compiled[ref];
            if (!refItem) continue;
            for (const flag of ['isBlock', 'isInline', 'isObject', 'isLimit', 'isSelectable', 'isContent'] as const) {
              if (refItem[flag] && !item[flag]) {
                item[flag] = true;
                changed = true;
              }
            }
          }
        }
      }
    }

    for (const name of names) {
      const item = compiled[name];
      item.allowChildren = names.filter(other => compiled[other].allowIn.includes(name) && !compiled[other].disallowIn.includes(name));
    }

    this._compiledDefinitions = compiled;
  }

  private _checkContextMatch(def: SchemaCompiledItemDefinition, context: SchemaContext): boolean {
    const checks = this._childChecks.get(def.name) || [];
    for (const callback of [...checks, ...this._genericChildChecks]) {
      const result = callback(context, def);
      if (typeof result === 'boolean') return result;
    }
    const parent = context.last;
    if (!parent) return false;
    if (def.disallowIn.includes(parent.name)) return false;
    return def.allowIn.includes(parent.name);
  }

  private *_getValidRangesForRange(range: Range, attribute: string): IterableIterator<Range> {
    let start = range.start;
    let end = range.start;
    for (const item of range.getItems({ shallow: true })) {
      if ((item as Element).is('element')) {
        yield* this._getValidRangesForRange(Range._createIn(item as Element), attribute);
      }
      if (!this.checkAttribute(item as any, attribute)) {
        if (!start.isEqual(end)) yield new Range(start, end);
        start = Position._createAfter(item as any);
      }
      end = Position._createAfter(item as any);
    }
    if (!start.isEqual(end)) yield new Range(start, end);
  }
}

/** A list of ancestors (and the item itself) used when checking the schema. */
export class SchemaContext implements Iterable<SchemaContextItem> {
  private _items: SchemaContextItem[];

  constructor(context: SchemaContextDefinition) {
    if (context instanceof SchemaContext) {
      this._items = context._items.slice();
      return;
    }
    if (typeof context === 'string') {
      context = [context];
    } else if (!Array.isArray(context)) {
      // Position, node, text proxy or document fragment.
      if ((context as any).is && (context as any).is('position')) {
        context = (context as Position).getAncestors() as any;
      } else if ((context as any).is && (context as any).is('documentFragment')) {
        context = [context as any];
      } else {
        context = (context as any).getAncestors({ includeSelf: true });
      }
    }
    this._items = (context as Array<string | Node | DocumentFragment>).map(mapContextItem);
  }

  public get length(): number {
    return this._items.length;
  }

  public get last(): SchemaContextItem {
    return this._items[this._items.length - 1];
  }

  public [Symbol.iterator](): Iterator<SchemaContextItem> {
    return this._items[Symbol.iterator]();
  }

  public push(item: string | Node): SchemaContext {
    const ctx = new SchemaContext([]);
    ctx._items = [...this._items, mapContextItem(item)];
    return ctx;
  }

  public trimLast(): SchemaContext {
    const ctx = new SchemaContext([]);
    ctx._items = this._items.slice(0, -1);
    return ctx;
  }

  public getItem(index: number): SchemaContextItem {
    return this._items[index];
  }

  public *getNames(): IterableIterator<string> {
    yield* this._items.map(item => item.name);
  }

  public endsWith(query: string): boolean {
    return Array.from(this.getNames()).join(' ').endsWith(query);
  }

  public startsWith(query: string): boolean {
    return Array.from(this.getNames()).join(' ').startsWith(query);
  }
}

function mapContextItem(ctxItem: string | Node | DocumentFragment | SchemaContextItem): SchemaContextItem {
  if (typeof ctxItem === 'string' || (ctxItem as any).is?.('documentFragment')) {
    return {
      name: typeof ctxItem === 'string' ? ctxItem : '$documentFragment',
      *getAttributeKeys() {},
      getAttribute() {
        return undefined;
      }
    };
  }
  if (typeof (ctxItem as any).getAttributeKeys === 'function' && typeof (ctxItem as any).name === 'string' && !(ctxItem as any).is) {
    return ctxItem as SchemaContextItem;
  }
  const node = ctxItem as Node;
  return {
    name: node.is('$text') || node.is('$textProxy') ? '$text' : (node as Element).name,
    *getAttributeKeys() {
      yield* node.getAttributeKeys();
    },
    getAttribute(key: string) {
      return node.getAttribute(key);
    }
  };
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function pushUnique(arr: string[], item: string): boolean {
  if (arr.includes(item)) return false;
  arr.push(item);
  return true;
}

function removeDisallowedAttributeFromNode(schema: Schema, node: Node, writer: Writer): void {
  for (const attribute of Array.from(node.getAttributeKeys())) {
    if (!schema.checkAttribute(node as any, attribute)) {
      writer.removeAttribute(attribute, node);
    }
  }
}

function* convertToMinimalFlatRanges(ranges: Iterable<Range>): IterableIterator<Range> {
  for (const range of ranges) {
    yield* range.getMinimalFlatRanges();
  }
}

function* combineWalkers(backward?: TreeWalker, forward?: TreeWalker): IterableIterator<{ walker: TreeWalker; value: TreeWalkerValue }> {
  let done = false;
  while (!done) {
    done = true;
    if (backward) {
      const step = backward.next();
      if (!step.done) {
        done = false;
        yield { walker: backward, value: step.value };
      }
    }
    if (forward) {
      const step = forward.next();
      if (!step.done) {
        done = false;
        yield { walker: forward, value: step.value };
      }
    }
  }
}
