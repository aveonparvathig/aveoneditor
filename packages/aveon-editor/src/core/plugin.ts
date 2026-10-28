import { Observable } from '../utils/observable';
import type { Editor } from './editor';

export interface PluginInterface {
  init?(): Promise<unknown> | void;
  afterInit?(): Promise<unknown> | void;
  destroy(): Promise<unknown> | void;
}

export interface PluginStaticMembers {
  readonly pluginName?: string;
  readonly requires?: ReadonlyArray<PluginConstructor | string>;
  readonly isContextPlugin?: boolean;
  readonly isOfficialPlugin?: boolean;
}

export type PluginConstructor = (new (editor: Editor) => PluginInterface) & PluginStaticMembers;

/**
 * Base class for editor plugins. Every feature is a plugin; plugins declare dependencies
 * through `static get requires()` and set themselves up in `init()` / `afterInit()`.
 */
export class Plugin extends Observable implements PluginInterface {
  public readonly editor: Editor;
  declare public isEnabled: boolean;
  private _disableStack = new Set<string>();

  constructor(editor: Editor) {
    super();
    this.editor = editor;
    this.set('isEnabled', true);
  }

  public static get pluginName(): string | undefined {
    return undefined;
  }

  public static get requires(): ReadonlyArray<PluginConstructor | string> {
    return [];
  }

  public static get isContextPlugin(): boolean {
    return false;
  }

  public static get isOfficialPlugin(): boolean {
    return true;
  }

  public init(): Promise<unknown> | void {
    /* optional */
  }

  public afterInit(): Promise<unknown> | void {
    /* optional */
  }

  public forceDisabled(id: string): void {
    this._disableStack.add(id);
    if (this._disableStack.size === 1) {
      this.on('set:isEnabled', forceDisable, { priority: 'highest' });
      this.isEnabled = false;
    }
  }

  public clearForceDisabled(id: string): void {
    this._disableStack.delete(id);
    if (this._disableStack.size === 0) {
      this.off('set:isEnabled', forceDisable);
      this.isEnabled = true;
    }
  }

  public destroy(): void {
    this.stopListening();
  }
}

function forceDisable(evt: any): void {
  evt.return = false;
  evt.stop();
}
