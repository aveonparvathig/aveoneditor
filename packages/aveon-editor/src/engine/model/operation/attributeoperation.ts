import { Operation } from './operation';
import { Range } from '../range';
import { _setAttribute } from './utils';
import type { Document } from '../document';

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Changes an attribute on all nodes in the range. */
export class AttributeOperation extends Operation {
  public readonly range: Range;
  public readonly key: string;
  public readonly oldValue: unknown;
  public readonly newValue: unknown;

  constructor(range: Range, key: string, oldValue: unknown, newValue: unknown, baseVersion: number | null) {
    super(baseVersion);
    this.range = range.clone();
    this.key = key;
    this.oldValue = oldValue === undefined ? null : oldValue;
    this.newValue = newValue === undefined ? null : newValue;
  }

  public get type(): string {
    if (this.oldValue === null) return 'addAttribute';
    if (this.newValue === null) return 'removeAttribute';
    return 'changeAttribute';
  }

  public override clone(): AttributeOperation {
    return new AttributeOperation(this.range, this.key, this.oldValue, this.newValue, this.baseVersion);
  }

  public override getReversed(): AttributeOperation {
    return new AttributeOperation(this.range, this.key, this.newValue, this.oldValue, this.baseVersion! + 1);
  }

  public override toJSON(): Record<string, unknown> {
    const json = super.toJSON();
    json.range = this.range.toJSON();
    json.key = this.key;
    json.oldValue = this.oldValue;
    json.newValue = this.newValue;
    return json;
  }

  public override _validate(): void {
    if (!this.range.isFlat) throw new Error('attribute-operation-range-not-flat');
    for (const item of this.range.getItems({ shallow: true })) {
      if (this.oldValue !== null && !isEqual(item.getAttribute(this.key), this.oldValue)) {
        throw new Error('attribute-operation-wrong-old-value');
      }
      if (this.oldValue === null && this.newValue !== null && item.hasAttribute(this.key)) {
        throw new Error('attribute-operation-attribute-exists');
      }
    }
  }

  public override _execute(): void {
    if (!isEqual(this.oldValue, this.newValue)) {
      _setAttribute(this.range, this.key, this.newValue);
    }
  }

  public static get className(): string {
    return 'AttributeOperation';
  }

  public static override fromJSON(json: any, document: Document): AttributeOperation {
    return new AttributeOperation(Range.fromJSON(json.range, document), json.key, json.oldValue, json.newValue, json.baseVersion);
  }
}
