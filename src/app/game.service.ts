import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

export interface Abilities {
  strength: number; dexterity: number; constitution: number;
  intelligence: number; wisdom: number; charisma: number;
}

export interface Character {
  id?: number; name: string; className: string; species: string; level: number;
  armorClass: number; hitPoints: number; speed: number; abilities: Abilities; notes: string;
}

export interface Monster {
  id?: number; name: string; size: string; creatureType: string; challengeRating: string;
  armorClass: number; hitPoints: number; speed: number; abilities: Abilities; actions: string;
}

export interface Party {
  id: number; name: string; inviteCode: string; dmId: number; dmName: string;
  members: { id: number; displayName: string; characterId: number | null; characterName: string | null }[];
}

export interface Combatant {
  id: number; userId: number | null; sourceType: 'character' | 'monster'; name: string;
  armorClass: number; maxHp: number; currentHp: number; initiative: number; abilities: Abilities;
  conditions: string[];
}
export interface Encounter {
  id: number; partyId: number; dmId: number; name: string; status: 'active' | 'completed';
  round: number; turnIndex: number; actionTaken: boolean; combatants: Combatant[];
  logs: { id: number; message: string; rollData: Record<string, unknown> | null; createdAt: number }[];
}

@Injectable({ providedIn: 'root' })
export class GameService {
  private readonly http = inject(HttpClient);
  listCharacters() { return this.http.get<{ characters: Character[] }>('/api/characters'); }
  saveCharacter(character: Character) {
    return character.id
      ? this.http.put<{ character: Character }>(`/api/characters/${character.id}`, character)
      : this.http.post<{ character: Character }>('/api/characters', character);
  }
  deleteCharacter(id: number) { return this.http.delete<void>(`/api/characters/${id}`); }
  listMonsters() { return this.http.get<{ monsters: Monster[] }>('/api/monsters'); }
  saveMonster(monster: Monster) {
    return monster.id
      ? this.http.put<{ monster: Monster }>(`/api/monsters/${monster.id}`, monster)
      : this.http.post<{ monster: Monster }>('/api/monsters', monster);
  }
  deleteMonster(id: number) { return this.http.delete<void>(`/api/monsters/${id}`); }
  listParties() { return this.http.get<{ parties: Party[] }>('/api/parties'); }
  createParty(name: string) { return this.http.post<{ party: Party }>('/api/parties', { name }); }
  joinParty(inviteCode: string, characterId: number | null) {
    return this.http.post<{ party: Party }>('/api/parties/join', { inviteCode, characterId });
  }
  listEncounters() { return this.http.get<{ encounters: Encounter[] }>('/api/encounters'); }
  createEncounter(name: string, partyId: number, monsterIds: number[]) {
    return this.http.post<{ encounter: Encounter }>('/api/encounters', { name, partyId, monsterIds });
  }
  getEncounter(id: number) { return this.http.get<{ encounter: Encounter }>(`/api/encounters/${id}`); }
  act(id: number, action: { type: 'attack' | 'heal'; targetId: number; ability: string; damageDie: number }) {
    return this.http.post<{ encounter: Encounter }>(`/api/encounters/${id}/actions`, action);
  }
  nextTurn(id: number) { return this.http.post<{ encounter: Encounter }>(`/api/encounters/${id}/next`, {}); }
  endEncounter(id: number) { return this.http.post<void>(`/api/encounters/${id}/end`, {}); }
}
