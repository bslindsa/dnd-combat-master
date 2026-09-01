import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService, Role } from './auth.service';
import { Dashboard } from './dashboard/dashboard';

@Component({
  imports: [ReactiveFormsModule, Dashboard],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(AuthService);
  private readonly loginDialog = viewChild<ElementRef<HTMLElement>>('loginDialog');
  private previousFocus: HTMLElement | null = null;

  protected readonly loginOpen = signal(false);
  protected readonly authenticated = computed(() => this.auth.user() !== null);
  protected readonly currentUser = this.auth.user;
  protected readonly role = signal<Role>('Dungeon Master');
  protected readonly creatingAccount = signal(false);
  protected readonly submitting = signal(false);
  protected readonly authError = signal('');
  protected readonly loginForm = new FormGroup({
    displayName: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
  });

  constructor() {
    this.auth.restoreSession().subscribe();
  }

  protected openLogin(role: Role = 'Dungeon Master'): void {
    this.previousFocus = this.document.activeElement as HTMLElement | null;
    this.role.set(role);
    this.authError.set('');
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

  protected toggleAccountMode(): void {
    this.creatingAccount.update((creating) => !creating);
    this.authError.set('');
  }

  protected logIn(): void {
    this.loginForm.markAllAsTouched();
    const { email, displayName, password } = this.loginForm.getRawValue();
    const invalidName =
      this.creatingAccount() && (displayName.trim().length < 2 || displayName.trim().length > 60);
    if (this.loginForm.invalid || invalidName) return;

    this.submitting.set(true);
    this.authError.set('');
    const request = this.creatingAccount()
      ? this.auth.register(email, displayName.trim(), password, this.role())
      : this.auth.login(email, password);
    request.pipe(finalize(() => this.submitting.set(false))).subscribe({
      next: () => this.closeLogin(),
      error: (error) =>
        this.authError.set(error.error?.error ?? 'Unable to sign in. Please try again.'),
    });
  }

  protected logOut(): void {
    this.auth.logout().subscribe({
      next: () => this.loginForm.reset(),
      error: () => this.authError.set('Unable to log out. Please try again.'),
    });
  }
}
