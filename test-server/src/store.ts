import type { Pet, NewPet } from "./schemas.ts";

let nextId = 1;
const pets = new Map<number, Pet>();

export function listPets(): Pet[] {
  return [...pets.values()];
}

export function getPet(id: number): Pet | undefined {
  return pets.get(id);
}

export function createPet(data: NewPet): Pet {
  const pet: Pet = { id: nextId++, ...data, status: data.status ?? "available" };
  pets.set(pet.id, pet);
  return pet;
}

export function updatePet(id: number, data: NewPet): Pet | undefined {
  if (!pets.has(id)) return undefined;
  const pet: Pet = { id, ...data, status: data.status ?? "available" };
  pets.set(id, pet);
  return pet;
}

export function deletePet(id: number): boolean {
  return pets.delete(id);
}

export function resetStore(): void {
  pets.clear();
  nextId = 1;
}
