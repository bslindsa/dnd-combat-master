import { Component, DestroyRef, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, interval, switchMap } from 'rxjs';
import { AuthUser } from '../auth.service';
import { Character, Encounter, GameService, Monster, Party } from '../game.service';

const abilities = () => ({
  strength: new FormControl(10, { nonNullable: true }),
  dexterity: new FormControl(10, { nonNullable: true }),
  constitution: new FormControl(10, { nonNullable: true }),
  intelligence: new FormControl(10, { nonNullable: true }),
  wisdom: new FormControl(10, { nonNullable: true }),
  charisma: new FormControl(10, { nonNullable: true }),
});

@Component({
  selector: 'app-dashboard',
  imports: [ReactiveFormsModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  readonly user = input.required<AuthUser>();
  private readonly game = inject(GameService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly tab = signal<'characters' | 'monsters' | 'party' | 'combat'>('characters');
  protected readonly characters = signal<Character[]>([]);
  protected readonly monsters = signal<Monster[]>([]);
  protected readonly parties = signal<Party[]>([]);
  protected readonly encounters = signal<Encounter[]>([]);
  protected readonly activeEncounter = signal<Encounter | null>(null);
  protected readonly message = signal('');
  protected readonly editingCharacter = signal(false);
  protected readonly editingMonster = signal(false);
  protected readonly characterForm = new FormGroup({
    id: new FormControl<number | null>(null), name: new FormControl('', { nonNullable: true, validators: Validators.required }),
    className: new FormControl('', { nonNullable: true, validators: Validators.required }),
    species: new FormControl('', { nonNullable: true, validators: Validators.required }),
    level: new FormControl(1, { nonNullable: true }), armorClass: new FormControl(10, { nonNullable: true }),
    hitPoints: new FormControl(10, { nonNullable: true }), speed: new FormControl(30, { nonNullable: true }),
    abilities: new FormGroup(abilities()), notes: new FormControl('', { nonNullable: true }),
  });
  protected readonly monsterForm = new FormGroup({
    id: new FormControl<number | null>(null), name: new FormControl('', { nonNullable: true, validators: Validators.required }),
    size: new FormControl('Medium', { nonNullable: true }), creatureType: new FormControl('', { nonNullable: true, validators: Validators.required }),
    challengeRating: new FormControl('1', { nonNullable: true }), armorClass: new FormControl(12, { nonNullable: true }),
    hitPoints: new FormControl(10, { nonNullable: true }), speed: new FormControl(30, { nonNullable: true }),
    abilities: new FormGroup(abilities()), actions: new FormControl('', { nonNullable: true }),
  });
  protected readonly partyName = new FormControl('', { nonNullable: true });
  protected readonly inviteCode = new FormControl('', { nonNullable: true });
  protected readonly partyCharacter = new FormControl<number | null>(null);
  protected readonly encounterForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: Validators.required }),
    partyId: new FormControl<number | null>(null, Validators.required),
    monsterIds: new FormControl<number[]>([], { nonNullable: true }),
  });
  protected readonly actionForm = new FormGroup({
    type: new FormControl<'attack' | 'heal'>('attack', { nonNullable: true }),
    targetId: new FormControl<number | null>(null, Validators.required),
    ability: new FormControl('strength', { nonNullable: true }),
    damageDie: new FormControl(8, { nonNullable: true }),
  });

  constructor() {
    this.reload();
    interval(3000).pipe(
      takeUntilDestroyed(),
      switchMap(() => {
        const encounter = this.activeEncounter();
        return encounter?.status === 'active' ? this.game.getEncounter(encounter.id) : EMPTY;
      }),
    ).subscribe(({ encounter }) => this.activeEncounter.set(encounter));
  }

  protected reload() {
    const failure = () => this.message.set('Some campaign data could not be loaded.');
    this.game.listCharacters().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: ({ characters }) => this.characters.set(characters), error: failure });
    this.game.listMonsters().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: ({ monsters }) => this.monsters.set(monsters), error: failure });
    this.game.listParties().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: ({ parties }) => this.parties.set(parties), error: failure });
    this.game.listEncounters().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: ({ encounters }) => {
        this.encounters.set(encounters);
        const currentId = this.activeEncounter()?.id;
        this.activeEncounter.set(encounters.find(({ id }) => id === currentId) ??
          encounters.find(({ status }) => status === 'active') ?? null);
      }, error: failure });
  }

  protected editCharacter(character?: Character) {
    this.characterForm.reset(character ?? { id: null, name: '', className: '', species: '', level: 1,
      armorClass: 10, hitPoints: 10, speed: 30, abilities: { strength: 10, dexterity: 10,
      constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 }, notes: '' });
    this.editingCharacter.set(true);
  }

  protected saveCharacter() {
    if (this.characterForm.invalid) return;
    this.game.saveCharacter(this.characterForm.getRawValue() as Character).subscribe(() => {
      this.editingCharacter.set(false); this.message.set('Character saved.'); this.reload();
    });
  }

  protected removeCharacter(character: Character) {
    if (character.id && confirm(`Delete ${character.name}?`)) {
      this.game.deleteCharacter(character.id).subscribe(() => this.reload());
    }
  }

  protected editMonster(monster?: Monster) {
    this.monsterForm.reset(monster ?? { id: null, name: '', size: 'Medium', creatureType: '',
      challengeRating: '1', armorClass: 12, hitPoints: 10, speed: 30, abilities: { strength: 10,
      dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 }, actions: '' });
    this.editingMonster.set(true);
  }

  protected saveMonster() {
    if (this.monsterForm.invalid) return;
    this.game.saveMonster(this.monsterForm.getRawValue() as Monster).subscribe(() => {
      this.editingMonster.set(false); this.message.set('Monster saved.'); this.reload();
    });
  }

  protected removeMonster(monster: Monster) {
    if (monster.id && confirm(`Delete ${monster.name}?`)) {
      this.game.deleteMonster(monster.id).subscribe(() => this.reload());
    }
  }

  protected createParty() {
    const name = this.partyName.value.trim();
    if (name) this.game.createParty(name).subscribe(() => { this.partyName.reset(); this.reload(); });
  }

  protected joinParty() {
    this.game.joinParty(this.inviteCode.value, this.partyCharacter.value).subscribe({
      next: () => { this.inviteCode.reset(); this.reload(); },
      error: ({ error }) => this.message.set(error?.error ?? 'Unable to join party.'),
    });
  }

  protected createEncounter() {
    const { name, partyId, monsterIds } = this.encounterForm.getRawValue();
    if (!name.trim() || !partyId) return;
    this.game.createEncounter(name.trim(), partyId, monsterIds).subscribe({
      next: ({ encounter }) => {
        this.activeEncounter.set(encounter); this.encounterForm.reset();
        this.message.set('Initiative rolled. The encounter has begun!'); this.reload();
      },
      error: ({ error }) => this.message.set(error?.error ?? 'Unable to start encounter.'),
    });
  }

  protected selectEncounter(encounter: Encounter) {
    this.activeEncounter.set(encounter);
    if (encounter.status === 'active') {
      this.game.getEncounter(encounter.id).subscribe(({ encounter: current }) => this.activeEncounter.set(current));
    }
  }

  protected takeAction() {
    const encounter = this.activeEncounter();
    const action = this.actionForm.getRawValue();
    if (!encounter || encounter.actionTaken || !action.targetId) return;
    this.game.act(encounter.id, { ...action, targetId: action.targetId }).subscribe({
      next: ({ encounter: current }) => this.activeEncounter.set(current),
      error: ({ error }) => this.message.set(error?.error ?? 'Action could not be completed.'),
    });
  }

  protected nextTurn() {
    const encounter = this.activeEncounter();
    if (encounter) this.game.nextTurn(encounter.id)
      .subscribe(({ encounter: current }) => this.activeEncounter.set(current));
  }

  protected endCombat() {
    const encounter = this.activeEncounter();
    if (encounter && confirm('End this encounter?')) this.game.endEncounter(encounter.id)
      .subscribe(() => { this.activeEncounter.update((current) => current ? { ...current, status: 'completed' } : null); this.reload(); });
  }
}
