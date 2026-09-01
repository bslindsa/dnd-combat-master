import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { AuthService, AuthUser } from './auth.service';

describe('App', () => {
  const user = signal<AuthUser | null>(null);
  const dm: AuthUser = {
    id: 1,
    email: 'dm@example.com',
    displayName: 'Dungeon Guide',
    role: 'Dungeon Master',
  };
  const auth = {
    user,
    restoreSession: vi.fn(() => of(null)),
    login: vi.fn(() => {
      user.set(dm);
      return of({ user: dm });
    }),
    register: vi.fn(() => of({ user: dm })),
    logout: vi.fn(() => {
      user.set(null);
      return of(undefined);
    }),
  };

  beforeEach(async () => {
    user.set(null);
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compileComponents();
  });

  it('renders the campaign landing page', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Every legend');
    expect(fixture.nativeElement.textContent).toContain('Built for 2024 rules');
    expect(auth.restoreSession).toHaveBeenCalledOnce();
  });

  it('opens account creation with the selected role', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.site-header .text-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.signup button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const playerButton = fixture.nativeElement.querySelectorAll(
      '.role-picker button',
    )[1] as HTMLButtonElement;
    playerButton.click();
    fixture.detectChanges();

    expect(playerButton.classList).toContain('selected');
    expect(fixture.nativeElement.querySelector('#display-name')).toBeTruthy();
  });

  it('validates credentials before signing in', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.site-header .text-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.field-error')).toHaveLength(2);
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('closes the login with Escape and returns focus to its trigger', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector(
      '.site-header .text-button',
    ) as HTMLButtonElement;
    trigger.focus();
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(document.activeElement).toBe(dialog);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('signs in through the authentication service', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.site-header .text-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const email = fixture.nativeElement.querySelector('#email') as HTMLInputElement;
    const password = fixture.nativeElement.querySelector('#password') as HTMLInputElement;
    email.value = 'dm@example.com';
    email.dispatchEvent(new Event('input'));
    password.value = 'roll-for-initiative';
    password.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    fixture.detectChanges();

    expect(auth.login).toHaveBeenCalledWith('dm@example.com', 'roll-for-initiative');
    expect(fixture.nativeElement.querySelector('.welcome')?.textContent).toContain(
      'signed in as a Dungeon Master',
    );
  });

  it('shows backend authentication errors', () => {
    auth.login.mockReturnValueOnce(
      throwError(() => ({ error: { error: 'Email or password is incorrect.' } })),
    );
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.site-header .text-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    for (const [selector, value] of [
      ['#email', 'dm@example.com'],
      ['#password', 'wrong-password'],
    ]) {
      const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Email or password is incorrect.',
    );
  });
});
