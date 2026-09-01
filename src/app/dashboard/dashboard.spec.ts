import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../auth.service';
import { Encounter, GameService } from '../game.service';
import { Dashboard } from './dashboard';

describe('Dashboard combat', () => {
  let fixture: ComponentFixture<Dashboard>;
  const encounter: Encounter = {
    id: 7, partyId: 2, dmId: 1, name: 'Crypt Battle', status: 'active',
    round: 1, turnIndex: 0, actionTaken: false,
    combatants: [
      { id: 10, userId: 1, sourceType: 'character', name: 'Kael', armorClass: 16,
        maxHp: 20, currentHp: 20, initiative: 18, abilities: { strength: 16, dexterity: 12,
        constitution: 14, intelligence: 10, wisdom: 10, charisma: 10 }, conditions: [] },
      { id: 11, userId: null, sourceType: 'monster', name: 'Skeleton', armorClass: 13,
        maxHp: 13, currentHp: 13, initiative: 12, abilities: { strength: 10, dexterity: 14,
        constitution: 10, intelligence: 6, wisdom: 8, charisma: 5 }, conditions: [] },
    ],
    logs: [],
  };
  const game = {
    listCharacters: vi.fn(() => of({ characters: [] })),
    listMonsters: vi.fn(() => of({ monsters: [] })),
    listParties: vi.fn(() => of({ parties: [] })),
    listEncounters: vi.fn(() => of({ encounters: [encounter] })),
    getEncounter: vi.fn(() => of({ encounter })),
    act: vi.fn(() => of({ encounter: { ...encounter, actionTaken: true } })),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [
        { provide: GameService, useValue: game },
        { provide: AuthService, useValue: { user: signal(null) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Dashboard);
    fixture.componentRef.setInput('user', {
      id: 1, email: 'dm@example.com', displayName: 'DM', role: 'Dungeon Master',
    });
    fixture.detectChanges();
  });

  it('refreshes an active encounter when selected', () => {
    (fixture.componentInstance as any).selectEncounter(encounter);
    expect(game.getEncounter).toHaveBeenCalledWith(7);
  });

  it('does not dispatch another action after the turn action is spent', () => {
    (fixture.componentInstance as any).activeEncounter.set({ ...encounter, actionTaken: true });
    (fixture.componentInstance as any).actionForm.patchValue({ targetId: 11 });
    (fixture.componentInstance as any).takeAction();
    expect(game.act).not.toHaveBeenCalled();
  });
});
