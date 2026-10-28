import { Component, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { ClassicEditor, classicPreset, classicDefaultConfig, type Editor, type EditorConfig } from '@aveon/editor';
import { AveonEditorComponent, type AveonEditorChangeEvent } from 'aveon-angular';

@Component({
  imports: [AveonEditorComponent, FormsModule, ReactiveFormsModule],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  /** The editor class, bound to `[editor]` like the CKEditor Angular component. */
  protected readonly Editor = ClassicEditor;

  protected readonly config: EditorConfig = {
    ...classicDefaultConfig,
    plugins: classicPreset,
    placeholder: 'Write your article...'
  };

  /** Template-driven form example. */
  protected content = '<h2>Hello from Angular</h2><p>This content is bound with <strong>ngModel</strong>.</p><ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul><p>Equation: <span class="math-tex">\\(E = mc^2\\)</span></p>';

  /** Reactive form example. */
  protected readonly bodyControl = new FormControl('<p>Reactive form control content.</p>');

  protected readonly status = signal('Loading editor...');
  protected readonly changes = signal(0);
  protected readonly disabled = signal(false);

  protected onReady(editor: Editor): void {
    this.status.set(`Ready (${Array.from(editor.plugins).length} plugins)`);
  }

  protected onChange(event: AveonEditorChangeEvent): void {
    this.changes.update(count => count + 1);
    void event;
  }

  protected onFocus(): void {
    this.status.set('Focused');
  }

  protected onBlur(): void {
    this.status.set('Blurred');
  }

  protected toggleDisabled(): void {
    this.disabled.update(value => !value);
    if (this.disabled()) {
      this.bodyControl.disable();
    } else {
      this.bodyControl.enable();
    }
  }

  protected resetContent(): void {
    this.content = '<p>Reset from the component.</p>';
    this.bodyControl.setValue('<p>Reactive control reset.</p>');
  }
}
