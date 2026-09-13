import fs, { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import readline from 'node:readline';
import { EMBEDDINGS } from '../../src/lib/game/config.ts';
import type { EmbeddingKey } from '../../src/lib/game/config.ts';

export type EmbeddingSpec = (typeof EMBEDDINGS)[EmbeddingKey];

export function embeddingKeyFromArgs(args = process.argv): EmbeddingKey {
  const hit = args.find((arg) => arg.startsWith('--embedding='));
  const key = hit?.slice('--embedding='.length) ?? 'word2vec';
  if (key !== 'glove' && key !== 'word2vec') {
    throw new Error(`unknown embedding "${key}"; expected glove or word2vec`);
  }
  return key;
}

export function argValue(flag: string, args = process.argv): string | null {
  const prefix = `--${flag}=`;
  const hit = args.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

export async function downloadIfMissing(spec: EmbeddingSpec, archive: string): Promise<void> {
  if (fs.existsSync(archive)) return;
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  console.error(`downloading ${spec.model} to ${archive}`);
  const response = await fetch(spec.url);
  if (!response.ok || !response.body) throw new Error(`download failed: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as never), fs.createWriteStream(archive));
}

export interface EmbeddingRecord {
  word: string;
  vector: Float32Array | null;
}

export interface ReadEmbeddingOptions {
  /** Only decode vector bytes for selected words. Omit to decode every vector. */
  wanted?: ReadonlySet<string>;
}

async function* readTextArchive(
  archive: string,
  options: ReadEmbeddingOptions,
): AsyncGenerator<EmbeddingRecord> {
  const lines = readline.createInterface({
    input: createReadStream(archive).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  let first = true;
  for await (const line of lines) {
    if (first) {
      first = false;
      continue;
    }
    const space = line.indexOf(' ');
    if (space <= 0) continue;
    const word = line.slice(0, space);
    const vector =
      options.wanted && !options.wanted.has(word)
        ? null
        : Float32Array.from(line.slice(space + 1).split(' '), Number);
    yield { word, vector };
  }
}

class AsyncByteReader {
  private iterator: AsyncIterator<Buffer>;
  private buffer = Buffer.alloc(0);
  private offset = 0;

  constructor(stream: AsyncIterable<Buffer>) {
    this.iterator = stream[Symbol.asyncIterator]();
  }

  private async fill(size: number): Promise<boolean> {
    while (this.buffer.length - this.offset < size) {
      const remaining = this.buffer.subarray(this.offset);
      const next = await this.iterator.next();
      if (next.done) {
        this.buffer = remaining;
        this.offset = 0;
        return this.buffer.length >= size;
      }
      this.buffer = remaining.length ? Buffer.concat([remaining, next.value]) : next.value;
      this.offset = 0;
    }
    return true;
  }

  async read(size: number): Promise<Buffer> {
    if (!(await this.fill(size))) throw new Error('unexpected end of Word2Vec archive');
    const value = this.buffer.subarray(this.offset, this.offset + size);
    this.offset += size;
    return value;
  }

  async readUntil(delimiter: number): Promise<Buffer> {
    const parts: Buffer[] = [];
    while (true) {
      const index = this.buffer.indexOf(delimiter, this.offset);
      if (index >= 0) {
        parts.push(this.buffer.subarray(this.offset, index));
        this.offset = index + 1;
        return parts.length === 1 ? parts[0] : Buffer.concat(parts);
      }
      if (this.offset < this.buffer.length) parts.push(this.buffer.subarray(this.offset));
      this.buffer = Buffer.alloc(0);
      this.offset = 0;
      const next = await this.iterator.next();
      if (next.done) throw new Error('unexpected end of Word2Vec archive');
      this.buffer = next.value;
    }
  }
}

async function* readWord2VecBinaryArchive(
  archive: string,
  options: ReadEmbeddingOptions,
): AsyncGenerator<EmbeddingRecord> {
  const gunzip = createReadStream(archive).pipe(createGunzip());
  const reader = new AsyncByteReader(gunzip as AsyncIterable<Buffer>);
  const header = (await reader.readUntil(0x0a)).toString('ascii').trim().split(/\s+/);
  const count = Number(header[0]);
  const dim = Number(header[1]);
  if (!Number.isInteger(count) || !Number.isInteger(dim) || count <= 0 || dim <= 0) {
    throw new Error(`invalid Word2Vec header: ${header.join(' ')}`);
  }

  for (let row = 0; row < count; row++) {
    // Gensim's archive packs records back-to-back; the original C format may
    // include a newline before the next token. Accept both representations.
    const word = (await reader.readUntil(0x20)).toString('utf8').replace(/^\n+/, '');
    const bytes = await reader.read(dim * 4);
    let vector: Float32Array | null = null;
    if (!options.wanted || options.wanted.has(word)) {
      vector = new Float32Array(dim);
      for (let column = 0; column < dim; column++) vector[column] = bytes.readFloatLE(column * 4);
    }
    yield { word, vector };
  }
}

export function readEmbeddingArchive(
  spec: EmbeddingSpec,
  archive: string,
  options: ReadEmbeddingOptions = {},
): AsyncGenerator<EmbeddingRecord> {
  return spec.format === 'text'
    ? readTextArchive(archive, options)
    : readWord2VecBinaryArchive(archive, options);
}
