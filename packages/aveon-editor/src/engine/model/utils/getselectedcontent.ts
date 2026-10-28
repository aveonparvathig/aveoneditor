import { DocumentFragment } from '../documentfragment';
import { Element } from '../element';
import { Range } from '../range';
import { TextProxy } from '../textproxy';
import type { Model } from '../model';
import type { Selection } from '../selection';
import type { DocumentSelection } from '../documentselection';
import type { Writer } from '../writer';

/** Returns a document fragment with a copy of the selected content. */
export function getSelectedContent(model: Model, selection: Selection | DocumentSelection): DocumentFragment {
  return model.change(writer => {
    const frag = writer.createDocumentFragment();
    const range = selection.getFirstRange();
    if (!range || range.isCollapsed) return frag;

    const root = range.start.root;
    const commonPath = range.start.getCommonPath(range.end);
    const commonParent = root.getNodeByPath(commonPath) as Element | DocumentFragment;

    let flatSubtreeRange: Range;
    if (range.start.parent === range.end.parent) {
      flatSubtreeRange = range;
    } else {
      flatSubtreeRange = writer.createRange(
        writer.createPositionAt(commonParent, range.start.path[commonPath.length]),
        writer.createPositionAt(commonParent, range.end.path[commonPath.length] + 1)
      );
    }

    const howMany = flatSubtreeRange.end.offset - flatSubtreeRange.start.offset;

    for (const item of flatSubtreeRange.getItems({ shallow: true })) {
      if (item instanceof TextProxy) {
        writer.appendText(item.data, item.getAttributes(), frag);
      } else {
        writer.append(writer.cloneElement(item as Element, true), frag);
      }
    }

    if (flatSubtreeRange !== range) {
      const newRange = range._getTransformedByMove(flatSubtreeRange.start, writer.createPositionAt(frag, 0), howMany)[0];
      const leftExcessRange = writer.createRange(writer.createPositionAt(frag, 0), newRange.start);
      const rightExcessRange = writer.createRange(newRange.end, writer.createPositionAt(frag, 'end'));
      removeRangeContent(rightExcessRange, writer);
      removeRangeContent(leftExcessRange, writer);
    }
    return frag;
  });
}

function removeRangeContent(range: Range, writer: Writer): void {
  const parentsToCheck: Array<Element | DocumentFragment> = [];
  Array.from(range.getItems({ direction: 'backward' }))
    .map(item => writer.createRangeOn(item))
    .filter(itemRange => {
      return (itemRange.start.isAfter(range.start) || itemRange.start.isEqual(range.start)) && (itemRange.end.isBefore(range.end) || itemRange.end.isEqual(range.end));
    })
    .forEach(itemRange => {
      parentsToCheck.push(itemRange.start.parent);
      writer.remove(itemRange);
    });
  parentsToCheck.forEach(parentToCheck => {
    let parent: any = parentToCheck;
    while (parent.parent && parent.isEmpty) {
      const removeRange = writer.createRangeOn(parent);
      parent = parent.parent;
      writer.remove(removeRange);
    }
  });
}
