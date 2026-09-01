import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('renders the campaign landing page', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain(
      'Every legend',
    );
    expect(fixture.nativeElement.textContent).toContain('Built for 2024 rules');
  });

  it('opens the login workflow with the selected role', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.site-header .text-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const playerButton = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((button) => (button as HTMLButtonElement).textContent?.includes('Player'));
    (playerButton as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelectorAll('.role-picker button')[1].classList,
    ).toContain('selected');
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
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('completes login with valid credentials', () => {
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

    expect(fixture.nativeElement.querySelector('.welcome')?.textContent).toContain(
      'signed in as a Dungeon Master',
    );
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
  });
});
