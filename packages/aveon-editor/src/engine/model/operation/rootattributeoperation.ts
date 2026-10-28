import { Operation } from './operation';
import type { RootElement } from '../rootelement';
import type { Document } from '../document';

/** Changes an attribute on a root element. */
export class RootAttributeOperation extends Operation {
  public readonly root: RootElement;
  public readonly key: string;
  public readonly oldValue: unknown;
  public readonly newValue: unknown;

  constructor(root: RootElement, key: string, oldValue: unknown, newValue: unknown, baseVersion: number | null) {
    super(baseVersion);
    this.root = root;
    this.key = key;
    this.oldValue = oldValue === undefined ? null : oldValue;
    this.newValue = newValue === undefined ? null : newValue;
  }

  public get type(): string {
    return 'rootAttribute';
  }

  public override clone(): RootAttributeOperation {
    return new RootAttributeOperation(this.root, this.key, this.oldValue, this.newValue, this.baseVersion);
  }

  public override getReversed(): RootAttributeOperation {
    return new RootAttributeOperation(this.root, this.key, this.newValue, this.oldValue, this.baseVersion! + 1);
  }

  public override _execute(): void {
    if (this.newValue !== null) {
      this.root._setAttribute(this.key, this.newValue);
    } else {
      this.root._removeAttribute(this.key);
    }
  }

  public override toJSON(): Record<string, unknown> {
    const json = super.toJSON();
    json.root = this.root.rootName;
    json.key = this.key;
    json.oldValue = this.oldValue;
    json.newValue = this.newValue;
    return json;
  }

  public static get className(): string {
    return 'RootAttributeOperation';
  }

  public static override fromJSON(json: any, document: Document): RootAttributeOperation {
    const root = document.getRoot(json.root);
    if (!root) throw new Error('rootattribute-operation-fromjson-no-root');
    return new RootAttributeOperation(root, json.key, json.oldValue, json.newValue, json.baseVersion);
  }
}
