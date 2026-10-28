import { Plugin } from '../../core/plugin';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Writer } from '../../engine/model/writer';
import type { Position } from '../../engine/model/position';
import type { Selection } from '../../engine/model/selection';
import type { DocumentSelection } from '../../engine/model/documentselection';

/** Table helpers: create tables, insert/remove rows and columns, find cells. */
export class TableUtils extends Plugin {
  public static override get pluginName(): string {
    return 'TableUtils';
  }

  public createTable(writer: Writer, options: { rows?: number; columns?: number; headingRows?: number; headingColumns?: number } = {}): ModelElement {
    const table = writer.createElement('table');
    const rows = options.rows || 2;
    const columns = options.columns || 2;
    createEmptyRows(writer, table, 0, rows, columns);
    if (options.headingRows) {
      writer.setAttribute('headingRows', Math.min(options.headingRows, rows), table);
    }
    if (options.headingColumns) {
      writer.setAttribute('headingColumns', Math.min(options.headingColumns, columns), table);
    }
    return table;
  }

  public insertRows(table: ModelElement, options: { at?: number; rows?: number; copyStructureFromAbove?: boolean } = {}): void {
    const model = this.editor.model;
    const insertAt = options.at || 0;
    const rowsToInsert = options.rows || 1;
    const rowCount = this.getRows(table);
    if (insertAt > rowCount) throw new Error('tableutils-insertrows-insert-out-of-range');
    model.change(writer => {
      const headingRows = Number(table.getAttribute('headingRows') || 0);
      if (headingRows > insertAt) {
        writer.setAttribute('headingRows', headingRows + rowsToInsert, table);
      }
      const columns = this.getColumns(table);
      createEmptyRows(writer, table, insertAt, rowsToInsert, columns);
    });
  }

  public insertColumns(table: ModelElement, options: { at?: number; columns?: number } = {}): void {
    const model = this.editor.model;
    const insertAt = options.at || 0;
    const columnsToInsert = options.columns || 1;
    model.change(writer => {
      const headingColumns = Number(table.getAttribute('headingColumns') || 0);
      if (insertAt < headingColumns) {
        writer.setAttribute('headingColumns', headingColumns + columnsToInsert, table);
      }
      for (const row of table.getChildren()) {
        if (!(row as any).is('element', 'tableRow')) continue;
        const insertPosition = writer.createPositionAt(row as ModelElement, Math.min(insertAt, (row as ModelElement).childCount));
        createCells(columnsToInsert, writer, insertPosition);
      }
    });
  }

  public removeRows(table: ModelElement, options: { at: number; rows?: number }): void {
    const model = this.editor.model;
    const rowsToRemove = options.rows || 1;
    const first = options.at;
    const last = first + rowsToRemove - 1;
    model.change(writer => {
      for (let i = last; i >= first; i--) {
        const row = table.getChild(i) as ModelElement;
        if (row) writer.remove(row);
      }
      const headingRows = Number(table.getAttribute('headingRows') || 0);
      if (headingRows && first < headingRows) {
        const newRows = Math.max(headingRows - rowsToRemove, 0);
        if (newRows) writer.setAttribute('headingRows', newRows, table);
        else writer.removeAttribute('headingRows', table);
      }
    });
  }

  public removeColumns(table: ModelElement, options: { at: number; columns?: number }): void {
    const model = this.editor.model;
    const first = options.at;
    const columnsToRemove = options.columns || 1;
    model.change(writer => {
      for (const row of table.getChildren()) {
        if (!(row as any).is('element', 'tableRow')) continue;
        for (let i = first + columnsToRemove - 1; i >= first; i--) {
          const cell = (row as ModelElement).getChild(i) as ModelElement;
          if (cell) writer.remove(cell);
        }
      }
      const headingColumns = Number(table.getAttribute('headingColumns') || 0);
      if (headingColumns && first < headingColumns) {
        const newColumns = Math.max(headingColumns - columnsToRemove, 0);
        if (newColumns) writer.setAttribute('headingColumns', newColumns, table);
        else writer.removeAttribute('headingColumns', table);
      }
    });
  }

  public getColumns(table: ModelElement): number {
    const row = table.getChild(0) as ModelElement | null;
    if (!row) return 0;
    return Array.from(row.getChildren()).reduce((columns, cell) => columns + Number((cell as ModelElement).getAttribute('colspan') || 1), 0);
  }

  public getRows(table: ModelElement): number {
    return Array.from(table.getChildren()).filter(child => (child as any).is('element', 'tableRow')).length;
  }

  public createEmptyTableCell(writer: Writer, insertPosition: Position, attributes: Record<string, unknown> = {}): ModelElement {
    const tableCell = writer.createElement('tableCell', attributes);
    writer.insertElement('paragraph', tableCell);
    writer.insert(tableCell, insertPosition);
    return tableCell;
  }

  /** Returns the table cell(s) affected by the selection (the cell containing the selection or selected cells). */
  public getSelectionAffectedTableCells(selection: Selection | DocumentSelection): ModelElement[] {
    const selectedElement = selection.getSelectedElement();
    if (selectedElement && (selectedElement as any).is('element', 'tableCell')) return [selectedElement];
    const cell = selection.getFirstPosition()!.findAncestor('tableCell');
    return cell ? [cell] : [];
  }

  public getCellLocation(tableCell: ModelElement): { row: number; column: number } {
    const row = tableCell.parent as ModelElement;
    const table = row.parent as ModelElement;
    return { row: table.getChildIndex(row)!, column: row.getChildIndex(tableCell)! };
  }
}

function createEmptyRows(writer: Writer, table: ModelElement, insertAt: number, rows: number, columns: number): void {
  for (let i = 0; i < rows; i++) {
    const tableRow = writer.createElement('tableRow');
    writer.insert(tableRow, table, insertAt);
    createCells(columns, writer, writer.createPositionAt(tableRow, 'end'));
  }
}

function createCells(cells: number, writer: Writer, insertPosition: Position): void {
  for (let i = 0; i < cells; i++) {
    const tableCell = writer.createElement('tableCell');
    writer.insertElement('paragraph', tableCell);
    writer.insert(tableCell, insertPosition);
  }
}
