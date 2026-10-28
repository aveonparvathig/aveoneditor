import { Position, type PositionStickiness } from './position';
import { Emitter } from '../../utils/emitter';
import type { Operation } from './operation/operation';
import type { RootElement } from './rootelement';
import type { Element } from './element';
import type { DocumentFragment } from './documentfragment';

/** A position that updates itself as the document changes. */
export class LivePosition extends Position {
  private readonly _emitter = new Emitter();
  private _listeners: Array<(evt: any, ...args: any[]) => void> = [];

  constructor(root: Element | DocumentFragment, path: number[], stickiness: PositionStickiness = 'toNone') {
    super(root, path, stickiness);
    if (!(this.root as any).is('rootElement')) {
      throw new Error('model-liveposition-root-not-rootelement');
    }
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

  public toPosition(): Position {
    return new Position(this.root, this.path.slice(), this.stickiness);
  }

  public override is(type: string): boolean {
    return type === 'livePosition' || type === 'model:livePosition' || super.is(type);
  }

  /** @internal */
  public _listenTo(emitter: Emitter, event: string, callback: (evt: any, ...args: any[]) => void, options?: any): void {
    this._emitter.listenTo(emitter, event, callback, options);
  }

  public static fromPosition(position: Position, stickiness?: PositionStickiness): LivePosition {
    return new this(position.root, position.path.slice(), stickiness ?? position.stickiness);
  }
}

function bindWithDocument(live: LivePosition): void {
  const model = (live.root as RootElement).document.model;
  live._listenTo(
    model,
    'applyOperation',
    (event, args: [Operation]) => {
      const operation = args[0];
      if (!operation.isDocumentOperation) return;
      transform(live, operation);
    },
    { priority: 'low' }
  );
}

function transform(live: LivePosition, operation: Operation): void {
  const result = live.getTransformedByOperation(operation);
  if (!live.isEqual(result)) {
    const oldPosition = live.toPosition();
    (live as any).path = result.path;
    (live as any).root = result.root;
    live.fire('change', oldPosition);
  }
}
