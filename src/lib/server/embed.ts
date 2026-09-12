import { EMBEDDING } from '$lib/game/config.ts';

export async function embedRemote(ai: Ai, text: string): Promise<Float32Array> {
  const result = (await ai.run(EMBEDDING.workersAi, { text: [text] })) as { data?: number[][] };
  const row = result?.data?.[0];
  if (!row) throw new Error('empty embedding response');
  return Float32Array.from(row);
}
