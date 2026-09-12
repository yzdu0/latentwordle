import { D1Store } from './d1.ts';
import { MemoryStore } from './memory.ts';
import type { Store } from './store.ts';

export function getStore(env: Env | undefined): Store {
  if (env?.DB) return new D1Store(env.DB);
  return MemoryStore.fromDir();
}
