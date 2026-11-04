import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  forwardRef,
  HostBinding,
  Input,
  NgZone,
  OnDestroy,
  Output
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import type { Editor, EditorConfig } from '@aveon/editor';

/** Any editor class exposing a static `create()` (ClassicEditor, InlineEditor, BalloonEditor, DecoupledEditor...). */
export interface AveonEditorConstructor {
  create(sourceElementOrData: HTMLElement | string, config?: EditorConfig): Promise<Editor>;
}

export interface AveonEditorReadyEvent {
  editor: Editor;
}

export interface AveonEditorChangeEvent {
  event: unknown;
  editor: Editor;
}

export interface AveonEditorFocusEvent {
  event: unknown;
  editor: Editor;
}

export interface AveonEditorBlurEvent {
  event: unknown;
  editor: Editor;
}

const DISABLED_LOCK = Symbol('aveon-angular-disabled');

/**
 * `<aveon-editor>` component.
 */
@Component({
  selector: 'aveon-editor',
  standalone: true,
  template: '<ng-template></ng-template>',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AveonEditorComponent),
      multi: true
    }
  ]
})
export class AveonEditorComponent implements AfterViewInit, OnDestroy, ControlValueAccessor {
  /** The editor class to use, e.g. `ClassicEditor` from `@aveon/editor`. Required. */
  @Input() public editor?: AveonEditorConstructor;

  /** Editor configuration passed to `create()`. */
  @Input() public config: EditorConfig = {};

  /** Initial data. Prefer `[(ngModel)]` or reactive forms for two-way binding. */
  @Input() public set data(value: string) {
    this._data = value ?? '';
    if (this.editorInstance && !this._twoWayBindingActive) {
      this.editorInstance.setData(this._data);
    }
  }
  public get data(): string {
    return this._data;
  }

  /** Tag name of the element the editor is created on. */
  @Input() public tagName = 'div';

  /** Colour theme of the editor (`'light'` or `'dark'`), applied as `data-theme` on the host. */
  @Input() @HostBinding('attr.data-theme') public theme?: 'light' | 'dark';

  /** Disables the editor (read-only mode). Also controlled through forms' disabled state. */
  @Input() public set disabled(value: boolean) {
    this.setDisabledState(value);
  }
  public get disabled(): boolean {
    return this._disabled;
  }

  /** When `true`, the component stops calling the form callback on every change (better for large documents). */
  @Input() public disableTwoWayDataBinding = false;

  /** Fires when the editor is ready. The payload is the editor instance. */
  @Output() public ready = new EventEmitter<Editor>();

  /** Fires on every data change. */
  @Output() public change = new EventEmitter<AveonEditorChangeEvent>();

  @Output() public blur = new EventEmitter<AveonEditorBlurEvent>();

  @Output() public focus = new EventEmitter<AveonEditorFocusEvent>();

  /** Fires when editor creation fails. */
  @Output() public error = new EventEmitter<unknown>();

  /** The editor instance, available once `ready` has fired. */
  public editorInstance: Editor | null = null;

  private _data = '';
  private _disabled = false;
  private _twoWayBindingActive = false;
  private _editorElement: HTMLElement | null = null;
  private _destroyed = false;
  private _cvaOnChange: (data: string) => void = () => {};
  private _cvaOnTouched: () => void = () => {};

  constructor(private readonly _elementRef: ElementRef<HTMLElement>, private readonly _ngZone: NgZone) {}

  public ngAfterViewInit(): void {
    if (!this.editor) {
      const err = new Error('aveon-angular: the `editor` input is required (e.g. [editor]="ClassicEditor").');
      this.error.emit(err);
      console.error(err);
      return;
    }
    this._ngZone.runOutsideAngular(() => {
      this._createEditor().catch(err => {
        console.error(err);
        this._ngZone.run(() => this.error.emit(err));
      });
    });
  }

  public ngOnDestroy(): void {
    this._destroyed = true;
    if (this.editorInstance) {
      const instance = this.editorInstance;
      this.editorInstance = null;
      instance.destroy().catch(err => console.error(err));
    }
    this._editorElement?.remove();
  }

  // ControlValueAccessor

  public writeValue(value: string | null): void {
    this._data = value ?? '';
    if (this.editorInstance) {
      this.editorInstance.setData(this._data);
    }
  }

  public registerOnChange(callback: (data: string) => void): void {
    this._cvaOnChange = callback;
    this._twoWayBindingActive = true;
  }

  public registerOnTouched(callback: () => void): void {
    this._cvaOnTouched = callback;
  }

  public setDisabledState(isDisabled: boolean): void {
    this._disabled = isDisabled;
    if (!this.editorInstance) return;
    if (isDisabled) {
      this.editorInstance.enableReadOnlyMode(DISABLED_LOCK);
    } else {
      this.editorInstance.disableReadOnlyMode(DISABLED_LOCK);
    }
  }

  private async _createEditor(): Promise<void> {
    const host = this._elementRef.nativeElement;
    const element = document.createElement(this.tagName);
    host.appendChild(element);
    this._editorElement = element;

    const config: EditorConfig = { ...this.config };
    const initialData = this._data;
    if (initialData && config['initialData'] === undefined) {
      config['initialData'] = initialData;
    }

    const editor = await this.editor!.create(element, config);

    // The component was destroyed while the editor was being created.
    if (this._destroyed) {
      await editor.destroy();
      return;
    }

    // `writeValue()` (e.g. from ngModel) may have arrived while the editor was being created.
    if (this._data !== initialData) {
      editor.setData(this._data);
    }

    this.editorInstance = editor;
    if (this._disabled) {
      editor.enableReadOnlyMode(DISABLED_LOCK);
    }
    this._setUpListeners(editor);
    this._ngZone.run(() => this.ready.emit(editor));
  }

  private _setUpListeners(editor: Editor): void {
    const modelDocument = editor.model.document;
    const viewDocument = editor.editing.view.document;

    modelDocument.on('change:data', (evt: unknown) => {
      this._ngZone.run(() => {
        if (!this.disableTwoWayDataBinding && this._twoWayBindingActive) {
          const data = editor.getData();
          this._data = data;
          this._cvaOnChange(data);
        }
        this.change.emit({ event: evt, editor });
      });
    });

    viewDocument.on('change:isFocused', (evt: unknown, name: string, isFocused: boolean) => {
      this._ngZone.run(() => {
        if (isFocused) {
          this.focus.emit({ event: evt, editor });
        } else {
          this._cvaOnTouched();
          this.blur.emit({ event: evt, editor });
        }
      });
    });
  }
}
