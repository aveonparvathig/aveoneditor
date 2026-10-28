import { Command } from '../../core/command';
import type { Editor } from '../../core/editor';
import type { TableUtils } from './tableutils';
import type { Element as ModelElement } from '../../engine/model/element';

export class InsertTableCommand extends Command {
  public override refresh(): void {
    const model = this.editor.model;
    const selection = model.document.selection;
    const schema = model.schema;
    this.isEnabled = isAllowedInParent(selection, schema);
  }

  public override execute(options: { rows?: number; columns?: number; headingRows?: number; headingColumns?: number } = {}): void {
    const editor = this.editor;
    const model = editor.model;
    const tableUtils = editor.plugins.get('TableUtils') as TableUtils;
    const defaultRows = (editor.config.get('table.defaultHeadings.rows') as number) || 0;
    const defaultColumns = (editor.config.get('table.defaultHeadings.columns') as number) || 0;
    if (options.headingRows === undefined && defaultRows) options.headingRows = defaultRows;
    if (options.headingColumns === undefined && defaultColumns) options.headingColumns = defaultColumns;
    model.change(writer => {
      const table = tableUtils.createTable(writer, options);
      model.insertObject(table, null, null, { findOptimalPosition: 'auto' });
      writer.setSelection(writer.createPositionAt((table.getChild(0) as ModelElement).getChild(0) as ModelElement, 0));
    });
  }
}

function isAllowedInParent(selection: any, schema: any): boolean {
  const positionParent = selection.getFirstPosition().parent;
  const validParent = positionParent === positionParent.root ? positionParent : positionParent.parent;
  return schema.checkChild(validParent, 'table');
}

export class InsertRowCommand extends Command {
  public readonly order: 'above' | 'below';

  constructor(editor: Editor, options: { order?: 'above' | 'below' } = {}) {
    super(editor);
    this.order = options.order || 'below';
  }

  public override refresh(): void {
    const tableUtils = this.editor.plugins.get('TableUtils') as TableUtils;
    this.isEnabled = tableUtils.getSelectionAffectedTableCells(this.editor.model.document.selection).length > 0;
  }

  public override execute(): void {
    const editor = this.editor;
    const tableUtils = editor.plugins.get('TableUtils') as TableUtils;
    const cells = tableUtils.getSelectionAffectedTableCells(editor.model.document.selection);
    const cell = this.order === 'above' ? cells[0] : cells[cells.length - 1];
    const row = cell.parent as ModelElement;
    const table = row.parent as ModelElement;
    const rowIndex = table.getChildIndex(row)!;
    tableUtils.insertRows(table, { at: this.order === 'above' ? rowIndex : rowIndex + 1 });
  }
}

export class InsertColumnCommand extends Command {
  public readonly order: 'left' | 'right';

  constructor(editor: Editor, options: { order?: 'left' | 'right' } = {}) {
    super(editor);
    this.order = options.order || 'right';
  }

  public override refresh(): void {
    const tableUtils = this.editor.plugins.get('TableUtils') as TableUtils;
    this.isEnabled = tableUtils.getSelectionAffectedTableCells(this.editor.model.document.selection).length > 0;
  }

  public override execute(): void {
    const editor = this.editor;
    const tableUtils = editor.plugins.get('TableUtils') as TableUtils;
    const cells = tableUtils.getSelectionAffectedTableCells(editor.model.document.selection);
    const cell = this.order === 'left' ? cells[0] : cells[cells.length - 1];
    const { column } = tableUtils.getCellLocation(cell);
    const table = cell.parent!.parent as ModelElement;
    tableUtils.insertColumns(table, { at: this.order === 'left' ? column : column + 1 });
  }
}

export class RemoveRowCommand extends Command {
  public override refresh(): void {
    const tableUtils = this.editor.plugins.get('TableUtils') as TableUtils;
    const cells = tableUtils.getSelectionAffectedTableCells(this.editor.model.document.selection);
    this.isEnabled = cells.length > 0 && tableUtils.getRows(cells[0].parent!.parent as ModelElement) > 1;
  }

  public override execute(): void {
    const editor = this.editor;
    const model = editor.model;
    const tableUtils = editor.plugins.get('TableUtils') as TableUtils;
    const cells = tableUtils.getSelectionAffectedTableCells(model.document.selection);
    const cell = cells[0];
    const { row, column } = tableUtils.getCellLocation(cell);
    const table = cell.parent!.parent as ModelElement;
    tableUtils.removeRows(table, { at: row });
    model.change(writer => {
      const newRow = (table.getChild(Math.min(row, table.childCount - 1)) as ModelElement) || null;
      if (newRow) {
        const newCell = (newRow.getChild(Math.min(column, newRow.childCount - 1)) as ModelElement) || null;
        if (newCell) writer.setSelection(writer.createPositionAt(newCell, 0));
      }
    });
  }
}

export class RemoveColumnCommand extends Command {
  public override refresh(): void {
    const tableUtils = this.editor.plugins.get('TableUtils') as TableUtils;
    const cells = tableUtils.getSelectionAffectedTableCells(this.editor.model.document.selection);
    this.isEnabled = cells.length > 0 && tableUtils.getColumns(cells[0].parent!.parent as ModelElement) > 1;
  }

  public override execute(): void {
    const editor = this.editor;
    const model = editor.model;
    const tableUtils = editor.plugins.get('TableUtils') as TableUtils;
    const cells = tableUtils.getSelectionAffectedTableCells(model.document.selection);
    const cell = cells[0];
    const { row, column } = tableUtils.getCellLocation(cell);
    const table = cell.parent!.parent as ModelElement;
    tableUtils.removeColumns(table, { at: column });
    model.change(writer => {
      const sameRow = table.getChild(row) as ModelElement;
      const newCell = (sameRow.getChild(Math.min(column, sameRow.childCount - 1)) as ModelElement) || null;
      if (newCell) writer.setSelection(writer.createPositionAt(newCell, 0));
    });
  }
}

export class SetHeaderRowCommand extends Command {
  public override refresh(): void {
    const tableUtils = this.editor.plugins.get('TableUtils') as TableUtils;
    const cells = tableUtils.getSelectionAffectedTableCells(this.editor.model.document.selection);
    this.isEnabled = cells.length > 0;
    this.value = this.isEnabled && cells.every(cell => this._isInHeading(cell, cell.parent!.parent as ModelElement));
  }

  public override execute(options: { forceValue?: boolean } = {}): void {
    if (options.forceValue === this.value) return;
    const editor = this.editor;
    const model = editor.model;
    const tableUtils = editor.plugins.get('TableUtils') as TableUtils;
    const cells = tableUtils.getSelectionAffectedTableCells(model.document.selection);
    const table = cells[0].parent!.parent as ModelElement;
    const { row: rowIndex } = tableUtils.getCellLocation(cells[0]);
    const headingRowsToSet = this.value ? rowIndex : rowIndex + 1;
    model.change(writer => {
      if (headingRowsToSet) {
        writer.setAttribute('headingRows', headingRowsToSet, table);
      } else {
        writer.removeAttribute('headingRows', table);
      }
    });
  }

  private _isInHeading(tableCell: ModelElement, table: ModelElement): boolean {
    const headingRows = Number(table.getAttribute('headingRows') || 0);
    return !!headingRows && (tableCell.parent as ModelElement).index! < headingRows;
  }
}

export class SetHeaderColumnCommand extends Command {
  public override refresh(): void {
    const tableUtils = this.editor.plugins.get('TableUtils') as TableUtils;
    const cells = tableUtils.getSelectionAffectedTableCells(this.editor.model.document.selection);
    this.isEnabled = cells.length > 0;
    this.value = this.isEnabled && cells.every(cell => {
      const table = cell.parent!.parent as ModelElement;
      const headingColumns = Number(table.getAttribute('headingColumns') || 0);
      return tableUtils.getCellLocation(cell).column < headingColumns;
    });
  }

  public override execute(options: { forceValue?: boolean } = {}): void {
    if (options.forceValue === this.value) return;
    const editor = this.editor;
    const model = editor.model;
    const tableUtils = editor.plugins.get('TableUtils') as TableUtils;
    const cells = tableUtils.getSelectionAffectedTableCells(model.document.selection);
    const table = cells[0].parent!.parent as ModelElement;
    const { column } = tableUtils.getCellLocation(cells[0]);
    const headingColumnsToSet = this.value ? column : column + 1;
    model.change(writer => {
      if (headingColumnsToSet) {
        writer.setAttribute('headingColumns', headingColumnsToSet, table);
      } else {
        writer.removeAttribute('headingColumns', table);
      }
    });
  }
}
