import { Plugin } from '../../core/plugin';
import { LinkEditing } from './linkediting';
import { LinkUI } from './linkui';
import { AutoLink } from './autolink';

/** The link feature. */
export class Link extends Plugin {
  public static override get requires() {
    return [LinkEditing, LinkUI, AutoLink];
  }

  public static override get pluginName(): string {
    return 'Link';
  }
}

export { LinkEditing, LinkUI, AutoLink };
export { LinkCommand, UnlinkCommand, ManualDecorator } from './linkediting';
export { LinkFormView, LinkActionsView } from './linkui';
export * from './utils';
