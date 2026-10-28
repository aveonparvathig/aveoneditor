import { Plugin } from '../../core/plugin';
import { Input } from './input';
import { Delete } from './delete';
import type { PluginConstructor } from '../../core/plugin';

/** Typing feature: text input and deletion. */
export class Typing extends Plugin {
  public static override get requires(): PluginConstructor[] {
    return [Input, Delete];
  }

  public static override get pluginName(): string {
    return 'Typing';
  }
}

export { Input, Delete };
export { InsertTextCommand } from './inserttextcommand';
export { DeleteCommand } from './deletecommand';
export { ChangeBuffer } from './changebuffer';
