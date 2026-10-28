import type { Batch } from '../batch';
import type { Document } from '../document';

/** Base class for atomic model changes. */
export abstract class Operation {
  public baseVersion: number | null;
  public batch: Batch | null = null;
  public readonly isDocumentOperation: boolean;

  constructor(baseVersion: number | null) {
    this.baseVersion = baseVersion;
    this.isDocumentOperation = this.baseVersion !== null;
  }

  public abstract get type(): string;

  public abstract clone(): Operation;

  public abstract getReversed(): Operation;

  /** @internal */
  public _validate(): void {
    /* no-op by default */
  }

  /** @internal */
  public abstract _execute(): void;

  public toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = { __className: (this.constructor as any).className, baseVersion: this.baseVersion };
    return json;
  }

  public static fromJSON(_json: any, _document: Document): Operation {
    throw new Error('abstract');
  }
}

export function affectsData(operation: Operation): boolean {
  return operation.type !== 'noop' && operation.type !== 'marker';
}
