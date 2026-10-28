import { Operation } from './operation';
import { Position } from '../position';
import { Range } from '../range';
import { _move } from './utils';
import type { Document } from '../document';

/** Moves a flat range of nodes to another position. Moving to the graveyard removes them. */
export class MoveOperation extends Operation {
  public sourcePosition: Position;
  public howMany: number;
  public targetPosition: Position;

  constructor(sourcePosition: Position, howMany: number, targetPosition: Position, baseVersion: number | null) {
    super(baseVersion);
    this.sourcePosition = sourcePosition.clone();
    this.sourcePosition.stickiness = 'toNext';
    this.howMany = howMany;
    this.targetPosition = targetPosition.clone();
    this.targetPosition.stickiness = 'toNone';
  }

  public get type(): string {
    if ((this.targetPosition.root as any).rootName === '$graveyard') return 'remove';
    if ((this.sourcePosition.root as any).rootName === '$graveyard') return 'reinsert';
    return 'move';
  }

  public override clone(): MoveOperation {
    return new MoveOperation(this.sourcePosition, this.howMany, this.targetPosition, this.baseVersion);
  }

  public getMovedRangeStart(): Position {
    return this.targetPosition._getTransformedByDeletion(this.sourcePosition, this.howMany)!;
  }

  public override getReversed(): MoveOperation {
    const newTargetPosition = this.sourcePosition._getTransformedByInsertion(this.targetPosition, this.howMany);
    return new MoveOperation(this.getMovedRangeStart(), this.howMany, newTargetPosition, this.baseVersion! + 1);
  }

  public override _validate(): void {
    const sourceElement = this.sourcePosition.parent;
    const targetElement = this.targetPosition.parent;
    const sourceOffset = this.sourcePosition.offset;
    const targetOffset = this.targetPosition.offset;
    if (sourceOffset + this.howMany > sourceElement.maxOffset) {
      throw new Error('move-operation-nodes-do-not-exist');
    }
    if (sourceElement === targetElement && sourceOffset < targetOffset && targetOffset < sourceOffset + this.howMany) {
      throw new Error('move-operation-range-into-itself');
    }
    if (this.sourcePosition.root === this.targetPosition.root) {
      const sourcePath = this.sourcePosition.path;
      const targetPath = this.targetPosition.path;
      if (sourcePath.length < targetPath.length) {
        let prefix = true;
        for (let i = 0; i < sourcePath.length - 1; i++) {
          if (sourcePath[i] !== targetPath[i]) {
            prefix = false;
            break;
          }
        }
        if (prefix) {
          const i = sourcePath.length - 1;
          if (sourceOffset <= targetPath[i] && targetPath[i] < sourceOffset + this.howMany) {
            throw new Error('move-operation-node-into-itself');
          }
        }
      }
    }
  }

  public override _execute(): void {
    _move(Range._createFromPositionAndShift(this.sourcePosition, this.howMany), this.targetPosition);
  }

  public override toJSON(): Record<string, unknown> {
    const json = super.toJSON();
    json.sourcePosition = this.sourcePosition.toJSON();
    json.howMany = this.howMany;
    json.targetPosition = this.targetPosition.toJSON();
    return json;
  }

  public static get className(): string {
    return 'MoveOperation';
  }

  public static override fromJSON(json: any, document: Document): MoveOperation {
    return new MoveOperation(Position.fromJSON(json.sourcePosition, document), json.howMany, Position.fromJSON(json.targetPosition, document), json.baseVersion);
  }
}
