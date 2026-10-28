import { Node } from './node';
import type { Document } from './document';

/** View text node. */
export class Text extends Node {
  private _textData: string;

  constructor(document: Document, data: string) {
    super(document);
    this._textData = data;
  }

  public get data(): string {
    return this._textData;
  }

  /** @internal */
  public get _data(): string {
    return this.data;
  }

  /** @internal */
  public set _data(data: string) {
    this._fireChange('text', this);
    this._textData = data;
  }

  public override is(type: string, name?: string): boolean {
    if (name) return false;
    return type === '$text' || type === 'view:$text' || type === 'node' || type === 'view:node';
  }

  public override isSimilar(otherNode: Node): boolean {
    if (!(otherNode instanceof Text)) return false;
    return this === otherNode || this.data === otherNode.data;
  }

  public override _clone(): Text {
    return new Text(this.document, this.data);
  }
}
