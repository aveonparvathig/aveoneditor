export type LanguageDirection = 'ltr' | 'rtl';

const rtlLanguages = ['ar', 'ara', 'dv', 'div', 'fa', 'per', 'fas', 'he', 'heb', 'ku', 'kur', 'ug', 'uig', 'ur', 'urd'];

export function getLanguageDirection(languageCode: string): LanguageDirection {
  return rtlLanguages.includes(languageCode.split('-')[0]) ? 'rtl' : 'ltr';
}

export type Translations = Record<string, Record<string, string | string[]>>;

const dictionaries: Translations = {};

export function addTranslations(language: string, translations: Record<string, string | string[]>): void {
  dictionaries[language] = { ...(dictionaries[language] || {}), ...translations };
}

export type TranslateFn = (message: string | { string: string; plural?: string; id?: string }, values?: unknown | unknown[]) => string;

/** Editor locale: UI language, content language and a translation function `t()`. */
export class Locale {
  public readonly uiLanguage: string;
  public readonly contentLanguage: string;
  public readonly uiLanguageDirection: LanguageDirection;
  public readonly contentLanguageDirection: LanguageDirection;
  public readonly t: TranslateFn;

  constructor({ uiLanguage = 'en', contentLanguage, translations }: { uiLanguage?: string; contentLanguage?: string; translations?: Translations } = {}) {
    this.uiLanguage = uiLanguage;
    this.contentLanguage = contentLanguage || uiLanguage;
    this.uiLanguageDirection = getLanguageDirection(this.uiLanguage);
    this.contentLanguageDirection = getLanguageDirection(this.contentLanguage);
    if (translations) {
      for (const [lang, dict] of Object.entries(translations)) addTranslations(lang, dict);
    }
    this.t = (message, values) => this._t(message, values);
  }

  private _t(message: string | { string: string; plural?: string; id?: string }, values?: unknown | unknown[]): string {
    const vals = Array.isArray(values) ? values : values === undefined ? [] : [values];
    const str = typeof message === 'string' ? message : message.string;
    const dict = dictionaries[this.uiLanguage];
    let translated = str;
    if (dict && dict[str] !== undefined) {
      const entry = dict[str];
      translated = Array.isArray(entry) ? entry[0] : entry;
    }
    return translated.replace(/%(\d+)/g, (_, index) => String(vals[Number(index)] ?? ''));
  }
}
