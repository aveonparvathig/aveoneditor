/**
 * Angular forms support for the `<aveon-editor>` element in Angular 14–21 (the `aveon-angular`
 * package needs Angular 22). Copy this file into your app and import the directive next to
 * `CUSTOM_ELEMENTS_SCHEMA`:
 *
 *   import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
 *   import { AveonEditorValueAccessor } from './aveon-editor-value-accessor.directive';
 *
 *   @Component({
 *     standalone: true,
 *     imports: [FormsModule, ReactiveFormsModule, AveonEditorValueAccessor],
 *     schemas: [CUSTOM_ELEMENTS_SCHEMA],
 *     template: `<aveon-editor preset="cms" [(ngModel)]="body"></aveon-editor>
 *                <aveon-editor preset="erp" [formControl]="terms"></aveon-editor>`
 *   })
 *
 * The element itself comes from the central host (`<script type="module" src=".../aveon-editor.standalone.js">`
 * in index.html) or from the npm package (`import { defineEditorElement } from '@aveon/editor';
 * defineEditorElement();` in main.ts).
 */

import { Directive, ElementRef, forwardRef, HostListener } from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';

@Directive({
  selector: 'aveon-editor[ngModel], aveon-editor[formControl], aveon-editor[formControlName]',
  standalone: true,
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
