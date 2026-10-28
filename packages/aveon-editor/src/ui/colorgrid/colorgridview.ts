import { View } from '../view';
import { ButtonView } from '../button/buttonview';
import { FocusTracker } from '../../utils/focustracker';
import { KeystrokeHandler } from '../../utils/keystrokehandler';
import { icons } from '../icons';
import type { Locale } from '../../utils/locale';

export interface ColorDefinition {
  color: string;
  label?: string;
  options?: { hasBorder?: boolean };
}

/** A single color tile. */
export class ColorTileView extends ButtonView {
  declare public color: string | undefined;
  declare public hasBorder: boolean;

  constructor(locale?: Locale) {
    super(locale);
    const bind = this.bindTemplate;
    this.set('color', undefined);
    this.set('hasBorder', false);
    this.icon = icons.check;
    this.extendTemplate({
      attributes: {
        style: { backgroundColor: bind.to('color') } as any,
        class: ['ck', 'ck-color-grid__tile', bind.if('hasBorder', 'ck-color-selector__color-tile_bordered')]
      }
    });
  }

  public override render(): void {
    super.render();
    this.iconView.fillColor = 'hsl(0, 0%, 100%)';
  }
}

/** Grid of color tiles. Fires `execute` with `{ value, label, hasBorder }`. */
export class ColorGridView extends View {
  public readonly columns: number;
  public readonly items = this.createCollection<ColorTileView>();
  public readonly focusTracker = new FocusTracker();
  public readonly keystrokes = new KeystrokeHandler();
  declare public selectedColor: string | undefined;

  constructor(locale?: Locale, options: { colorDefinitions?: ColorDefinition[]; columns?: number } = {}) {
    super(locale);
    const colorDefinitions = options.colorDefinitions || [];
    this.columns = options.columns || 5;
    const viewStyleAttribute = { gridTemplateColumns: `repeat(${this.columns}, 1fr)` };
    this.set('selectedColor', undefined);
    this.items.on('add', (evt, colorTile: ColorTileView) => {
      colorTile.isOn = colorTile.color === this.selectedColor;
    });
    colorDefinitions.forEach(color => {
      const colorTile = new ColorTileView();
      colorTile.set({
        color: color.color,
        label: color.label,
        tooltip: true,
        hasBorder: !!(color.options && color.options.hasBorder)
      });
      colorTile.on('execute', () => {
        this.fire('execute', { value: color.color, hasBorder: color.options && color.options.hasBorder, label: color.label });
      });
      this.items.add(colorTile);
    });
    this.setTemplate({
      tag: 'div',
      children: this.items,
      attributes: { class: ['ck', 'ck-color-grid'], style: viewStyleAttribute as any }
    });
    this.on('change:selectedColor', (evt, name, selectedColor: string) => {
      for (const item of this.items) {
        item.isOn = item.color === selectedColor;
      }
    });
  }

  public focus(): void {
    if (this.items.length) this.items.first!.focus();
  }

  public focusLast(): void {
    if (this.items.length) this.items.last!.focus();
  }

  public override render(): void {
    super.render();
    for (const item of this.items) this.focusTracker.add(item.element!);
    this.items.on('add', (evt, item: View) => this.focusTracker.add(item.element!));
    this.items.on('remove', (evt, item: View) => this.focusTracker.remove(item.element!));
    this.keystrokes.listenTo(this.element as any);
    const focusTile = (direction: number) => {
      const index = this.items.map(i => i).findIndex(i => i.element === this.focusTracker.focusedElement);
      const next = this.items.get(Math.max(0, Math.min(this.items.length - 1, index + direction)));
      if (next) next.focus();
    };
    this.keystrokes.set('arrowright', (data, cancel) => {
      focusTile(1);
      cancel();
    });
    this.keystrokes.set('arrowleft', (data, cancel) => {
      focusTile(-1);
      cancel();
    });
    this.keystrokes.set('arrowdown', (data, cancel) => {
      focusTile(this.columns);
      cancel();
    });
    this.keystrokes.set('arrowup', (data, cancel) => {
      focusTile(-this.columns);
      cancel();
    });
  }

  public override destroy(): void {
    super.destroy();
    this.focusTracker.destroy();
    this.keystrokes.destroy();
  }
}
