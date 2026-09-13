import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { EMBEDDINGS } from '../../src/lib/game/config.ts';
import { readEmbeddingArchive } from './pretrained-embeddings.ts';

const temporaryDirectories: string[] = [];

function fixture(name: string, contents: Buffer | string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'latentguess-embeddings-'));
  temporaryDirectories.push(directory);
  const file = path.join(directory, name);
  fs.writeFileSync(file, gzipSync(contents));
  return file;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true });
});

describe('readEmbeddingArchive', () => {
  it('reads GloVe text archives and skips unrequested vectors', async () => {
    const file = fixture('glove.gz', '2 3\ncat 1 2 3\ndog 4 5 6\n');
    const records = [];
    for await (const record of readEmbeddingArchive(EMBEDDINGS.glove, file, {
      wanted: new Set(['dog']),
    })) {
      records.push(record);
    }
    expect(records[0]).toEqual({ word: 'cat', vector: null });
    expect(records[1].word).toBe('dog');
    expect([...records[1].vector!]).toEqual([4, 5, 6]);
  });

  it('reads packed Word2Vec binary archives', async () => {
    const cat = Buffer.alloc(8);
    cat.writeFloatLE(0.25, 0);
    cat.writeFloatLE(-0.5, 4);
    const dog = Buffer.alloc(8);
    dog.writeFloatLE(1, 0);
    dog.writeFloatLE(0, 4);
    const file = fixture(
      'word2vec.gz',
      Buffer.concat([Buffer.from('2 2\ncat '), cat, Buffer.from('dog '), dog]),
    );
    const records = [];
    for await (const record of readEmbeddingArchive(EMBEDDINGS.word2vec, file)) records.push(record);
    expect(records.map((record) => record.word)).toEqual(['cat', 'dog']);
    expect([...records[0].vector!]).toEqual([0.25, -0.5]);
    expect([...records[1].vector!]).toEqual([1, 0]);
  });
});
