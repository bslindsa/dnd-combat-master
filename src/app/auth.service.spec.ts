import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService, AuthUser } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;
  const user: AuthUser = {
    id: 1,
    email: 'dm@example.com',
    displayName: 'Dungeon Guide',
    role: 'Dungeon Master',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('authenticates with the backend and stores the returned user', () => {
    service.login('dm@example.com', 'roll-for-initiative').subscribe();
    const request = http.expectOne('/api/auth/login');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      email: 'dm@example.com',
      password: 'roll-for-initiative',
    });
    request.flush({ user });

    expect(service.user()).toEqual(user);
  });

  it('clears stale state when session restoration is unauthorized', () => {
    service.user.set(user);
    service.restoreSession().subscribe((response) => expect(response).toBeNull());
    http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(service.user()).toBeNull();
  });
});
