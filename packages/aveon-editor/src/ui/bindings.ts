import type { Emitter } from '../utils/emitter';
import type { View } from './view';
import { keyCodes } from '../utils/keyboard';

/** Calls the callback when a click happens outside the given elements while active. */
export function clickOutsideHandler({ emitter, activator, callback, contextElements }: { emitter: Emitter; activator: () => boolean; callback: () => void; contextElements: Array<HTMLElement | null> | (() => Array<HTMLElement | null>) }): void {
  const handler = (domEvt: MouseEvent) => {
    if (!activator()) return;
    const elements = typeof contextElements === 'function' ? contextElements() : contextElements;
    for (const contextElement of elements) {
      if (contextElement && contextElement.contains(domEvt.target as Node)) return;
    }
    callback();
  };
  document.addEventListener('mousedown', handler);
  (emitter as any).once?.('destroy', () => document.removeEventListener('mousedown', handler));
  const originalStop = emitter.stopListening.bind(emitter);
  (emitter as any).stopListening = function (...args: unknown[]) {
    if (args.length === 0) document.removeEventListener('mousedown', handler);
    return originalStop(...(args as []));
  };
}

/** Prevents default and stops propagation of the event. */
export function preventDefault(view: View): (evt: Event) => void {
  return view.bindTemplate.to((evt: Event) => {
    evt.preventDefault();
    view.fire('selectstart');
  }) as any;
}

/** Fires `submit` on the view when the form is submitted. */
export function submitHandler({ view }: { view: View }): void {
  const attach = () => {
    view.element!.addEventListener('submit', (evt: Event) => {
      evt.preventDefault();
      view.fire('submit');
    });
  };
  // Usually called from render() while the 'render' event is being fired, so attach right away when possible.
  if (view.element) {
    attach();
  } else {
    view.listenTo(view, 'render', attach);
  }
}

/** Injects Esc handling that calls the callback. */
export function injectCssTransitionDisabler(view: View & { disableCssTransitions(): void; enableCssTransitions(): void }): void {
  (view as any).set('_isCssTransitionsDisabled', false);
  view.disableCssTransitions = () => {
    (view as any)._isCssTransitionsDisabled = true;
  };
  view.enableCssTransitions = () => {
    (view as any)._isCssTransitionsDisabled = false;
  };
  view.extendTemplate({
    attributes: {
      class: [view.bindTemplate.if('_isCssTransitionsDisabled', 'ck-transitions-disabled')]
    }
  });
}

export function isEscape(keyCode: number): boolean {
  return keyCode === keyCodes.esc;
}
