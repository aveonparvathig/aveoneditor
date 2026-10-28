import { Observable } from '../utils/observable';
import { Config } from '../utils/config';
import { Locale } from '../utils/locale';
import { Model } from '../engine/model/model';
import { DataController } from '../engine/controller/datacontroller';
import { EditingController } from '../engine/controller/editingcontroller';
import { Conversion } from '../engine/conversion/conversion';
import { PluginCollection } from './plugincollection';
import { CommandCollection } from './commandcollection';
import { EditingKeystrokeHandler } from './editingkeystrokehandler';
import type { PluginConstructor } from './plugin';
import type { EditorUI } from './editorui';
import type { Command } from './command';

export interface EditorConfig {
  plugins?: Array<PluginConstructor | string>;
  extraPlugins?: Array<PluginConstructor | string>;
  removePlugins?: Array<PluginConstructor | string>;
  substitutePlugins?: PluginConstructor[];
  initialData?: string;
  language?: string | { ui?: string; content?: string };
  licenseKey?: string;
  placeholder?: string | Record<string, string>;
  toolbar?: string[] | { items: string[]; shouldNotGroupWhenFull?: boolean; removeItems?: string[] };
  [key: string]: unknown;
}

export type EditorReadyEvent = 'ready';

/**
 * Base editor class. Concrete editors (classic, inline, balloon, decoupled) extend it,
 * provide a UI and a static `create()` method.
 */
export abstract class Editor extends Observable {
  public readonly commands = new CommandCollection();
  public readonly config: Config<EditorConfig>;
  public readonly plugins: PluginCollection;
  public readonly locale: Locale;
  public readonly t: Locale['t'];
  public readonly model: Model;
  public readonly data: DataController;
  public readonly editing: EditingController;
  public readonly conversion: Conversion;
  public readonly keystrokes: EditingKeystrokeHandler;
  public abstract ui: EditorUI;
  declare public state: 'initializing' | 'ready' | 'destroyed';
  declare public isReadOnly: boolean;
  public sourceElement?: HTMLElement;
  private _readOnlyLocks = new Set<string | symbol>();

  public static defaultConfig?: EditorConfig;
  public static builtinPlugins?: PluginConstructor[];

  constructor(config: EditorConfig = {}) {
    super();
    const constructor = this.constructor as typeof Editor;
    const defaultConfig = constructor.defaultConfig || {};
    this.config = new Config<EditorConfig>(config, defaultConfig);
    this.config.define('plugins', constructor.builtinPlugins);

    const languageConfig = this.config.get('language') || {};
    this.locale = new Locale({
      uiLanguage: typeof languageConfig === 'string' ? languageConfig : languageConfig.ui,
      contentLanguage: typeof languageConfig === 'string' ? undefined : languageConfig.content,
      translations: this.config.get('translations') as any
    });
    this.t = this.locale.t;

    this.plugins = new PluginCollection(this, constructor.builtinPlugins);
    this.set('state', 'initializing');
    this.once('ready', () => (this.state = 'ready'), { priority: 'high' });
    this.once('destroy', () => (this.state = 'destroyed'), { priority: 'high' });

    this.model = new Model();
    this.on('destroy', () => this.model.destroy(), { priority: 'low' });

    this.set('isReadOnly', false);
    this.on('set:isReadOnly', evt => {
      // Read-only state is managed through locks.
      evt.return = this._readOnlyLocks.size > 0;
    }, { priority: 'highest' });

    this.model.document.createRoot();
    this.data = new DataController(this.model);
    this.editing = new EditingController(this.model);
    this.editing.view.document.bind('isReadOnly').to(this);
    this.conversion = new Conversion([this.editing.downcastDispatcher, this.data.downcastDispatcher], this.data.upcastDispatcher);
    this.conversion.addAlias('dataDowncast', this.data.downcastDispatcher);
    this.conversion.addAlias('editingDowncast', this.editing.downcastDispatcher);

    this.keystrokes = new EditingKeystrokeHandler(this);
    this.keystrokes.listenTo(this.editing.view.document);
  }

  public enableReadOnlyMode(lockId: string | symbol): void {
    if (typeof lockId !== 'string' && typeof lockId !== 'symbol') {
      throw new Error('editor-read-only-lock-id-invalid');
    }
    if (this._readOnlyLocks.has(lockId)) return;
    this._readOnlyLocks.add(lockId);
    if (this._readOnlyLocks.size === 1) {
      this.isReadOnly = true;
    }
  }

  public disableReadOnlyMode(lockId: string | symbol): void {
    if (!this._readOnlyLocks.has(lockId)) return;
    this._readOnlyLocks.delete(lockId);
    if (this._readOnlyLocks.size === 0) {
      this.isReadOnly = false;
    }
  }

  /** Loads and initializes plugins from the configuration. */
  public initPlugins(): Promise<unknown> {
    const config = this.config;
    const plugins = config.get('plugins') || [];
    const extraPlugins = config.get('extraPlugins') || [];
    const removePlugins = config.get('removePlugins') || [];
    const substitutePlugins = config.get('substitutePlugins') || [];
    return this.plugins.init([...plugins, ...extraPlugins], removePlugins, substitutePlugins);
  }

  public destroy(): Promise<unknown> {
    let readyPromise: Promise<unknown> = Promise.resolve();
    if (this.state === 'initializing') {
      readyPromise = new Promise(resolve => this.once('ready', resolve));
    }
    return readyPromise.then(() => {
      this.fire('destroy');
      this.stopListening();
      this.commands.destroy();
    })
      .then(() => this.plugins.destroy())
      .then(() => {
        this.model.destroy();
        this.data.destroy();
        this.editing.destroy();
        this.keystrokes.destroy();
      });
  }

  public execute(commandName: string, ...commandParams: unknown[]): unknown {
    try {
      return this.commands.execute(commandName, ...commandParams);
    } catch (err) {
      throw err;
    }
  }

  public focus(): void {
    this.editing.view.focus();
  }

  public getData(options?: { rootName?: string; trim?: 'empty' | 'none' }): string {
    return this.data.get(options);
  }

  public setData(data: string | Record<string, string>): void {
    this.data.set(data);
  }

  public updateSourceElement(data?: string): void {
    if (!this.sourceElement) {
      throw new Error('editor-missing-sourceelement: Cannot update the source element of a detached editor.');
    }
    const shouldUpdateSourceElement = this.config.get('updateSourceElementOnDestroy');
    const isSourceElementTextArea = this.sourceElement instanceof HTMLTextAreaElement;
    if (!isSourceElementTextArea && !shouldUpdateSourceElement) return;
    setDataInElement(this.sourceElement, typeof data === 'string' ? data : this.data.get());
  }

  /** Returns the command with the given name. */
  public getCommand<T extends Command = Command>(name: string): T | undefined {
    return this.commands.get<T>(name);
  }
}

export function getDataFromElement(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement) return el.value;
  return el.innerHTML;
}

export function setDataInElement(el: HTMLElement, data: string): void {
  if (el instanceof HTMLTextAreaElement) {
    el.value = data;
  }
  el.innerHTML = data;
}

/** Keeps a textarea source element in sync on form submit. */
export function attachToForm(editor: Editor): void {
  const sourceElement = editor.sourceElement;
  if (sourceElement && sourceElement.tagName.toLowerCase() === 'textarea' && (sourceElement as HTMLTextAreaElement).form) {
    const form = (sourceElement as HTMLTextAreaElement).form!;
    const updateSourceElement = () => editor.updateSourceElement();
    form.addEventListener('submit', updateSourceElement);
    const originalSubmit = form.submit;
    if (originalSubmit) {
      (form as any).submit = () => {
        updateSourceElement();
        originalSubmit.apply(form);
      };
    }
    editor.on('destroy', () => {
      form.removeEventListener('submit', updateSourceElement);
      (form as any).submit = originalSubmit;
    });
  }
}

/** Marks a DOM element as used by an editor so another instance cannot attach to it. */
export function secureSourceElement(editor: Editor, sourceElement: HTMLElement): void {
  const key = 'aveonEditorInstance';
  if ((sourceElement as any)[key]) {
    throw new Error('editor-source-element-already-used: The DOM element is already used by another editor instance.');
  }
  (sourceElement as any)[key] = editor;
  editor.once('destroy', () => {
    delete (sourceElement as any)[key];
  });
}
