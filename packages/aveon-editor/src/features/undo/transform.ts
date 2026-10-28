import type { Operation } from '../../engine/model/operation/operation';
import { InsertOperation } from '../../engine/model/operation/insertoperation';
import { MoveOperation } from '../../engine/model/operation/moveoperation';
import { AttributeOperation } from '../../engine/model/operation/attributeoperation';
import { RenameOperation } from '../../engine/model/operation/renameoperation';
import { SplitOperation } from '../../engine/model/operation/splitoperation';
import { MergeOperation } from '../../engine/model/operation/mergeoperation';
import { MarkerOperation } from '../../engine/model/operation/markeroperation';
import { NoOperation } from '../../engine/model/operation/nooperation';
import { Range } from '../../engine/model/range';

/**
 * Transforms an operation so that it can be applied after `by` was applied.
 * This is a position-level transformation sufficient for undo/redo of local changes.
 */
export function transformOperation(op: Operation, by: Operation): Operation[] {
  if (op instanceof InsertOperation) {
    const position = op.position.getTransformedByOperation(by);
    if ((position.root as any).rootName === '$graveyard' && (op.position.root as any).rootName !== '$graveyard') {
      return [new NoOperation(0)];
    }
    const result = new InsertOperation(position, Array.from(op.nodes).map(n => n._clone(true)), 0);
    result.shouldReceiveAttributes = op.shouldReceiveAttributes;
    return [result];
  }
  if (op instanceof MoveOperation) {
    const range = Range._createFromPositionAndShift(op.sourcePosition, op.howMany);
    const ranges = range.getTransformedByOperation(by);
    const target = op.targetPosition.getTransformedByOperation(by);
    return ranges.map(r => new MoveOperation(r.start, r.end.offset - r.start.offset, target, 0)).filter(m => m.howMany > 0);
  }
  if (op instanceof AttributeOperation) {
    const ranges = op.range.getTransformedByOperation(by);
    return ranges.filter(r => !r.isCollapsed).map(r => new AttributeOperation(r, op.key, op.oldValue, op.newValue, 0));
  }
  if (op instanceof RenameOperation) {
    const position = op.position.getTransformedByOperation(by);
    return [new RenameOperation(position, op.oldName, op.newName, 0)];
  }
  if (op instanceof SplitOperation) {
    const splitPosition = op.splitPosition.getTransformedByOperation(by);
    const insertionPosition = SplitOperation.getInsertionPosition(splitPosition);
    const howMany = splitPosition.parent.maxOffset - splitPosition.offset;
    const graveyardPosition = op.graveyardPosition ? op.graveyardPosition.getTransformedByOperation(by) : null;
    return [new SplitOperation(splitPosition, Math.max(0, howMany), insertionPosition, graveyardPosition, 0)];
  }
  if (op instanceof MergeOperation) {
    const sourcePosition = op.sourcePosition.getTransformedByOperation(by);
    const targetPosition = op.targetPosition.getTransformedByOperation(by);
    const graveyardPosition = op.graveyardPosition.getTransformedByOperation(by);
    return [new MergeOperation(sourcePosition, op.howMany, targetPosition, graveyardPosition, 0)];
  }
  if (op instanceof MarkerOperation) {
    const oldRange = op.oldRange ? Range._createFromRanges(op.oldRange.getTransformedByOperation(by)) : null;
    const newRange = op.newRange ? Range._createFromRanges(op.newRange.getTransformedByOperation(by)) : null;
    return [new MarkerOperation(op.name, oldRange, newRange, (op as any)._markers, op.affectsData, 0)];
  }
  return [op.clone()];
}
