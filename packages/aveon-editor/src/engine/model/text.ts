import { Node, type NodeAttributes } from './node';

/** Model text node. Each character counts as one offset. */
export class Text extends Node {
  private _data: string;

  constructor(data?: string, attrs?: NodeAttributes) {
    super(attrs);
    this._data = data || '';
  }

  public override get offsetSize(): number {
    return this.data.length;
  }

  public get data(): string {
    return this._data;
  }

  public override is(type: string, name?: string): boolean {
    if (name) return false;
    return type === '$text' || type === 'model:$text' || type === 'node' || type === 'model:node';
  }

  public override toJSON(): Record<string, unknown> {
    const json = super.toJSON();
    json.data = this.data;
    return json;
  }

  /** @internal */
  public override _clone(): Text {
    return new Text(this.data, this.getAttributes());
  }

  public static fromJSON(json: { data: string; attributes?: Record<string, unknown> }): Text {
    return new Text(json.data, json.attributes);
  }
}
