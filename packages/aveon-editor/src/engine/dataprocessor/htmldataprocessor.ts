import { DomConverter } from '../view/domconverter';
import type { Document as ViewDocument } from '../view/document';
import type { DocumentFragment as ViewDocumentFragment } from '../view/documentfragment';
import type { Element as ViewElement } from '../view/element';
import type { Node as ViewNode } from '../view/node';

export interface DataProcessor {
  toView(data: string): ViewDocumentFragment;
  toData(viewFragment: ViewDocumentFragment): string;
  registerRawContentMatcher(pattern: (el: ViewElement) => boolean): void;
  useFillerType(type: 'default' | 'marked'): void;
}

/** Converts between HTML strings and the view. */
export class HtmlDataProcessor implements DataProcessor {
  public readonly domParser: DOMParser;
  public readonly domConverter: DomConverter;
  public skipComments = true;

  constructor(document: ViewDocument) {
    this.domParser = new DOMParser();
    this.domConverter = new DomConverter(document, { renderingMode: 'data' });
  }

  public toData(viewFragment: ViewDocumentFragment): string {
    const domFragment = this.domConverter.viewToDom(viewFragment);
    return getHtml(domFragment);
  }

  public toView(data: string): ViewDocumentFragment {
    const domFragment = this._toDom(data);
    return this.domConverter.domToView(domFragment, { skipComments: this.skipComments }) as ViewDocumentFragment;
  }

  public registerRawContentMatcher(pattern: (el: ViewElement) => boolean): void {
    this.domConverter.registerRawContentMatcher(pattern);
  }

  public useFillerType(type: 'default' | 'marked'): void {
    this.domConverter.blockFillerMode = type === 'marked' ? 'markedNbsp' : 'nbsp';
  }

  private _toDom(data: string): globalThis.DocumentFragment {
    if (!data.match(/<(?:html|body|head|meta)(?:\s[^>]*)?>/i) && data.match(/<!--[^-]*-->/)) {
      data = `<body>${data}</body>`;
    }
    const document = this.domParser.parseFromString(data, 'text/html');
    const fragment = document.createDocumentFragment();
    const bodyChildNodes = document.body.childNodes;
    while (bodyChildNodes.length > 0) {
      fragment.appendChild(bodyChildNodes[0]);
    }
    return fragment;
  }
}

function getHtml(fragment: globalThis.Node): string {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc) return '';
  const container = doc.createElement('div');
  container.appendChild(fragment);
  return container.innerHTML;
}

export type { ViewNode };
