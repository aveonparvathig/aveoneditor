import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { Observer } from '../../engine/view/observer/observer';
import { DomEventData } from '../../engine/view/observer/domeventdata';
import { EventInfo } from '../../utils/eventinfo';
import { keyCodes } from '../../utils/keyboard';
import type { EditingView } from '../../engine/view';
import type { Editor } from '../../core/editor';
import type { Writer } from '../../engine/model/writer';
import type { Position } from '../../engine/model/position';
import type { Schema } from '../../engine/model/schema';
import type { Selection } from '../../engine/model/selection';
import type { DocumentSelection } from '../../engine/model/documentselection';
import type { Element } from '../../engine/model/element';

/** Fires `enter` on the view document for Enter keydowns (`isSoft` for Shift+Enter). */
export class EnterObserver extends Observer {
  constructor(view: EditingView) {
    super(view);
    const doc = view.document;
    doc.on('keydown', (evt, data: any) => {
      if (!this.isEnabled || data.keyCode !== keyCodes.enter) return;
      if (doc.isComposing) return;
      const event = new EventInfo(doc, 'enter');
      doc.fire(event, new DomEventData(view, data.domEvent, { isSoft: data.shiftKey }));
      if (event.stopped) evt.stop();
    });
  }

  public observe(): void {
    /* uses keydown */
  }

  public stopObserving(): void {
    /* nothing */
  }
}

/** Splits the current block on Enter. Fires `afterExecute` so features can adjust (e.g. headings → paragraphs). */
export class EnterCommand extends Command {
  public override execute(): void {
    this.editor.model.change(writer => {
      this.enterBlock(writer);
      this.fire('afterExecute', { writer });
    });
  }

  public enterBlock(writer: Writer): boolean {
    const model = this.editor.model;
    const doc = model.document;
    const schema = model.schema;
    const selection = doc.selection;
    const isSelectionEmpty = selection.isCollapsed;
    const range = selection.getFirstRange()!;
    const startElement = range.start.parent as Element;
    const endElement = range.end.parent as Element;

    if (schema.isLimit(startElement) || schema.isLimit(endElement)) {
      if (!isSelectionEmpty) {
        model.deleteContent(selection);
      }
      return false;
    }

    if (isSelectionEmpty) {
      const attributesToCopy = getCopyOnEnterAttributes(schema, selection.getAttributes());
      splitBlock(writer, range.start);
      writer.setSelectionAttribute(attributesToCopy);
      return true;
    }

    const leaveUnmerged = !(range.start.isAtStart && range.end.isAtEnd);
    const isContainedWithinOneElement = startElement === endElement;
    model.deleteContent(selection, { leaveUnmerged });
    if (leaveUnmerged) {
      if (isContainedWithinOneElement) {
        splitBlock(writer, selection.focus!);
        return true;
      }
      writer.setSelection(endElement, 0);
    }
    return false;
  }
}

function splitBlock(writer: Writer, splitPos: Position): void {
  writer.split(splitPos);
  writer.setSelection(splitPos.parent.nextSibling as Element, 0);
}

export function* getCopyOnEnterAttributes(schema: Schema, allAttributes: Iterable<[string, unknown]>): IterableIterator<[string, unknown]> {
  for (const attribute of allAttributes) {
    if (attribute && schema.getAttributeProperties(attribute[0]).copyOnEnter) {
      yield attribute;
    }
  }
}

/** Inserts a soft break (`<br>`) on Shift+Enter. */
export class ShiftEnterCommand extends Command {
  public override execute(): void {
    const model = this.editor.model;
    const doc = model.document;
    model.change(writer => {
      softBreakAction(model, writer, doc.selection);
      this.fire('afterExecute', { writer });
    });
  }

  public override refresh(): void {
    const model = this.editor.model;
    const doc = model.document;
    this.isEnabled = isEnabled(model.schema, doc.selection);
  }
}

function isEnabled(schema: Schema, selection: Selection | DocumentSelection): boolean {
  if (selection.rangeCount > 1) return false;
  const anchorPos = selection.anchor!;
  if (!anchorPos || !schema.checkChild(anchorPos, 'softBreak')) return false;
  const range = selection.getFirstRange()!;
  const startElement = range.start.parent as Element;
  const endElement = range.end.parent as Element;
  if ((isInsideLimitElement(startElement, schema) || isInsideLimitElement(endElement, schema)) && startElement !== endElement) {
    return false;
  }
  return true;
}

function softBreakAction(model: any, writer: Writer, selection: DocumentSelection): void {
  const isSelectionEmpty = selection.isCollapsed;
  const range = selection.getFirstRange()!;
  const startElement = range.start.parent as Element;
  const endElement = range.end.parent as Element;
  const isContainedWithinOneElement = startElement === endElement;
  if (isSelectionEmpty) {
    const attributesToCopy = getCopyOnEnterAttributes(model.schema, selection.getAttributes());
    insertBreak(model, writer, range.end);
    writer.removeSelectionAttribute(selection.getAttributeKeys());
    writer.setSelectionAttribute(attributesToCopy);
  } else {
    const leaveUnmerged = !(range.start.isAtStart && range.end.isAtEnd);
    model.deleteContent(selection, { leaveUnmerged });
    if (isContainedWithinOneElement) {
      insertBreak(model, writer, selection.focus!);
    } else if (leaveUnmerged) {
      writer.setSelection(endElement, 0);
    }
  }
}

function insertBreak(model: any, writer: Writer, position: Position): void {
  const breakLineElement = writer.createElement('softBreak');
  model.insertContent(breakLineElement, position);
  writer.setSelection(breakLineElement, 'after');
}

function isInsideLimitElement(element: Element, schema: Schema): boolean {
  if (element.is('rootElement')) return false;
  return schema.isLimit(element) || isInsideLimitElement(element.parent as Element, schema);
}

/** Enter key handling. */
export class Enter extends Plugin {
  public static override get pluginName(): string {
    return 'Enter';
  }

  public override init(): void {
    const editor = this.editor;
    const view = editor.editing.view;
    const viewDocument = view.document;
    const t = editor.t;
    view.addObserver(EnterObserver);
    editor.commands.add('enter', new EnterCommand(editor));
    this.listenTo(viewDocument, 'enter', (evt, data: any) => {
      if (!viewDocument.isComposing) {
        data.preventDefault();
      }
      if (data.isSoft) return;
      editor.execute('enter');
      view.scrollToTheSelection();
    }, { priority: 'low' });
    void t;
  }
}

/** Shift+Enter (soft break) handling. */
export class ShiftEnter extends Plugin {
  public static override get pluginName(): string {
    return 'ShiftEnter';
  }

  public override init(): void {
    const editor = this.editor;
    const schema = editor.model.schema;
    const conversion = editor.conversion;
    const view = editor.editing.view;
    const viewDocument = view.document;

    schema.register('softBreak', { allowWhere: '$text', isInline: true });
    conversion.for('upcast').elementToElement({ model: 'softBreak', view: 'br' });
    conversion.for('downcast').elementToElement({ model: 'softBreak', view: (modelElement, { writer }) => writer.createEmptyElement('br') });

    view.addObserver(EnterObserver);
    editor.commands.add('shiftEnter', new ShiftEnterCommand(editor));

    this.listenTo(viewDocument, 'enter', (evt, data: any) => {
      if (!viewDocument.isComposing) {
        data.preventDefault();
      }
      if (!data.isSoft) return;
      editor.execute('shiftEnter');
      view.scrollToTheSelection();
    }, { priority: 'low' });
  }
}

export type { Editor };
