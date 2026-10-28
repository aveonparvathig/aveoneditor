import { Operation } from './operation';
import { Position } from '../position';
import { Range } from '../range';
import { SplitOperation } from './splitoperation';
import { _move } from './utils';
import type { Element } from '../element';
import type { Document } from '../document';

/** Merges an element into the previous one: moves its children to the target and removes it to the graveyard. */
export class MergeOperation extends Operation {
  public sourcePosition: Position;
  public howMany: number;
  public targetPosition: Position;
  public graveyardPosition: Position;

  constructor(sourcePosition: Position, howMany: number, targetPosition: Position, graveyardPosition: Position, baseVersion: number | null) {
    super(baseVersion);
    this.sourcePosition = sourcePosition.clone();
    this.sourcePosition.stickiness = 'toPrevious';
    this.howMany = howMany;
    this.targetPosition = targetPosition.clone();
    this.targetPosition.stickiness = 'toNext';
    this.graveyardPosition = graveyardPosition.clone();
  }

  public get type(): string {
    return 'merge';
  }

  public get deletionPosition(): Position {
    return new Position(this.sourcePosition.root, this.sourcePosition.path.slice(0, -1));
  }

  public get movedRange(): Range {
    const end = this.sourcePosition.getShiftedBy(Number.POSITIVE_INFINITY);
    return new Range(this.sourcePosition, end);
  }

  public override clone(): MergeOperation {
    return new MergeOperation(this.sourcePosition, this.howMany, this.targetPosition, this.graveyardPosition, this.baseVersion);
  }

  public override getReversed(): SplitOperation {
    const targetPosition = this.targetPosition._getTransformedByMergeOperation(this);
    const path = this.sourcePosition.path.slice(0, -1);
    const insertionPosition = new Position(this.sourcePosition.root, path)._getTransformedByMergeOperation(this);
    return new SplitOperation(targetPosition, this.howMany, insertionPosition, this.graveyardPosition, this.baseVersion! + 1);
  }

  public override _validate(): void {
    const sourceElement = this.sourcePosition.parent;
    const targetElement = this.targetPosition.parent;
    if (!sourceElement.parent) throw new Error('merge-operation-source-position-invalid');
    if (!targetElement.parent) throw new Error('merge-operation-target-position-invalid');
    if (this.howMany !== sourceElement.maxOffset) throw new Error('merge-operation-how-many-invalid');
  }

  public override _execute(): void {
    const mergedElement = this.sourcePosition.parent as Element;
    const sourceRange = Range._createIn(mergedElement);
    _move(sourceRange, this.targetPosition);
    _move(Range._createOn(mergedElement), this.graveyardPosition);
  }

  public override toJSON(): Record<string, unknown> {
    const json = super.toJSON();
    json.sourcePosition = this.sourcePosition.toJSON();
    json.howMany = this.howMany;
    json.targetPosition = this.targetPosition.toJSON();
    json.graveyardPosition = this.graveyardPosition.toJSON();
    return json;
  }

  public static get className(): string {
    return 'MergeOperation';
  }

  public static override fromJSON(json: any, document: Document): MergeOperation {
    return new MergeOperation(
      Position.fromJSON(json.sourcePosition, document),
      json.howMany,
      Position.fromJSON(json.targetPosition, document),
      Position.fromJSON(json.graveyardPosition, document),
      json.baseVersion
    );
  }
}
