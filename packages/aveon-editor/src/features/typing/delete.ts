import { Plugin } from '../../core/plugin';
import { DeleteCommand } from './deletecommand';
import { Observer } from '../../engine/view/observer/observer';
import { DomEventData } from '../../engine/view/observer/domeventdata';
import { EventInfo } from '../../utils/eventinfo';
import { keyCodes } from '../../utils/keyboard';
import { env } from '../../utils/env';
import type { EditingView } from '../../engine/view';

const DELETE_INPUT_TYPES: Record<string, { direction: 'forward' | 'backward'; unit: 'character' | 'codePoint' | 'word' | 'selection' }> = {
  deleteContentBackward: { direction: 'backward', unit: 'codePoint' },
  deleteContentForward: { direction: 'forward', unit: 'character' },
  deleteWordBackward: { direction: 'backward', unit: 'word' },
  deleteWordForward: { direction: 'forward', unit: 'word' },
  deleteHardLineBackward: { direction: 'backward', unit: 'selection' },
  deleteHardLineForward: { direction: 'forward', unit: 'selection' },
  deleteSoftLineBackward: { direction: 'backward', unit: 'selection' },
  deleteSoftLineForward: { direction: 'forward', unit: 'selection' },
  deleteContent: { direction: 'backward', unit: 'selection' },
  deleteByCut: { direction: 'backward', unit: 'selection' }
};

/** Fires `delete` on the view document for delete-type `beforeinput` events (with Backspace/Delete keydown fallback). */
export class DeleteObserver extends Observer {
  constructor(view: EditingView) {
    super(view);
    const document = view.document;
    let sequence = 0;
    let handledByBeforeInput = false;

    document.on('keyup', (evt, data: any) => {
      if (data.keyCode === keyCodes.delete || data.keyCode === keyCodes.backspace) {
        sequence = 0;
      }
    });

    document.on('beforeinput', (evt, data: any) => {
      if (!this.isEnabled) return;
      const { targetRanges, domEvent, inputType } = data;
      const deleteType = DELETE_INPUT_TYPES[inputType];
      if (!deleteType) return;
      if (inputType === 'deleteByCut') return;
      handledByBeforeInput = true;
      const deleteData: any = {
        direction: deleteType.direction,
        unit: deleteType.unit,
        sequence: ++sequence
      };
      if (deleteType.unit === 'selection' || (targetRanges.length && !targetRanges[0].isCollapsed)) {
        deleteData.selectionToRemove = view.createSelection(targetRanges);
        if (deleteType.unit === 'selection') deleteData.unit = 'character';
      }
      const eventInfo = new EventInfo(document, 'delete');
      document.fire(eventInfo, new DomEventData(view, domEvent, deleteData));
      if (eventInfo.stopped) evt.stop();
    });

    // Fallback for environments without `beforeinput` delete events.
    document.on('keydown', (evt, data: any) => {
      if (!this.isEnabled) return;
      if (data.keyCode !== keyCodes.delete && data.keyCode !== keyCodes.backspace) return;
      if (handledByBeforeInput || typeof InputEvent === 'undefined' || !('getTargetRanges' in InputEvent.prototype)) {
        if (handledByBeforeInput) {
          handledByBeforeInput = false;
          return;
        }
        const direction = data.keyCode === keyCodes.delete ? 'forward' : 'backward';
        const unit = data.ctrlKey || (env.isMac && data.altKey) ? 'word' : 'codePoint';
        const eventInfo = new EventInfo(document, 'delete');
        document.fire(eventInfo, new DomEventData(view, data.domEvent, { direction, unit, sequence: ++sequence }));
        if (eventInfo.stopped) evt.stop();
      }
    }, { priority: 'low' });
  }

  public observe(): void {
    /* uses document events */
  }

  public stopObserving(): void {
    /* nothing */
  }
}

/** Handles Backspace and Delete. */
export class Delete extends Plugin {
  public static override get pluginName(): string {
    return 'Delete';
  }

  public override init(): void {
    const editor = this.editor;
    const view = editor.editing.view;
    const viewDocument = view.document;
    const modelDocument = editor.model.document;

    view.addObserver(DeleteObserver);
    const deleteForwardCommand = new DeleteCommand(editor, 'forward');
    editor.commands.add('deleteForward', deleteForwardCommand);
    editor.commands.add('forwardDelete', deleteForwardCommand);
    editor.commands.add('delete', new DeleteCommand(editor, 'backward'));

    this.listenTo(viewDocument, 'delete', (evt, data: any) => {
      if (viewDocument.isComposing && !env.isAndroid) {
        return;
      }
      data.preventDefault();
      const { direction, sequence, selectionToRemove, unit } = data;
      const commandName = direction === 'forward' ? 'deleteForward' : 'delete';
      const commandData: any = { unit, sequence };
      if (selectionToRemove) {
        const modelRanges = [];
        for (const viewRange of selectionToRemove.getRanges()) {
          try {
            modelRanges.push(editor.editing.mapper.toModelRange(viewRange));
          } catch {
            /* skip */
          }
        }
        if (modelRanges.length) commandData.selection = editor.model.createSelection(modelRanges);
      }
      editor.execute(commandName, commandData);
      view.scrollToTheSelection();
    }, { priority: 'low' });

    void modelDocument;
  }
}
