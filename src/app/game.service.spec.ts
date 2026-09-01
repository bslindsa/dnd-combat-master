import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Character, GameService } from './game.service';

describe('GameService', () => {
  let service: GameService;
  let http: HttpTestingController;
  const character: Character = {
    name: 'Aelindra', className: 'Wizard', species: 'Elf', level: 5,
    armorClass: 15, hitPoints: 32, speed: 30, notes: '',
    abilities: { strength: 8, dexterity: 14, constitution: 12, intelligence: 18, wisdom: 11, charisma: 10 },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(GameService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('creates a new character', () => {
    service.saveCharacter(character).subscribe();
    const request = http.expectOne('/api/characters');
    expect(request.request.method).toBe('POST');
    expect(request.request.body.name).toBe('Aelindra');
    request.flush({ character: { ...character, id: 1 } });
  });

  it('updates an existing character', () => {
    service.saveCharacter({ ...character, id: 4 }).subscribe();
    const request = http.expectOne('/api/characters/4');
    expect(request.request.method).toBe('PUT');
    request.flush({ character: { ...character, id: 4 } });
  });

  it('joins a party using an owned character', () => {
    service.joinParty('A1B2C3', 4).subscribe();
    const request = http.expectOne('/api/parties/join');
    expect(request.request.body).toEqual({ inviteCode: 'A1B2C3', characterId: 4 });
    request.flush({ party: {} });
  });

  it('submits a server-authoritative combat action', () => {
    service.act(7, { type: 'attack', targetId: 3, ability: 'strength', damageDie: 8 }).subscribe();
    const request = http.expectOne('/api/encounters/7/actions');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      type: 'attack', targetId: 3, ability: 'strength', damageDie: 8,
    });
    request.flush({ encounter: {} });
  });
});
