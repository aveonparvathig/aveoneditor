import { Plugin } from '../../core/plugin';
import { PendingActions } from '../../core/pendingactions';
import { debounce } from '../../utils/misc';
import type { Editor } from '../../core/editor';

export interface AutosaveConfig {
  save?: (editor: Editor) => Promise<unknown> | void;
  waitingTime?: number;
}

/** Calls `config.autosave.save(editor)` after the content changes (debounced), tracking pending state. */
export class Autosave extends Plugin {
  public adapter?: { save(editor: Editor): Promise<unknown> | void };
  declare public state: 'synchronized' | 'waiting' | 'saving' | 'error';
  declare public isWaiting: boolean;
  private _debouncedSave: (() => void) & { cancel(): void; flush(): void };
  private _lastDocumentVersion = 0;
  private _savePromise: Promise<unknown> | null = null;
  private _pendingAction: any = null;
  private _config: AutosaveConfig;

  public static override get pluginName(): string {
    return 'Autosave';
  }

  public static override get requires() {
    return [PendingActions];
  }

  constructor(editor: Editor) {
    super(editor);
    this._config = (editor.config.get('autosave') as AutosaveConfig) || {};
    const waitingTime = this._config.waitingTime || 1000;
    this.set('state', 'synchronized');
    this.set('isWaiting', false);
    this._debouncedSave = debounce(() => this._save(), waitingTime);
  }

  public override init(): void {
    const editor = this.editor;
    const doc = editor.model.document;
    this.listenTo(editor, 'ready', () => {
      this.listenTo(doc, 'change:data', (evt, batch: any) => {
        if (!this._saveCallbacks.length) return;
        if (!batch.isLocal) return;
        if (this.state === 'synchronized') {
          this.state = 'waiting';
          this._setPendingAction();
        }
        if (this.state === 'waiting') {
          this._debouncedSave();
        }
      });
    });
    this.on('change:state', () => {
      this.isWaiting = this.state === 'waiting';
    });
  }

  public override destroy(): void {
    this._debouncedSave.cancel();
    super.destroy();
  }

  public save(): Promise<unknown> {
    this._debouncedSave.cancel();
    return this._save();
  }

  private _save(): Promise<unknown> {
    if (this._savePromise) {
      return this._savePromise.then(() => this._save());
    }
    this._lastDocumentVersion = this.editor.model.document.version;
    this.state = 'saving';
    this._savePromise = Promise.all(this._saveCallbacks.map(cb => cb(this.editor)))
      .then(() => {
        this._savePromise = null;
        if (this.editor.model.document.version > this._lastDocumentVersion) {
          this.state = 'waiting';
          this._debouncedSave();
        } else {
          this.state = 'synchronized';
          if (this._pendingAction) {
            (this.editor.plugins.get(PendingActions) as PendingActions).remove(this._pendingAction);
            this._pendingAction = null;
          }
        }
      })
      .catch(err => {
        this._savePromise = null;
        this.state = 'error';
        this.state = 'saving';
        this._debouncedSave();
        throw err;
      });
    return this._savePromise;
  }

  private get _saveCallbacks(): Array<(editor: Editor) => Promise<unknown> | void> {
    const callbacks: Array<(editor: Editor) => Promise<unknown> | void> = [];
    if (this.adapter) callbacks.push(editor => this.adapter!.save(editor));
    if (this._config.save) callbacks.push(this._config.save);
    return callbacks;
  }

  private _setPendingAction(): void {
    if (this._pendingAction) return;
    const t = this.editor.t;
    this._pendingAction = (this.editor.plugins.get(PendingActions) as PendingActions).add(t('Saving changes'));
  }
}
