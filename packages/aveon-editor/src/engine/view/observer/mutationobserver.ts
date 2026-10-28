import { Observer } from './observer';
import type { View } from '../view';
import type { Element as ViewElement } from '../element';
import type { Text as ViewText } from '../text';
import { isDomText } from '../filler';

export interface MutationData {
  type: 'children' | 'text';
  node: ViewElement | ViewText;
}

/**
 * Watches DOM mutations that were not produced by the renderer (IME, spellcheck, autocorrect,
 * native typing when `beforeinput` cannot be cancelled) and fires `mutations` on the document
 * with the affected view nodes. The typing feature then reconciles the model from the DOM.
 */
export class MutationObserver extends Observer {
  private _config: MutationObserverInit = { childList: true, characterData: true, subtree: true };
  private _domElements = new Set<HTMLElement>();
  private _mutationObserver: globalThis.MutationObserver | null;

  constructor(view: View) {
    super(view);
    this._mutationObserver = typeof globalThis.MutationObserver !== 'undefined' ? new globalThis.MutationObserver(this._onMutations.bind(this)) : null;
  }

  public override flush(): void {
    if (this._mutationObserver) this._onMutations(this._mutationObserver.takeRecords());
  }

  /** Drops pending records (used right after rendering to ignore the renderer's own changes). */
  public discardPending(): void {
    if (this._mutationObserver) this._mutationObserver.takeRecords();
  }

  public observe(domElement: HTMLElement): void {
    this._domElements.add(domElement);
    if (this.isEnabled && this._mutationObserver) {
      this._mutationObserver.observe(domElement, this._config);
    }
  }

  public stopObserving(domElement: HTMLElement): void {
    this._domElements.delete(domElement);
    if (this.isEnabled && this._mutationObserver) {
      this._mutationObserver.disconnect();
      for (const domElement of this._domElements) {
        this._mutationObserver.observe(domElement, this._config);
      }
    }
  }

  public override enable(): void {
    super.enable();
    if (!this._mutationObserver) return;
    for (const domElement of this._domElements) {
      this._mutationObserver.observe(domElement, this._config);
    }
  }

  public override disable(): void {
    super.disable();
    if (this._mutationObserver) this._mutationObserver.disconnect();
  }

  public override destroy(): void {
    super.destroy();
    if (this._mutationObserver) this._mutationObserver.disconnect();
  }

  private _onMutations(domMutations: MutationRecord[]): void {
    if (domMutations.length === 0) return;
    if (this.view.isRenderingInProgress) return;
    const domConverter = this.view.domConverter;
    const mutatedTexts = new Set<ViewText>();
    const mutatedElements = new Set<ViewElement>();

    for (const mutation of domMutations) {
      const target = mutation.target;
      if (mutation.type === 'characterData' && isDomText(target)) {
        const viewText = domConverter.findCorrespondingViewText(target);
        if (viewText && !mutatedElements.has(viewText.parent as ViewElement)) {
          mutatedTexts.add(viewText);
          continue;
        }
      }
      const element = this._findClosestMappedContainer(target);
      if (element) {
        mutatedElements.add(element);
      }
    }

    for (const text of mutatedTexts) {
      const parent = text.parent as ViewElement | null;
      if (parent && mutatedElements.has(parent)) mutatedTexts.delete(text);
    }

    const mutations: MutationData[] = [];
    for (const text of mutatedTexts) mutations.push({ type: 'text', node: text });
    for (const element of mutatedElements) mutations.push({ type: 'children', node: element });

    if (mutations.length) {
      this.document.fire('mutations', { mutations });
      this.view.forceRender();
    }
  }

  private _findClosestMappedContainer(domNode: globalThis.Node): ViewElement | null {
    const domConverter = this.view.domConverter;
    let current: globalThis.Node | null = domNode;
    while (current) {
      const viewNode = domConverter.mapDomToView(current) as ViewElement | undefined;
      if (viewNode && (viewNode as any).is && (viewNode as any).is('element')) {
        if ((viewNode as any).is('uiElement') || (viewNode as any).is('rawElement')) return null;
        if ((viewNode as any).is('containerElement')) return viewNode;
      }
      current = current.parentNode;
    }
    return null;
  }
}
