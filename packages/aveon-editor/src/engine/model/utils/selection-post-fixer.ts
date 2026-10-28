import { Range } from '../range';
import { Position } from '../position';
import { Element } from '../element';
import type { Model } from '../model';
import type { Schema } from '../schema';
import type { Writer } from '../writer';
import type { Node } from '../node';

/** Keeps the document selection in places the schema allows. */
export function injectSelectionPostFixer(model: Model): void {
  model.document.registerPostFixer(writer => selectionPostFixer(writer, model));
}

function selectionPostFixer(writer: Writer, model: Model): boolean {
  const selection = model.document.selection;
  const schema = model.schema;
  const ranges: Range[] = [];
  let wasFixed = false;

  for (const modelRange of selection.getRanges()) {
    const correctedRange = tryFixingRange(modelRange, schema);
    if (correctedRange && !correctedRange.isEqual(modelRange)) {
      ranges.push(correctedRange);
      wasFixed = true;
    } else {
      ranges.push(modelRange);
    }
  }

  if (wasFixed) {
    writer.setSelection(mergeIntersectingRanges(ranges), { backward: selection.isBackward });
  }
  return false;
}

export function tryFixingRange(range: Range, schema: Schema): Range | null {
  if (range.isCollapsed) {
    return tryFixingCollapsedRange(range, schema);
  }
  return tryFixingNonCollapsedRage(range, schema);
}

function tryFixingCollapsedRange(range: Range, schema: Schema): Range | null {
  const originalPosition = range.start;
  const nearestSelectionRange = schema.getNearestSelectionRange(originalPosition);
  if (!nearestSelectionRange) {
    const ancestorObject = (originalPosition.getAncestors() as Element[]).reverse().find(item => schema.isObject(item));
    if (ancestorObject) return Range._createOn(ancestorObject);
    return null;
  }
  if (!nearestSelectionRange.isCollapsed) return nearestSelectionRange;
  const fixedPosition = nearestSelectionRange.start;
  if (originalPosition.isEqual(fixedPosition)) return null;
  return new Range(fixedPosition);
}

function tryFixingNonCollapsedRage(range: Range, schema: Schema): Range | null {
  const { start, end } = range;
  const isTextAllowedOnStart = schema.checkChild(start, '$text');
  const isTextAllowedOnEnd = schema.checkChild(end, '$text');
  const startLimitElement = schema.getLimitElement(start);
  const endLimitElement = schema.getLimitElement(end);

  if (startLimitElement === endLimitElement) {
    if (isTextAllowedOnStart && isTextAllowedOnEnd) return null;
    if (checkSelectionOnNonLimitElements(start, end, schema)) {
      const isStartObject = start.nodeAfter && schema.isSelectable(start.nodeAfter as any);
      const fixedStart = isStartObject ? null : schema.getNearestSelectionRange(start, 'forward');
      const isEndObject = end.nodeBefore && schema.isSelectable(end.nodeBefore as any);
      const fixedEnd = isEndObject ? null : schema.getNearestSelectionRange(end, 'backward');
      const rangeStart = fixedStart ? fixedStart.start : start;
      const rangeEnd = fixedEnd ? fixedEnd.end : end;
      return new Range(rangeStart, rangeEnd);
    }
  }

  const isStartInLimit = startLimitElement && !startLimitElement.is('rootElement');
  const isEndInLimit = endLimitElement && !endLimitElement.is('rootElement');

  if (isStartInLimit || isEndInLimit) {
    const bothInSameParent = start.nodeAfter && end.nodeBefore && start.nodeAfter.parent === end.nodeBefore.parent;
    const expandStart = isStartInLimit && (!bothInSameParent || !isInObject(start.nodeAfter!, schema));
    const expandEnd = isEndInLimit && (!bothInSameParent || !isInObject(end.nodeBefore!, schema));
    let fixedStart = start;
    let fixedEnd = end;
    if (expandStart) fixedStart = Position._createBefore(findOutermostLimitAncestor(startLimitElement, schema));
    if (expandEnd) fixedEnd = Position._createAfter(findOutermostLimitAncestor(endLimitElement, schema));
    return new Range(fixedStart, fixedEnd);
  }
  return null;
}

function findOutermostLimitAncestor(startingNode: Element, schema: Schema): Element {
  let isLimitNode = startingNode;
  let parent: Element = isLimitNode;
  while (schema.isLimit(parent) && parent.parent) {
    isLimitNode = parent;
    parent = parent.parent as Element;
  }
  return isLimitNode;
}

function checkSelectionOnNonLimitElements(start: Position, end: Position, schema: Schema): boolean {
  const startIsOnBlock = (start.nodeAfter && !schema.isLimit(start.nodeAfter as any)) || schema.checkChild(start, '$text');
  const endIsOnBlock = (end.nodeBefore && !schema.isLimit(end.nodeBefore as any)) || schema.checkChild(end, '$text');
  return !!startIsOnBlock || !!endIsOnBlock;
}

function isInObject(node: Node, schema: Schema): boolean {
  return !!node.getAncestors({ includeSelf: true }).find(n => schema.isObject(n as any));
}

export function mergeIntersectingRanges(ranges: Range[]): Range[] {
  const result: Range[] = [];
  let previous: Range | null = null;
  for (const range of ranges) {
    if (previous && (previous.isIntersecting(range) || previous.end.isEqual(range.start))) {
      const joined: Range = previous.getJoined(range) || new Range(previous.start, range.end.isAfter(previous.end) ? range.end : previous.end);
      result[result.length - 1] = joined;
      previous = joined;
    } else {
      result.push(range);
      previous = range;
    }
  }
  return result;
}
