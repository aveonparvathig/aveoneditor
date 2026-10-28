import { LivePosition } from '../liveposition';
import { Position } from '../position';
import { Range } from '../range';
import { Element } from '../element';
import { DocumentSelection } from '../documentselection';
import type { Model } from '../model';
import type { Selection } from '../selection';
import type { Writer } from '../writer';
import type { Schema } from '../schema';

export interface DeleteContentOptions {
  leaveUnmerged?: boolean;
  doNotResetEntireContent?: boolean;
  doNotAutoparagraph?: boolean;
  direction?: 'forward' | 'backward';
}

/** Deletes the content of the selection and merges the blocks around it. */
export function deleteContent(model: Model, selection: Selection | DocumentSelection, options: DeleteContentOptions = {}): void {
  if (selection.isCollapsed) return;
  const selRange = selection.getFirstRange()!;
  if ((selRange.root as any).rootName === '$graveyard') return;
  const schema = model.schema;

  model.change(writer => {
    if (!options.doNotResetEntireContent && shouldEntireContentBeReplacedWithParagraph(schema, selection)) {
      replaceEntireContentWithParagraph(writer, selection);
      return;
    }

    const attributesForDeleteContent = collectAttributes(model, selection);
    const startPosition = LivePosition.fromPosition(selRange.start, 'toPrevious');
    const endPosition = LivePosition.fromPosition(selRange.end, 'toNext');

    const { shouldKeepFirst, shouldKeepLast } = getPartsToKeep(selRange, schema);

    const range = new Range(startPosition, endPosition);
    const flatRanges = range.getMinimalFlatRanges().reverse();
    for (const flatRange of flatRanges) {
      const rangeContainsObject = flatRange.start.nodeAfter && schema.isObject(flatRange.start.nodeAfter as any);
      void rangeContainsObject;
      writer.remove(flatRange);
    }

    if (!options.leaveUnmerged) {
      mergeBranches(writer, startPosition, endPosition);
      schema.removeDisallowedAttributes(startPosition.parent.getChildren() as any, writer);
    }

    collapseSelectionAt(writer, selection, startPosition);

    if (shouldAutoparagraph(schema, startPosition) && !options.doNotAutoparagraph) {
      insertParagraph(writer, startPosition, selection, attributesForDeleteContent);
    }

    startPosition.detach();
    endPosition.detach();
    void shouldKeepFirst;
    void shouldKeepLast;
  });
}

function getPartsToKeep(_range: Range, _schema: Schema): { shouldKeepFirst: boolean; shouldKeepLast: boolean } {
  return { shouldKeepFirst: true, shouldKeepLast: false };
}

function collectAttributes(model: Model, selection: Selection | DocumentSelection): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  const schema = model.schema;
  const startPosition = selection.getFirstPosition()!;
  const startBlock = startPosition.parent;
  if (startBlock instanceof Element) {
    for (const [key, value] of startBlock.getAttributes()) {
      if (schema.getAttributeProperties(key).copyOnReplace) attributes[key] = value;
    }
  }
  return attributes;
}

function mergeBranches(writer: Writer, startPosition: Position, endPosition: Position): void {
  const model = writer.model;
  if (!checkCanBeMerged(startPosition, endPosition, model.schema)) return;
  const [startAncestor, endAncestor] = getAncestorsJustBelowCommonAncestor(startPosition, endPosition);
  if (!startAncestor || !endAncestor) return;
  if (!model.hasContent(startAncestor, { ignoreMarkers: true }) && model.hasContent(endAncestor, { ignoreMarkers: true })) {
    mergeBranchesRight(writer, startPosition, endPosition, startAncestor.parent as Element);
  } else {
    mergeBranchesLeft(writer, startPosition, endPosition, startAncestor.parent as Element);
  }
}

function mergeBranchesLeft(writer: Writer, startPosition: Position, endPosition: Position, commonAncestor: Element): void {
  const startElement = startPosition.parent as Element;
  const endElement = endPosition.parent as Element;
  if (startElement === commonAncestor || endElement === commonAncestor) return;

  startPosition = writer.createPositionAfter(startElement);
  endPosition = writer.createPositionBefore(endElement);

  if (!endPosition.isEqual(startPosition)) {
    writer.insert(endElement, startPosition);
  }
  writer.merge(startPosition);

  while (endPosition.parent.isEmpty) {
    const parentToRemove = endPosition.parent as Element;
    endPosition = writer.createPositionBefore(parentToRemove);
    writer.remove(parentToRemove);
  }

  if (!checkCanBeMerged(startPosition, endPosition, writer.model.schema)) return;
  mergeBranchesLeft(writer, startPosition, endPosition, commonAncestor);
}

function mergeBranchesRight(writer: Writer, startPosition: Position, endPosition: Position, commonAncestor: Element): void {
  const startElement = startPosition.parent as Element;
  const endElement = endPosition.parent as Element;
  if (startElement === commonAncestor || endElement === commonAncestor) return;

  startPosition = writer.createPositionAfter(startElement);
  endPosition = writer.createPositionBefore(endElement);

  if (!endPosition.isEqual(startPosition)) {
    writer.insert(startElement, endPosition);
  }
  while (startPosition.parent.isEmpty) {
    const parentToRemove = startPosition.parent as Element;
    startPosition = writer.createPositionBefore(parentToRemove);
    writer.remove(parentToRemove);
  }
  endPosition = writer.createPositionBefore(endElement);
  mergeRight(writer, endPosition);

  if (!checkCanBeMerged(startPosition, endPosition, writer.model.schema)) return;
  mergeBranchesRight(writer, startPosition, endPosition, commonAncestor);
}

function mergeRight(writer: Writer, position: Position): void {
  const startElement = position.nodeBefore as Element;
  const endElement = position.nodeAfter as Element;
  if (startElement.name !== endElement.name) {
    writer.rename(startElement, endElement.name);
  }
  writer.clearAttributes(startElement);
  writer.setAttributes(Object.fromEntries(endElement.getAttributes()), startElement);
  writer.merge(position);
}

function checkCanBeMerged(leftPos: Position, rightPos: Position, schema: Schema): boolean {
  const rangeToCheck = new Range(leftPos, rightPos);
  for (const value of rangeToCheck.getWalker()) {
    if (schema.isLimit(value.item as any)) return false;
  }
  return true;
}

function getAncestorsJustBelowCommonAncestor(positionA: Position, positionB: Position): [Element | null, Element | null] {
  const ancestorsA = positionA.getAncestors();
  const ancestorsB = positionB.getAncestors();
  let i = 0;
  while (ancestorsA[i] && ancestorsA[i] === ancestorsB[i]) i++;
  return [ancestorsA[i] as Element | null, ancestorsB[i] as Element | null];
}

function shouldAutoparagraph(schema: Schema, position: Position): boolean {
  const isTextAllowed = schema.checkChild(position, '$text');
  const isParagraphAllowed = schema.checkChild(position, 'paragraph');
  return !isTextAllowed && isParagraphAllowed;
}

function collapseSelectionAt(writer: Writer, selection: Selection | DocumentSelection, positionOrRange: Position | Range): void {
  if (selection instanceof DocumentSelection) {
    writer.setSelection(positionOrRange as any);
  } else {
    (selection as Selection).setTo(positionOrRange as any);
  }
}

function insertParagraph(writer: Writer, position: Position, selection: Selection | DocumentSelection, attributes: Record<string, unknown> = {}): void {
  const paragraph = writer.createElement('paragraph');
  writer.model.schema.setAllowedAttributes(paragraph, attributes, writer);
  writer.insert(paragraph, position);
  collapseSelectionAt(writer, selection, writer.createPositionAt(paragraph, 0));
}

function replaceEntireContentWithParagraph(writer: Writer, selection: Selection | DocumentSelection): void {
  const limitElement = writer.model.schema.getLimitElement(selection);
  writer.remove(writer.createRangeIn(limitElement));
  insertParagraph(writer, writer.createPositionAt(limitElement, 0), selection);
}

function shouldEntireContentBeReplacedWithParagraph(schema: Schema, selection: Selection | DocumentSelection): boolean {
  const limitElement = schema.getLimitElement(selection);
  if (!selection.containsEntireContent(limitElement)) return false;
  const range = selection.getFirstRange()!;
  if (range.start.parent === range.end.parent) return false;
  return schema.checkChild(limitElement, 'paragraph');
}
