import { Range } from './range';
import { Position } from './position';
import { Emitter } from '../../utils/emitter';
import type { Operation } from './operation/operation';
import type { RootElement } from './rootelement';
import type { AttributeOperation } from './operation/attributeoperation';

/** A range that updates itself as the document changes. Fires `change:range` and `change:content`. */
export class LiveRange extends Range {
  private readonly _emitter = new Emitter();

  constructor(start: Position, end?: Position | null) {
    super(start, end);
    bindWithDocument(this);
  }

  public on(event: string, callback: (evt: any, ...args: any[]) => void): void {
    this._emitter.on(event, callback);
  }

  public off(event: string, callback?: (evt: any, ...args: any[]) => void): void {
    this._emitter.off(event, callback);
  }

  public fire(event: string, ...args: any[]): void {
    this._emitter.fire(event, ...args);
  }

  public detach(): void {
    this._emitter.stopListening();
  }

  public toRange(): Range {
    return new Range(this.start, this.end);
  }

  public override is(type: string): boolean {
    return type === 'liveRange' || type === 'model:liveRange' || super.is(type);
  }

  /** @internal */
  public _listenTo(emitter: Emitter, event: string, callback: (evt: any, ...args: any[]) => void, options?: any): void {
    this._emitter.listenTo(emitter, event, callback, options);
  }

  public static fromRange(range: Range): LiveRange {
    return new LiveRange(range.start, range.end);
  }
}

function bindWithDocument(live: LiveRange): void {
  const root = live.root as RootElement;
  if (!root.is('rootElement')) return;
  live._listenTo(
    root.document.model,
    'applyOperation',
    (event, args: [Operation]) => {
      const operation = args[0];
      if (!operation.isDocumentOperation) return;
      transform(live, operation);
    },
    { priority: 'low' }
  );
}

function transform(live: LiveRange, operation: Operation): void {
  const ranges = live.getTransformedByOperation(operation);
  const result = Range._createFromRanges(ranges);
  const boundariesChanged = !result.isEqual(live);
  const contentChanged = doesOperationChangeRangeContent(live, operation);
  let deletionPosition: Position | null = null;

  if (boundariesChanged) {
    if ((result.root as any).rootName === '$graveyard') {
      if (operation.type === 'remove') {
        deletionPosition = (operation as any).sourcePosition;
      } else {
        deletionPosition = (operation as any).deletionPosition;
      }
    }
    const oldRange = live.toRange();
    (live as any).start = result.start;
    (live as any).end = result.end;
    live.fire('change:range', oldRange, { deletionPosition });
  } else if (contentChanged) {
    live.fire('change:content', live.toRange(), { deletionPosition });
  }
}

function doesOperationChangeRangeContent(range: Range, operation: Operation): boolean {
  switch (operation.type) {
    case 'insert':
      return range.containsPosition((operation as any).position);
    case 'move':
    case 'remove':
    case 'reinsert':
      return range.containsPosition((operation as any).sourcePosition) || range.start.isEqual((operation as any).getMovedRangeStart()) || range.containsPosition((operation as any).targetPosition);
    case 'merge':
      return range.containsPosition((operation as any).sourcePosition) || range.containsPosition((operation as any).targetPosition) || range.containsPosition((operation as any).deletionPosition);
    case 'split':
      return range.containsPosition((operation as any).splitPosition) || range.containsPosition((operation as any).insertionPosition);
    case 'addAttribute':
    case 'removeAttribute':
    case 'changeAttribute':
      return range.isIntersecting((operation as AttributeOperation).range);
  }
  return false;
}
