import { env, pipeline } from '@huggingface/transformers';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import fs from 'node:fs';
import path from 'node:path';

const SPIKE_DIR = path.resolve(import.meta.dirname, '..');
const CACHE_ROOT = path.join(SPIKE_DIR, '.cache');
env.cacheDir = path.join(CACHE_ROOT, 'models');
env.allowLocalModels = false;

export type ModelKey = 'bge' | 'bge-base' | 'minilm' | 'qwen3' | 'qwen3-mean' | 'qwen3-cls';
export type Backend = 'local' | 'workers-ai';

export interface ModelSpec {
  hfId: string;
  cfId: string;
  pooling: 'cls' | 'mean' | 'last_token';
  dim: number;
}

export const MODELS: Record<ModelKey, ModelSpec> = {
  bge: {
    hfId: 'Xenova/bge-small-en-v1.5',
    cfId: '@cf/baai/bge-small-en-v1.5',
    pooling: 'cls',
    dim: 384,
  },
  'bge-base': {
    hfId: 'Xenova/bge-base-en-v1.5',
    cfId: '@cf/baai/bge-base-en-v1.5',
    pooling: 'cls',
    dim: 768,
  },
  minilm: {
    hfId: 'Xenova/all-MiniLM-L6-v2',
    cfId: '',
    pooling: 'mean',
    dim: 384,
  },
  qwen3: {
    hfId: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
    cfId: '@cf/qwen/qwen3-embedding-0.6b',
    pooling: 'last_token',
    dim: 1024,
  },
  'qwen3-mean': {
    hfId: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
    cfId: '@cf/qwen/qwen3-embedding-0.6b',
    pooling: 'mean',
    dim: 1024,
  },
  'qwen3-cls': {
    hfId: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
    cfId: '@cf/qwen/qwen3-embedding-0.6b',
    pooling: 'cls',
    dim: 1024,
  },
};

export function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const inv = sum > 0 ? 1 / Math.sqrt(sum) : 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
}

const extractors = new Map<string, Promise<FeatureExtractionPipeline>>();

function createExtractor(spec: ModelSpec, quantized: boolean): Promise<FeatureExtractionPipeline> {
  const options = quantized ? { dtype: 'q8' as const } : {};
  return pipeline('feature-extraction', spec.hfId, options) as unknown as Promise<FeatureExtractionPipeline>;
}

async function getExtractor(spec: ModelSpec): Promise<FeatureExtractionPipeline> {
  let promise = extractors.get(spec.hfId);
  if (!promise) {
    console.error(`loading model ${spec.hfId} (first run downloads weights)...`);
    promise = createExtractor(spec, true).catch(() => createExtractor(spec, false));
    extractors.set(spec.hfId, promise);
  }
  return promise;
}

async function embedLocal(
  texts: string[],
  spec: ModelSpec,
  onProgress?: (done: number, total: number) => void,
): Promise<Float32Array[]> {
  const extractor = await getExtractor(spec);
  const out: Float32Array[] = [];
  const batchSize = 64;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const tensor = await extractor(batch, { pooling: spec.pooling, normalize: true });
    const raw = tensor.tolist() as number[][] | number[];
    const rows = Array.isArray(raw[0]) ? (raw as number[][]) : [raw as number[]];
    for (const row of rows) out.push(normalize(Float32Array.from(row)));
    onProgress?.(Math.min(i + batchSize, texts.length), texts.length);
  }
  return out;
}

async function embedWorkersAI(
  texts: string[],
  spec: ModelSpec,
  onProgress?: (done: number, total: number) => void,
): Promise<Float32Array[]> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    throw new Error('Workers AI backend needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  }
  if (!spec.cfId) throw new Error(`no Workers AI model mapped for ${spec.hfId}`);
  const out: Float32Array[] = [];
  const batchSize = 100;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${spec.cfId}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: batch }),
      },
    );
    const json = (await res.json()) as { success: boolean; errors?: unknown; result?: { data: number[][] } };
    if (!json.success || !json.result) {
      throw new Error(`Workers AI error: ${JSON.stringify(json.errors ?? json)}`);
    }
    for (const row of json.result.data) out.push(normalize(Float32Array.from(row)));
    onProgress?.(Math.min(i + batchSize, texts.length), texts.length);
  }
  return out;
}

export interface CacheMeta {
  model: ModelKey;
  backend: Backend;
  dim: number;
  words: string[];
}

export class EmbeddingStore {
  readonly model: ModelKey;
  readonly backend: Backend;
  readonly dim: number;
  private words: string[];
  private index: Map<string, number>;
  private vectors: Float32Array;
  private dir: string;

  private constructor(model: ModelKey, backend: Backend, meta: CacheMeta | null, vectors: Float32Array | null) {
    this.model = model;
    this.backend = backend;
    this.dim = MODELS[model].dim;
    this.words = meta?.words ?? [];
    this.index = new Map(this.words.map((w, i) => [w, i]));
    this.vectors = vectors ?? new Float32Array(0);
    this.dir = path.join(CACHE_ROOT, 'emb', `${model}--${backend}`);
  }

  static open(model: ModelKey, backend: Backend = 'local'): EmbeddingStore {
    const dir = path.join(CACHE_ROOT, 'emb', `${model}--${backend}`);
    const idxPath = path.join(dir, 'index.json');
    const vecPath = path.join(dir, 'vectors.f32');
    if (fs.existsSync(idxPath) && fs.existsSync(vecPath)) {
      const meta = JSON.parse(fs.readFileSync(idxPath, 'utf8')) as CacheMeta;
      const buf = fs.readFileSync(vecPath);
      const vectors = new Float32Array(buf.byteLength / 4);
      new Uint8Array(vectors.buffer).set(buf);
      return new EmbeddingStore(model, backend, meta, vectors);
    }
    return new EmbeddingStore(model, backend, null, null);
  }

  get size(): number {
    return this.words.length;
  }

  has(word: string): boolean {
    return this.index.has(word);
  }

  get(word: string): Float32Array | null {
    const i = this.index.get(word);
    if (i === undefined) return null;
    return this.vectors.subarray(i * this.dim, (i + 1) * this.dim);
  }

  getOrThrow(word: string): Float32Array {
    const v = this.get(word);
    if (!v) throw new Error(`missing embedding for "${word}"`);
    return v;
  }

  async ensure(words: string[], onProgress?: (done: number, total: number) => void): Promise<this> {
    const unique = [...new Set(words)].filter((w) => w.length > 0 && !this.index.has(w));
    if (unique.length === 0) return this;
    const spec = MODELS[this.model];
    const embed = this.backend === 'local' ? embedLocal : embedWorkersAI;
    const vectors = await embed(unique, spec, onProgress);
    const next = new Float32Array(this.vectors.length + vectors.length * this.dim);
    next.set(this.vectors);
    let offset = this.vectors.length;
    for (let i = 0; i < unique.length; i++) {
      next.set(vectors[i], offset);
      this.index.set(unique[i], this.words.length);
      this.words.push(unique[i]);
      offset += this.dim;
    }
    this.vectors = next;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(
      path.join(this.dir, 'index.json'),
      JSON.stringify({ model: this.model, backend: this.backend, dim: this.dim, words: this.words }),
    );
    fs.writeFileSync(path.join(this.dir, 'vectors.f32'), Buffer.from(this.vectors.buffer));
    return this;
  }
}
