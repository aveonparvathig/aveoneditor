import { Observable } from '../utils/observable';
import type { Editor } from './editor';

/**
 * Base class for commands: an action (`execute()`) paired with state (`value`, `isEnabled`).
 * Commands refresh their state on every model change.
 */
export class Command extends Observable {
  public readonly editor: Editor;
  declare public value: unknown;
  declare public isEnabled: boolean;
  public affectsData = true;
  private _affectsData = true;
  private _isEnabledBasedOnSelection = true;
  private _disableStack = new Set<string>();

  constructor(editor: Editor) {
    super();
    this.editor = editor;
    this.set('value', undefined);
    this.set('isEnabled', false);
    Object.defineProperty(this, 'affectsData', {
      get: () => this._affectsData,
      set: (value: boolean) => {
        this._affectsData = value;
      }
    });

    this.decorate('execute');

    this.listenTo(this.editor.model.document, 'change', () => {
      this.refresh();
    });
    this.listenTo(editor, 'change:isReadOnly', () => {
      this.refresh();
    });

    this.on('set:isEnabled', evt => {
      if (!this.affectsData) return;
      const selection = editor.model.document.selection;
      const selectionInGraveyard = (selection.getFirstPosition()!.root as any).rootName === '$graveyard';
      const canEditAtSelection = !selectionInGraveyard && editor.model.canEditAt(selection as any);
      if (this._isEnabledBasedOnSelection && !canEditAtSelection) {
        evt.return = false;
        evt.stop();
      }
    }, { priority: 'highest' });

    this.on('execute', evt => {
      if (!this.isEnabled) {
        evt.stop();
      }
    }, { priority: 'high' });
  }

  public get isEnabledBasedOnSelection(): boolean {
    return this._isEnabledBasedOnSelection;
  }

  public set isEnabledBasedOnSelection(value: boolean) {
    this._isEnabledBasedOnSelection = value;
  }

  /** Recomputes `value` and `isEnabled`. Override in subclasses. */
  public refresh(): void {
    this.isEnabled = true;
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
      this.refresh();
    }
  }

  /** Executes the command. Override in subclasses. */
  public execute(..._args: unknown[]): unknown {
    return undefined;
  }

  public destroy(): void {
    this.stopListening();
  }
}

function forceDisable(evt: any): void {
  evt.return = false;
  evt.stop();
}
