import { Plugin } from '../../core/plugin';
import { Clipboard } from '../clipboard/clipboard';
import { Enter, ShiftEnter } from '../enter/enter';
import { SelectAll } from '../selectall/selectall';
import { Typing } from '../typing/typing';
import { Undo } from '../undo/undo';

/** Bundles the essential editing features: clipboard, enter, select all, typing and undo. */
export class Essentials extends Plugin {
  public static override get requires() {
    return [Clipboard, Enter, SelectAll, ShiftEnter, Typing, Undo];
  }

  public static override get pluginName(): string {
    return 'Essentials';
  }
}
