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
}
