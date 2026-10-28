import { Emitter } from './emitter';
import { getCode, parseKeystroke, type KeystrokeInfo } from './keyboard';
import type { PriorityString } from './priorities';

export type KeystrokeCallback = (keyEvtData: KeyboardEvent | KeystrokeInfo, cancel: () => void) => void;

/** Maps keystrokes (`Ctrl+B`) to callbacks. Listens to an emitter firing `keydown`, or directly to a DOM element. */
export class KeystrokeHandler {
  private readonly _listener = new Emitter();
  private _domListeners: Array<[EventTarget, EventListener]> = [];

  public listenTo(emitterOrElement: Emitter | EventTarget): void {
    if (typeof (emitterOrElement as EventTarget).addEventListener === 'function' && !(emitterOrElement instanceof Emitter)) {
      const element = emitterOrElement as EventTarget;
      const listener = (domEvt: Event) => {
        const keyEvt = domEvt as KeyboardEvent;
        const data = {
          keyCode: keyEvt.keyCode,
          altKey: keyEvt.altKey,
          ctrlKey: keyEvt.ctrlKey,
          shiftKey: keyEvt.shiftKey,
          metaKey: keyEvt.metaKey,
          domEvent: keyEvt,
          preventDefault: () => keyEvt.preventDefault(),
          stopPropagation: () => keyEvt.stopPropagation()
        };
        this._listener.fire('_keydown:' + getCode(data), data);
      };
      element.addEventListener('keydown', listener);
      this._domListeners.push([element, listener]);
      return;
    }
    this._listener.listenTo(emitterOrElement as Emitter, 'keydown', (evt, keyEvtData: KeystrokeInfo) => {
      this._listener.fire('_keydown:' + getCode(keyEvtData), keyEvtData);
    });
  }

  public set(keystroke: string | Array<string | number>, callback: KeystrokeCallback, options: { priority?: PriorityString | number } = {}): void {
    const keyCode = parseKeystroke(keystroke);
    this._listener.listenTo(
      this._listener,
      '_keydown:' + keyCode,
      (evt, keyEvtData: KeyboardEvent | KeystrokeInfo) => {
        callback(keyEvtData, () => {
          const native = keyEvtData as any;
          if (typeof native.preventDefault === 'function') {
            native.preventDefault();
            native.stopPropagation();
          }
          evt.stop();
        });
        evt.return = true;
      },
      options
    );
  }

  public press(keyEvtData: KeyboardEvent | KeystrokeInfo): boolean {
    return !!this._listener.fire('_keydown:' + getCode(keyEvtData), keyEvtData);
  }

  public stopListening(emitter?: Emitter): void {
    this._listener.stopListening(emitter);
  }

  public destroy(): void {
    this.stopListening();
    for (const [element, listener] of this._domListeners) {
      element.removeEventListener('keydown', listener);
    }
    this._domListeners = [];
  }
}
