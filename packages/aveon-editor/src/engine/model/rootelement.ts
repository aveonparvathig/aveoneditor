import { Element } from './element';
import type { Document } from './document';

/** Root of a model document tree. */
export class RootElement extends Element {
  public readonly rootName: string;
  public readonly document: Document;
  private _isAttached = true;
  private _isLoaded = true;

  constructor(document: Document, name: string, rootName = 'main') {
    super(name);
    this.document = document;
    this.rootName = rootName;
  }

  public override isAttached(): boolean {
    return this._isAttached;
  }

  public get isLoaded(): boolean {
    return this._isLoaded;
  }

  public override is(type: string, name?: string): boolean {
    if (!name) {
      return type === 'rootElement' || type === 'model:rootElement' || type === 'element' || type === 'model:element' || type === 'node' || type === 'model:node';
    }
    return name === this.name && (type === 'rootElement' || type === 'model:rootElement' || type === 'element' || type === 'model:element');
  }

  public override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), rootName: this.rootName } as any;
  }

  /** @internal */
  public _setAttached(value: boolean): void {
    this._isAttached = value;
  }

  /** @internal */
  public _setLoaded(value: boolean): void {
    this._isLoaded = value;
  }
}
