import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

type Role = 'Dungeon Master' | 'Player';

@Component({
  imports: [ReactiveFormsModule],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  private readonly document = inject(DOCUMENT);
  private readonly loginDialog = viewChild<ElementRef<HTMLElement>>('loginDialog');
  private previousFocus: HTMLElement | null = null;

  protected readonly loginOpen = signal(false);
  protected readonly authenticated = signal(false);
  protected readonly role = signal<Role>('Dungeon Master');
  protected readonly loginForm = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
  });

  protected openLogin(role: Role = 'Dungeon Master'): void {
    this.previousFocus = this.document.activeElement as HTMLElement | null;
    this.role.set(role);
    this.loginOpen.set(true);
    queueMicrotask(() => this.loginDialog()?.nativeElement.focus());
  }

  protected closeLogin(): void {
    this.loginOpen.set(false);
    queueMicrotask(() => this.previousFocus?.focus());
  }

  protected selectRole(role: Role): void {
    this.role.set(role);
  }

  protected logIn(): void {
    this.loginForm.markAllAsTouched();
    if (this.loginForm.valid) {
      this.authenticated.set(true);
      this.loginOpen.set(false);
    }
  }

  protected logOut(): void {
    this.authenticated.set(false);
    this.loginForm.reset();
  }
}
