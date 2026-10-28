import { KeystrokeHandler, type KeystrokeCallback } from '../utils/keystrokehandler';
import type { PriorityString } from '../utils/priorities';
import type { Editor } from './editor';

/** Keystroke handler bound to the editing view; a string callback executes a command. */
export class EditingKeystrokeHandler extends KeystrokeHandler {
  public readonly editor: Editor;

  constructor(editor: Editor) {
    super();
    this.editor = editor;
  }

  public override set(keystroke: string | Array<string | number>, callback: KeystrokeCallback | string, options: { priority?: PriorityString | number } = {}): void {
    if (typeof callback === 'string') {
      const commandName = callback;
      callback = (evtData, cancel) => {
        this.editor.execute(commandName);
        cancel();
      };
    }
    super.set(keystroke, callback, options);
  }
}
