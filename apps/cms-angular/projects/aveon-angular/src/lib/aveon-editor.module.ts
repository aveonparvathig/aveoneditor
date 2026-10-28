import { NgModule } from '@angular/core';
import { AveonEditorComponent } from './aveon-editor.component';

/** NgModule for applications that are not standalone-based. Standalone apps can import `AveonEditorComponent` directly. */
@NgModule({
  imports: [AveonEditorComponent],
  exports: [AveonEditorComponent]
})
export class AveonEditorModule {}
