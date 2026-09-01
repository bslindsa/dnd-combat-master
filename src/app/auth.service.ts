import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, of, tap } from 'rxjs';

export type Role = 'Dungeon Master' | 'Player';

export interface AuthUser {
  id: number;
  email: string;
  displayName: string;
  role: Role;
}

interface AuthResponse {
  user: AuthUser;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  readonly user = signal<AuthUser | null>(null);

  restoreSession(): Observable<AuthResponse | null> {
    return this.http.get<AuthResponse>('/api/auth/session').pipe(
      tap(({ user }) => this.user.set(user)),
      catchError(() => {
        this.user.set(null);
        return of(null);
      }),
    );
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/api/auth/login', { email, password })
      .pipe(tap(({ user }) => this.user.set(user)));
  }

  register(
    email: string,
    displayName: string,
    password: string,
    role: Role,
  ): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/api/auth/register', { email, displayName, password, role })
      .pipe(tap(({ user }) => this.user.set(user)));
  }

  logout(): Observable<void> {
    return this.http
      .post<void>('/api/auth/logout', {})
      .pipe(tap(() => this.user.set(null)));
  }
}
