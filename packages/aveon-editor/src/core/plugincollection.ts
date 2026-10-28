import { Emitter } from '../utils/emitter';
import type { Editor } from './editor';
import type { PluginConstructor, PluginInterface } from './plugin';

/** Loads plugins, resolving dependencies, and runs their init/afterInit/destroy hooks in order. */
export class PluginCollection extends Emitter implements Iterable<[PluginConstructor, PluginInterface]> {
  private _editor: Editor;
  private _availablePlugins = new Map<string, PluginConstructor>();
  private _plugins = new Map<PluginConstructor | string, PluginInterface>();

  constructor(editor: Editor, availablePlugins: Iterable<PluginConstructor> = []) {
    super();
    this._editor = editor;
    for (const PluginClass of availablePlugins) {
      if (PluginClass.pluginName) {
        this._availablePlugins.set(PluginClass.pluginName, PluginClass);
      }
    }
  }

  public *[Symbol.iterator](): IterableIterator<[PluginConstructor, PluginInterface]> {
    for (const entry of this._plugins) {
      if (typeof entry[0] === 'function') yield entry as [PluginConstructor, PluginInterface];
    }
  }

  public get<T extends PluginInterface = PluginInterface>(key: PluginConstructor | string): T {
    const plugin = this._plugins.get(key);
    if (!plugin) {
      let pluginName = key;
      if (typeof key === 'function') pluginName = key.pluginName || key.name;
      throw new Error(`plugincollection-plugin-not-loaded: The requested plugin "${pluginName}" is not loaded.`);
    }
    return plugin as T;
  }

  public has(key: PluginConstructor | string): boolean {
    return this._plugins.has(key);
  }

  public init(plugins: ReadonlyArray<PluginConstructor | string>, pluginsToRemove: ReadonlyArray<PluginConstructor | string> = [], pluginsSubstitutions: ReadonlyArray<PluginConstructor> = []): Promise<PluginInterface[]> {
    const that = this;
    const editor = this._editor;
    const loading = new Set<PluginConstructor>();
    const loaded: PluginInterface[] = [];

    const pluginConstructors = mapToAvailableConstructors(plugins);
    const pluginsToRemoveConstructors = mapToAvailableConstructors(pluginsToRemove);
    const missingPlugins = findMissingPluginNames(plugins);

    if (missingPlugins) {
      throw new Error(`plugincollection-plugin-not-found: Some plugins are not available and could not be loaded: ${missingPlugins.join(', ')}`);
    }

    const pluginsToLoad = pluginConstructors.filter(p => !pluginsToRemoveConstructors.includes(p));
    for (const PluginClass of pluginsToLoad) {
      loadPlugin(PluginClass);
    }

    const pluginInstances = loadPlugins();
    return initPlugins(pluginInstances, 'init')
      .then(() => initPlugins(pluginInstances, 'afterInit'))
      .then(() => pluginInstances);

    function loadPlugin(PluginConstructor: PluginConstructor): void {
      if (loading.has(PluginConstructor)) return;
      loading.add(PluginConstructor);
      for (const required of PluginConstructor.requires || []) {
        const RequiredPluginClass = typeof required === 'string' ? that._availablePlugins.get(required) : required;
        if (!RequiredPluginClass) {
          throw new Error(`plugincollection-required-plugin-not-found: Plugin "${String(required)}" required by "${PluginConstructor.pluginName || PluginConstructor.name}" was not found.`);
        }
        if (pluginsToRemoveConstructors.includes(RequiredPluginClass)) {
          throw new Error(`plugincollection-required: Cannot remove plugin "${RequiredPluginClass.pluginName}" because it is required by "${PluginConstructor.pluginName}".`);
        }
        loadPlugin(RequiredPluginClass);
      }
    }

    function loadPlugins(): PluginInterface[] {
      const instances: PluginInterface[] = [];
      for (let PluginClass of loading) {
        const substitute = pluginsSubstitutions.find(sub => sub.pluginName === PluginClass.pluginName && sub !== PluginClass);
        if (substitute) PluginClass = substitute;
        const plugin = new PluginClass(editor);
        that._add(PluginClass, plugin);
        instances.push(plugin);
      }
      return instances;
    }

    function initPlugins(instances: PluginInterface[], method: 'init' | 'afterInit'): Promise<void> {
      return instances.reduce((promise, plugin) => {
        const fn = plugin[method];
        if (!fn) return promise;
        return promise.then(() => fn.call(plugin) as Promise<unknown>).then(() => undefined);
      }, Promise.resolve());
    }

    function mapToAvailableConstructors(names: ReadonlyArray<PluginConstructor | string>): PluginConstructor[] {
      return names.map(item => (typeof item === 'string' ? that._availablePlugins.get(item) : item)).filter((p): p is PluginConstructor => !!p);
    }

    function findMissingPluginNames(names: ReadonlyArray<PluginConstructor | string>): string[] | null {
      const missing: string[] = [];
      for (const item of names) {
        if (typeof item === 'string' && !that._availablePlugins.has(item)) missing.push(item);
      }
      return missing.length ? missing : null;
    }
  }

  public destroy(): Promise<unknown> {
    const promises: Array<Promise<unknown> | void> = [];
    for (const [, pluginInstance] of this) {
      if (typeof pluginInstance.destroy === 'function') {
        promises.push(pluginInstance.destroy());
      }
    }
    return Promise.all(promises);
  }

  private _add(PluginConstructor: PluginConstructor, plugin: PluginInterface): void {
    this._plugins.set(PluginConstructor, plugin);
    const pluginName = PluginConstructor.pluginName;
    if (!pluginName) return;
    if (this._plugins.has(pluginName)) {
      throw new Error(`plugincollection-plugin-name-conflict: Two plugins with the same name "${pluginName}" were loaded.`);
    }
    this._plugins.set(pluginName, plugin);
  }
}
