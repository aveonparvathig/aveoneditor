import { Plugin } from '../core/plugin';

/** Notification plugin: fires `show:success|info|warning` events; the host app may listen and render them. */
export class Notification extends Plugin {
  public static override get pluginName(): string {
    return 'Notification';
  }

  public override init(): void {
    this.on('show:warning', (evt, data: { message: string }) => {
      window.alert(data.message);
    }, { priority: 'lowest' });
  }

  public showSuccess(message: string, data: { title?: string; namespace?: string } = {}): void {
    this._showNotification({ message, type: 'success', namespace: data.namespace, title: data.title });
  }

  public showInfo(message: string, data: { title?: string; namespace?: string } = {}): void {
    this._showNotification({ message, type: 'info', namespace: data.namespace, title: data.title });
  }

  public showWarning(message: string, data: { title?: string; namespace?: string } = {}): void {
    this._showNotification({ message, type: 'warning', namespace: data.namespace, title: data.title });
  }

  private _showNotification(data: { message: string; type: string; namespace?: string; title?: string }): void {
    const event = data.namespace ? `show:${data.type}:${data.namespace}` : `show:${data.type}`;
    this.fire(event, { message: data.message, type: data.type, title: data.title || '' });
  }
}
