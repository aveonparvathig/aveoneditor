# aveon-angular

Angular integration for [Aveon Editor](../../../../README.md). The `<aveon-editor>` component takes the editor class and configuration as inputs and emits the editor events as outputs.

## Usage

```ts
import { ClassicEditor, classicPreset, classicDefaultConfig } from '@aveon/editor';
import { AveonEditorComponent } from 'aveon-angular';

@Component({
  imports: [AveonEditorComponent, FormsModule],
  template: `<aveon-editor [editor]="Editor" [config]="config" [(ngModel)]="body"></aveon-editor>`
})
export class ArticleComponent {
  Editor = ClassicEditor;
  config = { ...classicDefaultConfig, plugins: classicPreset };
  body = '<p>Hello</p>';
}
```

Import the theme once in your global styles:

```css
@import '@aveon/editor/theme.css';
@import 'katex/dist/katex.min.css'; /* equations */
```

## API

| Input | Description |
| --- | --- |
| `editor` | The editor class (`ClassicEditor`, `InlineEditor`, `BalloonEditor`, `DecoupledEditor` or a custom one). Required. |
| `config` | Editor configuration object. |
| `data` | Initial data when not using forms. |
| `tagName` | Tag of the element the editor is created on (default `div`). |
| `disabled` | Puts the editor in read-only mode. Forms' disabled state is honoured too. |
| `disableTwoWayDataBinding` | Stops pushing every change into the form control (useful for very large documents). |

| Output | Payload |
| --- | --- |
| `ready` | The editor instance. |
| `change` | `{ event, editor }` on every data change. |
| `focus` / `blur` | `{ event, editor }`. |
| `error` | The error thrown while creating the editor. |

The component implements `ControlValueAccessor` (`ngModel`, `formControl`, `formControlName`). `AveonEditorModule` is provided for module-based applications. The editor instance is also available as `editorInstance` on the component.

## Build

```bash
ng build aveon-angular
```

The package is written to `dist/aveon-angular`.
