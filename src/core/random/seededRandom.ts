function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class SeededRandom {
  private state: number;

  constructor(seed: string) {
    this.state = hashSeed(seed) || 0x6d2b79f5;
  }

  next(): number {
    this.state += 0x6d2b79f5;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  integer(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new Error("SeededRandom.integer received an invalid range");
    }
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("SeededRandom.pick received an empty list");
    return items[this.integer(0, items.length - 1)];
  }

  chance(probability: number): boolean {
    return this.next() < Math.max(0, Math.min(1, probability));
  }

  fork(scope: string): SeededRandom {
    return new SeededRandom(`${this.state}:${scope}`);
  }
}
