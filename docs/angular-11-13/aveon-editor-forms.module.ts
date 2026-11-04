/**
 * Angular forms support for the `<aveon-editor>` element in Angular 11–13, which have no standalone
 * components (Angular 14–21: `docs/angular-14-21`; Angular 22: the `aveon-angular` package).
 * Copy this file into your app and import the module where the editor is used:
 *
 *   import { CUSTOM_ELEMENTS_SCHEMA, NgModule } from '@angular/core';
 *   import { FormsModule, ReactiveFormsModule } from '@angular/forms';
 *   import { AveonEditorFormsModule } from './aveon-editor-forms.module';
 *
 *   @NgModule({
 *     imports: [BrowserModule, FormsModule, ReactiveFormsModule, AveonEditorFormsModule],
 *     declarations: [AppComponent],
 *     schemas: [CUSTOM_ELEMENTS_SCHEMA],
 *     bootstrap: [AppComponent]
 *   })
 *   export class AppModule {}
 *
 * and in a template: `<aveon-editor preset="cms" [(ngModel)]="body"></aveon-editor>`.
 *
 * Load the element itself with the standalone files in index.html, not from the npm package (the
 * library is ES2022, which the Angular 11–13 build does not compile):
 *
 *   <link rel="stylesheet" href=".../aveon-editor.standalone.css">
 *   <script type="module" src=".../aveon-editor.standalone.js"></script>
 */

import { Directive, ElementRef, forwardRef, HostListener, NgModule } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Directive({
  selector: 'aveon-editor[ngModel], aveon-editor[formControl], aveon-editor[formControlName]',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => AveonEditorValueAccessor), multi: true }]
})
export class AveonEditorValueAccessor implements ControlValueAccessor {
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};
  private writing = false;

  constructor(private readonly host: ElementRef<HTMLElement & { value: string }>) {}

  public writeValue(value: string | null): void {
    // Works before the editor has started too: the element keeps the value until it is ready.
    // Its own `input` echo is ignored, so the form does not count this as a user change.
    this.writing = true;
    try {
      this.host.nativeElement.value = value ?? '';
    } finally {
      this.writing = false;
    }
  }

  public registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  public registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  public setDisabledState(disabled: boolean): void {
    this.host.nativeElement.toggleAttribute('disabled', disabled);
  }

  // `input` fires on every change; reading `value` then gives the current HTML.
  @HostListener('input')
  public handleInput(): void {
    if (!this.writing) this.onChange(this.host.nativeElement.value);
  }

  @HostListener('focusout')
  public handleBlur(): void {
    this.onTouched();
  }
}

@NgModule({
  declarations: [AveonEditorValueAccessor],
  exports: [AveonEditorValueAccessor]
})
export class AveonEditorFormsModule {}
