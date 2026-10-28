import { Operation } from './operation';

/** An operation that does nothing (keeps version numbering consistent). */
export class NoOperation extends Operation {
  public get type(): string {
    return 'noop';
  }

  public override clone(): NoOperation {
    return new NoOperation(this.baseVersion);
  }

  public override getReversed(): NoOperation {
    return new NoOperation(this.baseVersion! + 1);
  }

  public override _execute(): void {
    /* nothing */
  }

  public static get className(): string {
    return 'NoOperation';
  }

  public static override fromJSON(json: any): NoOperation {
    return new NoOperation(json.baseVersion);
  }
}
