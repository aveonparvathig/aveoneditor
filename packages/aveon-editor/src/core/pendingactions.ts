import { Plugin } from './plugin';
import { Collection } from '../utils/collection';
import { Observable } from '../utils/observable';

export interface PendingAction extends Observable {
  message: string;
}

/** Tracks pending asynchronous actions (uploads, autosave) so the UI can warn before leaving. */
export class PendingActions extends Plugin {
  declare public hasAny: boolean;
  private _actions = new Collection<PendingAction>({ idProperty: '_id' });

  public static override get pluginName(): string {
    return 'PendingActions';
  }

  public static override get isContextPlugin(): boolean {
    return true;
  }

  public override init(): void {
    this.set('hasAny', false);
    this._actions.delegate('add', 'remove').to(this);
  }

  public add(message: string): PendingAction {
    if (typeof message !== 'string') {
      throw new Error('pendingactions-add-invalid-message');
    }
    const action = new Observable() as PendingAction;
    action.set('message', message);
    this._actions.add(action);
    this.hasAny = true;
    return action;
  }

  public remove(action: PendingAction): void {
    this._actions.remove(action);
    this.hasAny = !!this._actions.length;
  }

  public get first(): PendingAction | null {
    return this._actions.first;
  }

  public [Symbol.iterator](): Iterator<PendingAction> {
    return this._actions[Symbol.iterator]();
  }
}
