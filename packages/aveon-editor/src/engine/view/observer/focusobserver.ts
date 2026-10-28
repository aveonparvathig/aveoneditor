import { DomEventObserver } from './domeventobserver';
import type { View } from '../view';

/** Tracks focus/blur of the editable and updates `document.isFocused`. */
export class FocusObserver extends DomEventObserver<FocusEvent> {
  public readonly domEventType = ['focus', 'blur'] as const;
  private _renderTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private _isFocusChanging = false;

  constructor(view: View) {
    super(view);
    this.useCapture = true;
    const document = this.document;

    document.on('focus', () => {
      this._isFocusChanging = true;
      this._renderTimeoutId = setTimeout(() => {
        this.flush();
        view.change(() => {});
      }, 50);
    });

    document.on('blur', (evt, data: any) => {
      const selectedEditable = document.selection.editableElement;
      if (selectedEditable === null || selectedEditable === data.target) {
        document.isFocused = false;
        this._isFocusChanging = false;
        view.change(() => {});
      }
    });
  }

  public override flush(): void {
    if (this._isFocusChanging) {
      this._isFocusChanging = false;
      this.document.isFocused = true;
    }
  }

  public onDomEvent(domEvent: FocusEvent): void {
    this.fire(domEvent.type, domEvent);
  }

  public override destroy(): void {
    if (this._renderTimeoutId) clearTimeout(this._renderTimeoutId);
    super.destroy();
  }
}
