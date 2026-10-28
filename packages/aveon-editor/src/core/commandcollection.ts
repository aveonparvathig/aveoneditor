import type { Command } from './command';

/** Collection of editor commands. */
export class CommandCollection implements Iterable<[string, Command]> {
  private _commands = new Map<string, Command>();

  public add(commandName: string, command: Command): void {
    this._commands.set(commandName, command);
  }

  public get<T extends Command = Command>(commandName: string): T | undefined {
    return this._commands.get(commandName) as T | undefined;
  }

  public execute(commandName: string, ...commandParams: unknown[]): unknown {
    const command = this.get(commandName);
    if (!command) {
      throw new Error(`commandcollection-command-not-found: Command "${commandName}" does not exist.`);
    }
    return command.execute(...commandParams);
  }

  public *names(): IterableIterator<string> {
    yield* this._commands.keys();
  }

  public *commands(): IterableIterator<Command> {
    yield* this._commands.values();
  }

  public [Symbol.iterator](): Iterator<[string, Command]> {
    return this._commands[Symbol.iterator]();
  }

  public destroy(): void {
    for (const command of this.commands()) command.destroy();
  }
}
