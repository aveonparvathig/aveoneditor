import { Position } from '../position';
import { Range } from '../range';
import { TreeWalker, type TreeWalkerValue } from '../treewalker';
import { Element } from '../element';
import { DocumentSelection } from '../documentselection';
import type { Selection } from '../selection';
import type { Model } from '../model';
import type { Schema } from '../schema';

export interface ModifySelectionOptions {
  direction?: 'forward' | 'backward';
  unit?: 'character' | 'codePoint' | 'word';
  treatEmojiAsSingleUnit?: boolean;
}

const wordBoundaryCharacters = ' ,.?!:;"-()';

/** Extends the selection focus by a unit in the given direction. */
export function modifySelection(model: Model, selection: Selection | DocumentSelection, options: ModifySelectionOptions = {}): void {
  const schema = model.schema;
  const isForward = options.direction !== 'backward';
  const unit = options.unit ? options.unit : 'character';
  const focus = selection.focus!;

  const walker = new TreeWalker({
    boundaries: getSearchRange(focus, isForward),
    singleCharacters: true,
    direction: isForward ? 'forward' : 'backward'
  });

  const data = { walker, schema, isForward, unit };
  let next: IteratorResult<TreeWalkerValue>;

  while (!(next = walker.next()).done) {
    const position = tryExtendingTo(data, next.value);
    if (position) {
      if (selection instanceof DocumentSelection) {
        model.change(writer => writer.setSelectionFocus(position));
      } else {
        selection.setFocus(position);
      }
      return;
    }
  }
}

function tryExtendingTo(data: { walker: TreeWalker; schema: Schema; isForward: boolean; unit: string }, value: TreeWalkerValue): Position | undefined {
  const { isForward, walker, unit, schema } = data;
  const { type, item, nextPosition } = value;

  if (type === 'text') {
    if (unit === 'word') {
      return getCorrectWordBreakPosition(walker, isForward);
    }
    return nextPosition;
  }

  if (type === (isForward ? 'elementStart' : 'elementEnd')) {
    if (schema.isSelectable(item as Element)) {
      return Position._createAt(item as Element, isForward ? 'after' : 'before');
    }
    if (schema.checkChild(nextPosition, '$text')) {
      return nextPosition;
    }
  } else {
    if (schema.isLimit(item as Element)) {
      walker.skip(() => true);
      return undefined;
    }
    if (schema.checkChild(nextPosition, '$text')) {
      return nextPosition;
    }
  }
  return undefined;
}

function getCorrectWordBreakPosition(walker: TreeWalker, isForward: boolean): Position {
  let textNode: any = walker.position.textNode;
  if (!textNode) {
    textNode = isForward ? walker.position.nodeAfter : walker.position.nodeBefore;
  }
  while (textNode && textNode.is && textNode.is('$text')) {
    const offset = walker.position.offset - textNode.startOffset;
    if (isAtWordBoundary(textNode.data, offset, isForward)) {
      return walker.position;
    }
    const step = walker.next();
    if (step.done) break;
    const nextNode: any = walker.position.textNode || (isForward ? walker.position.nodeAfter : walker.position.nodeBefore);
    if (nextNode !== textNode) {
      // Crossed a boundary into another node, stop at the position.
      return walker.position;
    }
  }
  return walker.position;
}

function isAtWordBoundary(data: string, offset: number, isForward: boolean): boolean {
  const offsetToCheck = offset + (isForward ? 0 : -1);
  return wordBoundaryCharacters.includes(data.charAt(offsetToCheck));
}

function getSearchRange(start: Position, isForward: boolean): Range {
  const root = start.root;
  const searchEnd = Position._createAt(root, isForward ? 'end' : 0);
  if (isForward) return new Range(start, searchEnd);
  return new Range(searchEnd, start);
}
