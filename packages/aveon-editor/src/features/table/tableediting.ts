import { Plugin } from '../../core/plugin';
import { TableUtils } from './tableutils';
import { InsertTableCommand, InsertRowCommand, InsertColumnCommand, RemoveRowCommand, RemoveColumnCommand, SetHeaderRowCommand, SetHeaderColumnCommand } from './tablecommands';
import { toWidget, toWidgetEditable } from '../widget/utils';
import { Widget } from '../widget/widget';
import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Element as ViewElement } from '../../engine/view/element';
import type { EventInfo } from '../../utils/eventinfo';
import type { UpcastConversionApi, UpcastConversionData } from '../../engine/conversion/upcastdispatcher';
import type { Writer } from '../../engine/model/writer';

/** Table editing: schema, converters, commands and post-fixers. */
export class TableEditing extends Plugin {
  public static override get pluginName(): string {
    return 'TableEditing';
  }

  public static override get requires() {
    return [TableUtils, Widget];
  }

  public override init(): void {
    const editor = this.editor;
    const model = editor.model;
    const schema = model.schema;
    const conversion = editor.conversion;
    const t = editor.t;

    schema.register('table', { inheritAllFrom: '$blockObject', allowAttributes: ['headingRows', 'headingColumns', 'caption'] });
    schema.register('tableRow', { allowIn: 'table', isLimit: true });
    schema.register('tableCell', { allowIn: 'tableRow', allowChildren: '$block', allowAttributes: ['colspan', 'rowspan'], isLimit: true, isSelectable: true });
    schema.extend('$container', { allowIn: 'tableCell' });

    conversion.for('upcast').add(dispatcher => dispatcher.on('element:table', upcastTable()));
    conversion.for('upcast').add(dispatcher => dispatcher.on('element:figure', upcastTableCaption(), { priority: 'high' }));

    conversion.for('editingDowncast').elementToStructure({
      model: 'table',
      view: (modelElement, { writer }) => {
        const figure = writer.createContainerElement('figure', { class: 'table' });
        const table = writer.createContainerElement('table');
        const tbody = writer.createContainerElement('tbody');
        writer.insert(writer.createPositionAt(figure, 0), table);
        writer.insert(writer.createPositionAt(table, 0), tbody);
        writer.insert(writer.createPositionAt(tbody, 0), writer.createSlot());
        const caption = String(modelElement.getAttribute('caption') || '');
        if (caption) {
          // A UI element: shown in the widget but invisible to the model mapping.
          const figcaption = writer.createUIElement('figcaption', { class: 'ck-table-caption' }, function (this: any, domDocument: Document) {
            const dom = this.toDomElement(domDocument);
            dom.textContent = caption;
            return dom;
          });
          writer.insert(writer.createPositionAt(figure, 'end'), figcaption);
        }
        return toWidget(figure, writer, { hasSelectionHandle: true, label: t('table widget') });
      }
    });
    conversion.for('dataDowncast').elementToStructure({
      model: 'table',
      view: (modelElement, { writer }) => {
        const figure = writer.createContainerElement('figure', { class: 'table' });
        const table = writer.createContainerElement('table');
        const headingRows = Number(modelElement.getAttribute('headingRows') || 0);
        writer.insert(writer.createPositionAt(figure, 0), table);
        if (headingRows > 0) {
          const thead = writer.createContainerElement('thead');
          writer.insert(writer.createPositionAt(table, 'end'), thead);
          writer.insert(writer.createPositionAt(thead, 0), writer.createSlot((row: any) => row.index < headingRows));
        }
        if (headingRows < modelElement.childCount) {
          const tbody = writer.createContainerElement('tbody');
          writer.insert(writer.createPositionAt(table, 'end'), tbody);
          writer.insert(writer.createPositionAt(tbody, 0), writer.createSlot((row: any) => row.index >= headingRows));
        }
        const caption = String(modelElement.getAttribute('caption') || '');
        if (caption) {
          const figcaption = writer.createContainerElement('figcaption');
          writer.insert(writer.createPositionAt(figcaption, 0), writer.createText(caption));
          writer.insert(writer.createPositionAt(figure, 'end'), figcaption);
        }
        return figure;
      }
    });
    conversion.for('downcast').elementToElement({ model: 'tableRow', view: 'tr' });
    conversion.for('editingDowncast').elementToElement({
      model: 'tableCell',
      view: (modelElement, { writer }) => {
        const name = isHeadingCell(modelElement) ? 'th' : 'td';
        const editable = writer.createEditableElement(name, getCellAttributes(modelElement));
        return toWidgetEditable(editable, writer, { label: t('table cell') });
      }
    });
    conversion.for('dataDowncast').elementToElement({
      model: 'tableCell',
      view: (modelElement, { writer }) => writer.createContainerElement(isHeadingCell(modelElement) ? 'th' : 'td', getCellAttributes(modelElement))
    });

    // A single attribute-less paragraph in a cell is rendered without <p>: as a bogus <span> while editing, inline in the data.
    conversion.for('editingDowncast').add(dispatcher => dispatcher.on('insert:paragraph', convertParagraphInTableCell({ asWidget: true }), { priority: 'high' }));
    conversion.for('dataDowncast').add(dispatcher => dispatcher.on('insert:paragraph', convertParagraphInTableCell({ asWidget: false }), { priority: 'high' }));

    editor.commands.add('insertTable', new InsertTableCommand(editor));
    editor.commands.add('insertTableRowAbove', new InsertRowCommand(editor, { order: 'above' }));
    editor.commands.add('insertTableRowBelow', new InsertRowCommand(editor, { order: 'below' }));
    editor.commands.add('insertTableColumnLeft', new InsertColumnCommand(editor, { order: 'left' }));
    editor.commands.add('insertTableColumnRight', new InsertColumnCommand(editor, { order: 'right' }));
    editor.commands.add('removeTableRow', new RemoveRowCommand(editor));
    editor.commands.add('removeTableColumn', new RemoveColumnCommand(editor));
    editor.commands.add('setTableRowHeader', new SetHeaderRowCommand(editor));
    editor.commands.add('setTableColumnHeader', new SetHeaderColumnCommand(editor));

    // Captions live in the table's structure, so a caption change redraws the table.
    model.document.on('change:data', () => {
      for (const change of model.document.differ.getChanges()) {
        if (change.type === 'attribute' && change.attributeKey === 'caption') {
          const table = change.range.start.nodeAfter;
          if (table && (table as any).is('element', 'table')) editor.editing.reconvertItem(table);
        }
      }
    });
    model.document.registerPostFixer(writer => tableCellContentsPostFixer(writer, model));
    model.document.registerPostFixer(writer => tableLayoutPostFixer(writer, model, editor.plugins.get(TableUtils) as TableUtils));
  }
}

/** `<figure class="table"><table>…</table><figcaption>…</figcaption></figure>`: the caption becomes a table attribute. */
function upcastTableCaption() {
  return (evt: any, data: any, conversionApi: any): void => {
    const figure = data.viewItem;
    if (!figure.hasClass('table') || !conversionApi.consumable.test(figure, { name: true })) return;
    const figcaption = [...figure.getChildren()].find((child: any) => child.is('element', 'figcaption'));
    if (!figcaption) return;
    const textOf = (element: any): string => [...element.getChildren()].map((child: any) => (child.is('$text') ? child.data : child.is('element') ? textOf(child) : '')).join('');
    const consumeAll = (element: any) => {
      conversionApi.consumable.consume(element, { name: true });
      for (const child of element.getChildren()) {
        if (child.is('element')) consumeAll(child);
        else if (child.is('$text')) conversionApi.consumable.consume(child);
      }
    };
    const caption = textOf(figcaption).replace(/\s+/g, ' ').trim();
    conversionApi.consumable.consume(figure, { name: true });
    consumeAll(figcaption);
    const { modelRange, modelCursor } = conversionApi.convertChildren(figure, data.modelCursor);
    if (caption && modelRange) {
      for (const item of modelRange.getItems({ shallow: true })) {
        if (item.is('element', 'table')) conversionApi.writer.setAttribute('caption', caption, item);
      }
    }
    data.modelRange = modelRange;
    data.modelCursor = modelCursor;
    evt.stop();
  };
}

function convertParagraphInTableCell(options: { asWidget: boolean }) {
  return (evt: any, data: any, conversionApi: any): void => {
    const item = data.item as ModelElement;
    if (!conversionApi.consumable.test(item, 'insert')) return;
    if (!item.parent || !(item.parent as any).is('element', 'tableCell')) return;
    if (!isSingleParagraphWithoutAttributes(item)) return;
    const { writer, mapper } = conversionApi;
    if (options.asWidget) {
      const viewElement = writer.createContainerElement('span', { class: 'ck-table-bogus-paragraph' });
      mapper.bindElements(item, viewElement);
      writer.insert(mapper.toViewPosition(data.range.start), viewElement);
      conversionApi.consumable.consume(item, 'insert');
    } else {
      // Skip the paragraph wrapper: its children are converted straight into the cell.
      const viewCell = mapper.toViewElement(item.parent);
      if (!viewCell) return;
      mapper.bindElements(item, viewCell);
      conversionApi.consumable.consume(item, 'insert');
    }
  };
}

function isSingleParagraphWithoutAttributes(element: ModelElement): boolean {
  const tableCell = element.parent as ModelElement;
  if (tableCell.childCount !== 1) return false;
  return !Array.from(element.getAttributeKeys()).length;
}

function isHeadingCell(cell: ModelElement): boolean {
  const row = cell.parent as ModelElement;
  const table = row && (row.parent as ModelElement);
  if (!table) return false;
  const headingRows = Number(table.getAttribute('headingRows') || 0);
  const headingColumns = Number(table.getAttribute('headingColumns') || 0);
  return row.index! < headingRows || cell.index! < headingColumns;
}

function getCellAttributes(cell: ModelElement): Record<string, string> {
  const attributes: Record<string, string> = {};
  const colspan = cell.getAttribute('colspan');
  const rowspan = cell.getAttribute('rowspan');
  if (colspan && Number(colspan) > 1) attributes.colspan = String(colspan);
  if (rowspan && Number(rowspan) > 1) attributes.rowspan = String(rowspan);
  return attributes;
}

function upcastTable() {
  return (evt: EventInfo, data: UpcastConversionData, conversionApi: UpcastConversionApi) => {
    const viewTable = data.viewItem as ViewElement;
    if (!conversionApi.consumable.test(viewTable as any, { name: true })) return;
    const { rows, headingRows, headingColumns } = scanTable(viewTable);
    if (!rows.length) return;
    const writer = conversionApi.writer;
    const attributes: Record<string, unknown> = {};
    if (headingColumns) attributes.headingColumns = headingColumns;
    if (headingRows) attributes.headingRows = headingRows;
    const table = writer.createElement('table', attributes);
    if (!conversionApi.safeInsert(table, data.modelCursor)) return;
    conversionApi.consumable.consume(viewTable as any, { name: true });

    for (const viewRow of rows) {
      const modelRow = writer.createElement('tableRow');
      writer.insert(modelRow, writer.createPositionAt(table, 'end'));
      conversionApi.consumable.consume(viewRow as any, { name: true });
      for (const viewCell of Array.from(viewRow.getChildren()) as ViewElement[]) {
        if (!(viewCell as any).is('element') || !['td', 'th'].includes(viewCell.name)) continue;
        conversionApi.consumable.consume(viewCell as any, { name: true });
        const cellAttributes: Record<string, unknown> = {};
        const colspan = viewCell.getAttribute('colspan');
        const rowspan = viewCell.getAttribute('rowspan');
        if (colspan && Number(colspan) > 1) cellAttributes.colspan = Number(colspan);
        if (rowspan && Number(rowspan) > 1) cellAttributes.rowspan = Number(rowspan);
        const modelCell = writer.createElement('tableCell', cellAttributes);
        writer.insert(modelCell, writer.createPositionAt(modelRow, 'end'));
        conversionApi.convertChildren(viewCell, writer.createPositionAt(modelCell, 0));
        if (modelCell.isEmpty) {
          writer.insertElement('paragraph', modelCell);
        }
      }
    }
    conversionApi.updateConversionResult(table, data);
  };
}

function scanTable(viewTable: ViewElement): { rows: ViewElement[]; headingRows: number; headingColumns: number } {
  const headRows: ViewElement[] = [];
  const bodyRows: ViewElement[] = [];
  let firstTheadElement: ViewElement | null = null;
  for (const tableChild of Array.from(viewTable.getChildren()) as ViewElement[]) {
    if (!(tableChild as any).is('element')) continue;
    if (tableChild.name === 'tbody' || tableChild.name === 'thead' || tableChild.name === 'tfoot') {
      if (tableChild.name === 'thead' && !firstTheadElement) firstTheadElement = tableChild;
      for (const tr of Array.from(tableChild.getChildren()) as ViewElement[]) {
        if ((tr as any).is('element', 'tr')) {
          if (tableChild === firstTheadElement) headRows.push(tr);
          else bodyRows.push(tr);
        }
      }
    } else if (tableChild.name === 'tr') {
      bodyRows.push(tableChild);
    }
  }
  let headingRows = headRows.length;
  let headingColumns = 0;
  const rows = [...headRows, ...bodyRows];
  // Leading rows made only of <th> count as heading rows; leading <th> columns count as heading columns.
  if (!headingRows) {
    for (const row of rows) {
      const cells = Array.from(row.getChildren()).filter((c: any) => c.is('element') && (c.name === 'td' || c.name === 'th')) as ViewElement[];
      if (cells.length && cells.every(c => c.name === 'th')) headingRows++;
      else break;
    }
  }
  if (rows.length) {
    let columns = Infinity;
    for (const row of rows.slice(headingRows)) {
      const cells = Array.from(row.getChildren()).filter((c: any) => c.is('element') && (c.name === 'td' || c.name === 'th')) as ViewElement[];
      let thCount = 0;
      for (const cell of cells) {
        if (cell.name === 'th') thCount++;
        else break;
      }
      columns = Math.min(columns, thCount);
    }
    headingColumns = rows.length > headingRows && columns !== Infinity ? columns : 0;
  }
  return { rows, headingRows, headingColumns };
}

/** Every table cell must contain at least one block. */
function tableCellContentsPostFixer(writer: Writer, model: any): boolean {
  const changes = model.document.differ.getChanges();
  let wasFixed = false;
  for (const entry of changes) {
    const node = (entry as any).node;
    if (!node || !node.is || !node.is('element')) continue;
    const nodes = [node, ...Array.from(model.createRangeIn(node).getItems())];
    for (const item of nodes) {
      if ((item as any).is && (item as any).is('element', 'tableCell') && (item as any).isEmpty) {
        writer.insertElement('paragraph', item as any);
        wasFixed = true;
      }
      if ((item as any).is && (item as any).is('element', 'tableCell')) {
        for (const child of Array.from((item as any).getChildren()) as any[]) {
          if (child.is('$text')) {
            const paragraph = writer.createElement('paragraph');
            writer.insert(paragraph, writer.createPositionBefore(child));
            writer.move(writer.createRangeOn(child), writer.createPositionAt(paragraph, 0));
            wasFixed = true;
            break;
          }
        }
      }
    }
  }
  return wasFixed;
}

/** All rows must have the same number of cells. */
function tableLayoutPostFixer(writer: Writer, model: any, tableUtils: TableUtils): boolean {
  const changes = model.document.differ.getChanges();
  let wasFixed = false;
  const tables = new Set<ModelElement>();
  for (const entry of changes) {
    const node = (entry as any).node;
    if (!node || !node.is || !node.is('element')) continue;
    if (node.is('element', 'table')) tables.add(node);
    for (const item of model.createRangeIn(node).getItems()) {
      if ((item as any).is && (item as any).is('element', 'table')) tables.add(item as ModelElement);
    }
  }
  for (const table of tables) {
    const rows = Array.from(table.getChildren()).filter(r => (r as any).is('element', 'tableRow')) as ModelElement[];
    if (!rows.length) {
      writer.remove(table);
      wasFixed = true;
      continue;
    }
    const maxColumns = Math.max(...rows.map(row => Array.from(row.getChildren()).reduce((n, c) => n + Number((c as ModelElement).getAttribute('colspan') || 1), 0)));
    for (const row of rows) {
      const columns = Array.from(row.getChildren()).reduce((n, c) => n + Number((c as ModelElement).getAttribute('colspan') || 1), 0);
      for (let i = columns; i < maxColumns; i++) {
        tableUtils.createEmptyTableCell(writer, writer.createPositionAt(row, 'end'));
        wasFixed = true;
      }
    }
  }
  return wasFixed;
}

export type { Editor };
