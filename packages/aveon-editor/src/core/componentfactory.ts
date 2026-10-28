import type { Editor } from './editor';
import type { View } from '../ui/view';

/** Registry of UI component creators (`editor.ui.componentFactory.add('bold', locale => ...)`). */
export class ComponentFactory {
  public readonly editor: Editor;
  private _components = new Map<string, { callback: (locale: Editor['locale']) => View; originalName: string }>();

  constructor(editor: Editor) {
    this.editor = editor;
  }

  public *names(): IterableIterator<string> {
    for (const value of this._components.values()) yield value.originalName;
  }

  public add(name: string, callback: (locale: Editor['locale']) => View): void {
    this._components.set(getNormalized(name), { callback, originalName: name });
  }

  public create(name: string): View {
    if (!this.has(name)) {
      throw new Error(`componentfactory-item-missing: The required component "${name}" is not registered in the factory.`);
    }
    return this._components.get(getNormalized(name))!.callback(this.editor.locale);
  }

  public has(name: string): boolean {
    return this._components.has(getNormalized(name));
  }
}

function getNormalized(name: string): string {
  return String(name).toLowerCase();
}
