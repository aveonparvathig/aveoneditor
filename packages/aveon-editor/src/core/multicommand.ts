import { Command } from './command';
import { priorities, type PriorityString } from '../utils/priorities';

/** A command that delegates to the first enabled child command (e.g. indent list vs block). */
export class MultiCommand extends Command {
  private _childCommandsDefinitions: Array<{ command: Command; priority: number }> = [];

  public override refresh(): void {
    this._getFirstEnabledCommand();
  }

  public override execute(...args: unknown[]): unknown {
    const command = this._getFirstEnabledCommand();
    return !!command && command.execute(...args);
  }

  public registerChildCommand(command: Command, options: { priority?: PriorityString } = {}): void {
    const { priority = 'normal' } = options;
    const definition = { command, priority: priorities.get(priority) };
    this._childCommandsDefinitions.push(definition);
    this._childCommandsDefinitions.sort((a, b) => b.priority - a.priority);
    command.on('change:isEnabled', () => this._checkEnabled());
    this._checkEnabled();
  }

  private _checkEnabled(): void {
    this.isEnabled = !!this._getFirstEnabledCommand();
  }

  private _getFirstEnabledCommand(): Command | undefined {
    const definition = this._childCommandsDefinitions.find(({ command }) => command.isEnabled);
    return definition && definition.command;
  }
}
