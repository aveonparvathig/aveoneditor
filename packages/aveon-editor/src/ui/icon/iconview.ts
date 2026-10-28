import { View } from '../view';

/** Renders an inline SVG icon from a string. */
export class IconView extends View {
  declare public content: string;
  declare public viewBox: string;
  declare public fillColor: string;
  declare public isColorInherited: boolean;
  declare public isVisible: boolean;

  constructor() {
    super();
    const bind = this.bindTemplate;
    this.set('content', '');
    this.set('viewBox', '0 0 20 20');
    this.set('fillColor', '');
    this.set('isColorInherited', true);
    this.set('isVisible', true);
    this.setTemplate({
      tag: 'svg',
      attributes: {
        class: ['ck', 'ck-icon', bind.if('isVisible', 'ck-hidden', value => !value), 'ck-reset_all-excluded', bind.if('isColorInherited', 'ck-icon_inherit-color')],
        viewBox: bind.to('viewBox'),
        'aria-hidden': 'true'
      }
    });
  }

  public override render(): void {
    super.render();
    this._updateXMLContent();
    this._colorFillPaths();
    this.on('change:content', () => {
      this._updateXMLContent();
      this._colorFillPaths();
    });
    this.on('change:fillColor', () => {
      this._colorFillPaths();
    });
  }

  private _updateXMLContent(): void {
    if (this.content) {
      const parsed = new DOMParser().parseFromString(this.content.trim(), 'image/svg+xml');
      const svg = parsed.querySelector('svg')!;
      const viewBox = svg.getAttribute('viewBox');
      if (viewBox) this.viewBox = viewBox;
      for (const { name, value } of Array.from(svg.attributes)) {
        if (['viewBox', 'class', 'aria-hidden'].includes(name)) continue;
        this.element!.setAttribute(name, value);
      }
      while (this.element!.firstChild) this.element!.removeChild(this.element!.firstChild);
      while (svg.childNodes.length > 0) this.element!.appendChild(svg.childNodes[0]);
    }
  }

  private _colorFillPaths(): void {
    if (this.fillColor) {
      this.element!.querySelectorAll('.ck-icon__fill').forEach(path => {
        (path as HTMLElement).style.fill = this.fillColor;
      });
    }
  }
}
