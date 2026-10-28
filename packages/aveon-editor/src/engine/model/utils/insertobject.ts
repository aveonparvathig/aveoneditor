import { Element } from '../element';
import { Position, type PositionOffset } from '../position';
import { Range } from '../range';
import { Selection, type Selectable } from '../selection';
import { DocumentSelection } from '../documentselection';
import type { Model } from '../model';
import type { Writer } from '../writer';

export interface InsertObjectOptions {
  findOptimalPosition?: 'auto' | 'before' | 'after';
  setSelection?: 'on' | 'after';
}

/** Inserts an object (image, table, widget) at an optimal position. */
export function insertObject(model: Model, object: Element, selectable?: Selectable | DocumentSelection, placeOrOffset?: PositionOffset | null, options: InsertObjectOptions = {}): Range {
  if (!model.schema.isObject(object)) {
    throw new Error('insertobject-element-not-an-object');
  }
  let originalSelection: Selection | DocumentSelection;
  if (!selectable) {
    originalSelection = model.document.selection;
  } else if (selectable instanceof Selection || selectable instanceof DocumentSelection) {
    originalSelection = selectable;
  } else {
    originalSelection = model.createSelection(selectable as any, placeOrOffset as any);
  }

  let insertionSelection: Selection | DocumentSelection = originalSelection;
  if (options.findOptimalPosition && model.schema.isBlock(object)) {
    insertionSelection = model.createSelection(findOptimalInsertionRange(originalSelection, model, options.findOptimalPosition));
  }

  const firstSelectedBlock = Array.from(originalSelection.getSelectedBlocks())[0];
  const elementAttributes: Record<string, unknown> = {};
  if (firstSelectedBlock) {
    for (const [key, value] of firstSelectedBlock.getAttributes()) {
      if (model.schema.getAttributeProperties(key).copyOnReplace) elementAttributes[key] = value;
    }
  }

  return model.change(writer => {
    if (!insertionSelection.isCollapsed) {
      model.deleteContent(insertionSelection, { doNotAutoparagraph: true });
    }
    let elementToInsert = object;
    const insertionPositionParent = insertionSelection.anchor!.parent;
    if (!model.schema.checkChild(insertionPositionParent as Element, object) && model.schema.checkChild(insertionPositionParent as Element, 'paragraph') && model.schema.checkChild('paragraph', object)) {
      elementToInsert = writer.createElement('paragraph');
      writer.insert(object, elementToInsert);
    }
    model.schema.setAllowedAttributes(elementToInsert, elementAttributes, writer);
    const affectedRange = model.insertContent(elementToInsert, insertionSelection);

    if (affectedRange.isCollapsed) return affectedRange;

    if (options.setSelection) {
      updateSelection(writer, object, options.setSelection, elementAttributes);
    }
    return affectedRange;
  });
}

function updateSelection(writer: Writer, contextElement: Element, place: 'on' | 'after', paragraphAttributes: Record<string, unknown>): void {
  const model = writer.model;
  if (place === 'on') {
    writer.setSelection(contextElement, 'on');
    return;
  }
  if (place !== 'after') throw new Error('insertobject-invalid-place-parameter-value');
  let nextElement = contextElement.nextSibling;
  if (model.schema.isInline(contextElement)) {
    writer.setSelection(contextElement, 'after');
    return;
  }
  const canInsertParagraph = nextElement && model.schema.checkChild(nextElement as Element, '$text');
  if (!canInsertParagraph && model.schema.checkChild(contextElement.parent as Element, 'paragraph')) {
    nextElement = writer.createElement('paragraph');
    model.schema.setAllowedAttributes(nextElement, paragraphAttributes, writer);
    model.insertContent(nextElement, writer.createPositionAfter(contextElement));
  }
  if (nextElement) {
    writer.setSelection(nextElement as Element, 0);
  }
}

/** Returns the optimal range for inserting a block object at the selection. */
export function findOptimalInsertionRange(selection: Selection | DocumentSelection, model: Model, place: 'auto' | 'before' | 'after' = 'auto'): Range {
  const selectedElement = selection.getSelectedElement();
  if (selectedElement && model.schema.isObject(selectedElement) && !model.schema.isInline(selectedElement)) {
    if (place === 'before' || place === 'after') {
      return new Range(Position._createAt(selectedElement, place));
    }
    return Range._createOn(selectedElement);
  }
  const firstBlock = Array.from(selection.getSelectedBlocks())[0] || (selection.getFirstPosition()!.parent as Element);
  if (!firstBlock || !(firstBlock as any).is('element')) {
    return new Range(selection.getFirstPosition()!);
  }
  if (firstBlock.isEmpty) {
    return new Range(Position._createAt(firstBlock, 0));
  }
  const positionAfter = Position._createAfter(firstBlock);
  if (selection.focus!.isTouching(positionAfter)) {
    return new Range(positionAfter);
  }
  return new Range(Position._createBefore(firstBlock));
}
