import { Plugin } from '../../core/plugin';
import { TableEditing } from './tableediting';
import { TableUI } from './tableui';
import { TableUtils } from './tableutils';
import { Widget } from '../widget/widget';
import { isWidget } from '../widget/utils';
import { WidgetToolbarRepository } from '../widget/widgettoolbarrepository';
import { keyCodes } from '../../utils/keyboard';
import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Element as ViewElement } from '../../engine/view/element';

/** Tab / Shift+Tab navigation between cells. */
export class TableKeyboard extends Plugin {
  public static override get pluginName(): string {
    return 'TableKeyboard';
  }

  public static override get requires() {
    return [TableUtils];
  }

  public override init(): void {
    const editor = this.editor;
    const view = editor.editing.view;
    this.listenTo(view.document, 'tab', (evt, data: any) => {
      const model = editor.model;
      const tableUtils = editor.plugins.get(TableUtils) as TableUtils;
      const selection = model.document.selection;
      const cells = tableUtils.getSelectionAffectedTableCells(selection);
      if (!cells.length) return;
      data.preventDefault();
      data.stopPropagation();
      evt.stop();
      const tableCell = cells[0];
      const tableRow = tableCell.parent as ModelElement;
      const table = tableRow.parent as ModelElement;
      const currentRowIndex = table.getChildIndex(tableRow)!;
      const currentCellIndex = tableRow.getChildIndex(tableCell)!;
      const isForward = !data.shiftKey;
      const isFirstCellInRow = currentCellIndex === 0;
      if (!isForward && isFirstCellInRow && currentRowIndex === 0) return;
      const isLastCellInRow = currentCellIndex === tableRow.childCount - 1;
      const isLastRow = currentRowIndex === tableUtils.getRows(table) - 1;
      if (isForward && isLastRow && isLastCellInRow) {
        editor.execute('insertTableRowBelow');
        if (currentRowIndex === tableUtils.getRows(table) - 1) {
          // Insert failed; stay.
        }
      }
      let cellToFocus: ModelElement;
      if (isForward && isLastCellInRow) {
        const nextRow = table.getChild(currentRowIndex + 1) as ModelElement;
        cellToFocus = nextRow.getChild(0) as ModelElement;
      } else if (!isForward && isFirstCellInRow) {
        const previousRow = table.getChild(currentRowIndex - 1) as ModelElement;
        cellToFocus = previousRow.getChild(previousRow.childCount - 1) as ModelElement;
      } else {
        cellToFocus = tableRow.getChild(currentCellIndex + (isForward ? 1 : -1)) as ModelElement;
      }
      model.change(writer => {
        writer.setSelection(writer.createRangeIn(cellToFocus));
      });
    }, { context: ['th', 'td'] });
  }
}

/** Contextual toolbar for tables (`config.table.contentToolbar`). */
export class TableToolbar extends Plugin {
  public static override get requires() {
    return [WidgetToolbarRepository];
  }

  public static override get pluginName(): string {
    return 'TableToolbar';
  }

  constructor(editor: Editor) {
    super(editor);
    editor.config.define('table.contentToolbar', ['tableColumn', 'tableRow']);
  }

  public override afterInit(): void {
    const editor = this.editor;
    const t = editor.t;
    const widgetToolbarRepository = editor.plugins.get(WidgetToolbarRepository) as WidgetToolbarRepository;
    const items = editor.config.get('table.contentToolbar') as string[];
    if (items) {
      widgetToolbarRepository.register('tableContent', {
        ariaLabel: t('Table toolbar'),
        items,
        getRelatedElement: getTableWidgetAncestor
      });
    }
  }
}

function getTableWidgetAncestor(selection: any): ViewElement | null {
  const selectionPosition = selection.getFirstPosition();
  if (!selectionPosition) return null;
  let parent: any = selectionPosition.parent;
  while (parent) {
    if (parent.is('element') && parent.name === 'figure' && parent.hasClass('table') && isWidget(parent)) return parent;
    parent = parent.parent;
  }
  return null;
}

/** The table feature. */
export class Table extends Plugin {
  public static override get requires() {
    return [TableEditing, TableUI, TableKeyboard, Widget];
  }

  public static override get pluginName(): string {
    return 'Table';
  }
}

export { TableEditing, TableUI, TableUtils, keyCodes };
export { InsertTableCommand, InsertRowCommand, InsertColumnCommand, RemoveRowCommand, RemoveColumnCommand, SetHeaderRowCommand, SetHeaderColumnCommand } from './tablecommands';
export { InsertTableView } from './tableui';
