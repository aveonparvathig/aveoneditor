import { Plugin } from '../../core/plugin';
import { View } from '../../ui/view';
import { ButtonView } from '../../ui/button/buttonview';
import { createDropdown } from '../../ui/dropdown/dropdownview';
import { icons } from '../../ui/icons';
import { Typing } from '../typing/typing';
import type { Locale } from '../../utils/locale';

const CHARACTERS: Record<string, Array<{ title: string; character: string }>> = {
  Arrows: [
    { title: 'leftwards arrow', character: '←' },
    { title: 'rightwards arrow', character: '→' },
    { title: 'upwards arrow', character: '↑' },
    { title: 'downwards arrow', character: '↓' },
    { title: 'left right arrow', character: '↔' },
    { title: 'up down arrow', character: '↕' },
    { title: 'leftwards double arrow', character: '⇐' },
    { title: 'rightwards double arrow', character: '⇒' }
  ],
  Currency: [
    { title: 'Dollar sign', character: '$' },
    { title: 'Euro sign', character: '€' },
    { title: 'Yen sign', character: '¥' },
    { title: 'Pound sign', character: '£' },
    { title: 'Cent sign', character: '¢' },
    { title: 'Indian rupee sign', character: '₹' },
    { title: 'Won sign', character: '₩' },
    { title: 'Bitcoin sign', character: '₿' }
  ],
  Latin: [
    { title: 'Latin capital letter a with macron', character: 'Ā' },
    { title: 'Latin small letter a with macron', character: 'ā' },
    { title: 'Latin capital letter c with cedilla', character: 'Ç' },
    { title: 'Latin small letter c with cedilla', character: 'ç' },
    { title: 'Latin capital letter e with acute', character: 'É' },
    { title: 'Latin small letter e with acute', character: 'é' },
    { title: 'Latin small letter n with tilde', character: 'ñ' },
    { title: 'Latin small letter sharp s', character: 'ß' },
    { title: 'Latin small letter o with diaeresis', character: 'ö' },
    { title: 'Latin small letter u with diaeresis', character: 'ü' }
  ],
  Mathematical: [
    { title: 'Plus-minus sign', character: '±' },
    { title: 'Multiplication sign', character: '×' },
    { title: 'Division sign', character: '÷' },
    { title: 'Not equal to', character: '≠' },
    { title: 'Less-than or equal to', character: '≤' },
    { title: 'Greater-than or equal to', character: '≥' },
    { title: 'Infinity', character: '∞' },
    { title: 'Square root', character: '√' },
    { title: 'Approximately equal to', character: '≈' },
    { title: 'Degree sign', character: '°' }
  ],
  Text: [
    { title: 'Copyright sign', character: '©' },
    { title: 'Registered sign', character: '®' },
    { title: 'Trade mark sign', character: '™' },
    { title: 'Section sign', character: '§' },
    { title: 'Paragraph sign', character: '¶' },
    { title: 'Em dash', character: '—' },
    { title: 'En dash', character: '–' },
    { title: 'Horizontal ellipsis', character: '…' },
    { title: 'Left double quotation mark', character: '“' },
    { title: 'Right double quotation mark', character: '”' },
    { title: 'Bullet', character: '•' }
  ]
};

/** Grid of characters grouped by category, inserted at the selection. */
export class SpecialCharacters extends Plugin {
  private _characters = new Map<string, Map<string, string>>();

  public static override get requires() {
    return [Typing];
  }

  public static override get pluginName(): string {
    return 'SpecialCharacters';
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    for (const [group, items] of Object.entries(CHARACTERS)) {
      this.addItems(group, items);
    }
    editor.ui.componentFactory.add('specialCharacters', locale => {
      const dropdownView = createDropdown(locale);
      dropdownView.buttonView.set({ label: t('Special characters'), icon: icons.specialCharacters, tooltip: true });
      dropdownView.once('change:isOpen', () => {
        const gridView = new CharacterGridView(locale, this._characters, t);
        gridView.on('execute', (evt, data: { character: string }) => {
          editor.execute('insertText', { text: data.character });
          dropdownView.isOpen = false;
          editor.editing.view.focus();
        });
        dropdownView.panelView.children.add(gridView);
      });
      return dropdownView;
    });
  }

  public addItems(groupName: string, items: Array<{ title: string; character: string }>): void {
    if (!this._characters.has(groupName)) this._characters.set(groupName, new Map());
    const group = this._characters.get(groupName)!;
    for (const item of items) group.set(item.title, item.character);
  }

  public getGroups(): Iterable<string> {
    return this._characters.keys();
  }
}

class CharacterGridView extends View {
  public readonly tiles = this.createCollection();
  public readonly groupButtons = this.createCollection();
  declare public currentGroup: string;

  constructor(locale: Locale, characters: Map<string, Map<string, string>>, t: (s: string) => string) {
    super(locale);
    const groups = Array.from(characters.keys());
    this.set('currentGroup', groups[0]);
    for (const group of groups) {
      const button = new ButtonView(locale);
      button.set({ label: t(group), withText: true, isToggleable: true });
      button.bind('isOn').to(this, 'currentGroup', (value: string) => value === group);
      button.on('execute', () => {
        this.currentGroup = group;
      });
      this.groupButtons.add(button);
    }
    this.setTemplate({
      tag: 'div',
      attributes: { class: ['ck', 'ck-special-characters'], style: { padding: '8px', minWidth: '320px' } as any },
      children: [
        { tag: 'div', attributes: { class: ['ck', 'ck-special-characters__groups'], style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' } as any }, children: this.groupButtons },
        { tag: 'div', attributes: { class: ['ck', 'ck-character-grid'], style: { display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '2px' } as any }, children: this.tiles }
      ]
    });
    this.on('change:currentGroup', () => this._renderTiles(characters));
  }

  public override render(): void {
    super.render();
    this._renderTiles();
  }

  private _charactersRef: Map<string, Map<string, string>> | null = null;

  private _renderTiles(characters?: Map<string, Map<string, string>>): void {
    if (characters) this._charactersRef = characters;
    if (!this._charactersRef) return;
    this.tiles.clear();
    const group = this._charactersRef.get(this.currentGroup);
    if (!group) return;
    for (const [title, character] of group) {
      const tile = new ButtonView(this.locale);
      tile.set({ label: character, withText: true, tooltip: title, class: 'ck-character-grid__tile' });
      tile.on('execute', () => this.fire('execute', { character, name: title }));
      this.tiles.add(tile);
    }
  }
}
