export type EntityId = string;

export function createStableEntityId(namespace: string, seed: string): EntityId {
  let hash = 0x811c9dc5;
  const source = `${namespace}:${seed}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${namespace}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
