// Úložiště Cloudflare R2 (rozhraní S3). Koncepty příspěvků (JPEG + JSON) se nahrají do složky
// drafts/; Instagram si obrázek stáhne z veřejné adresy bucketu (R2_PUBLIC_URL).
// Token R2 má mít práva jen na tento bucket: nic jiného úloha nepotřebuje.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AwsClient } from 'aws4fetch';

export interface R2Config {
  /** Adresa pro nahrávání (S3 API), např. https://<účet>.eu.r2.cloudflarestorage.com u bucketu v EU. */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Veřejná adresa bucketu (r2.dev nebo vlastní doména), bez lomítka na konci. */
  publicUrl: string;
}

/**
 * Adresa pro nahrávání: R2_ENDPOINT, když je nastavený (bucket v EU má .eu. v adrese),
 * jinak se složí z R2_ACCOUNT_ID.
 */
export function r2Endpoint(env: NodeJS.ProcessEnv): string | null {
  if (env.R2_ENDPOINT) return env.R2_ENDPOINT.replace(/\/+$/, '');
  if (env.R2_ACCOUNT_ID) return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return null;
}

export function r2FromEnv(env: NodeJS.ProcessEnv = process.env): R2Config {
  const need = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'] as const;
  const missing: string[] = need.filter((k) => !env[k]);
  const endpoint = r2Endpoint(env);
  if (!endpoint) missing.push('R2_ENDPOINT (nebo R2_ACCOUNT_ID)');
  if (missing.length) throw new Error(`Chybí nastavení úložiště: ${missing.join(', ')} (postup je v docs/nastaveni.md).`);
  return {
    endpoint: endpoint as string,
    accessKeyId: env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
    bucket: env.R2_BUCKET as string,
    publicUrl: (env.R2_PUBLIC_URL as string).replace(/\/+$/, ''),
  };
}

export const publicUrl = (cfg: Pick<R2Config, 'publicUrl'>, key: string): string => `${cfg.publicUrl}/${key}`;

const s3 = (cfg: R2Config) => new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: 's3', region: 'auto' });

export async function putObject(cfg: R2Config, key: string, body: Buffer | string, contentType: string): Promise<string> {
  const url = `${cfg.endpoint}/${cfg.bucket}/${key}`;
  const res = await s3(cfg).fetch(url, { method: 'PUT', body: typeof body === 'string' ? body : new Blob([new Uint8Array(body)]), headers: { 'Content-Type': contentType, 'Cache-Control': 'max-age=300' } });
  if (!res.ok) throw new Error(`Nahrání ${key} do R2 selhalo: stav ${res.status} ${await res.text().catch(() => '')}`.trim());
  return publicUrl(cfg, key);
}

/** Text objektu z R2 přes S3 API (bez mezipaměti veřejné adresy); `null`, když objekt není. */
export async function getObject(cfg: R2Config, key: string): Promise<string | null> {
  const res = await s3(cfg).fetch(`${cfg.endpoint}/${cfg.bucket}/${key}`, { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Čtení ${key} z R2 selhalo: stav ${res.status}`);
  return res.text();
}

/** Malé úložiště textů (uložená kola, značky): R2, místní složka, nebo paměť v testech. */
export interface Store {
  label: string;
  get(key: string): Promise<string | null>;
  put(key: string, body: string): Promise<void>;
}

export function r2Store(cfg: R2Config): Store {
  return {
    label: `R2 ${cfg.bucket}`,
    get: (key) => getObject(cfg, key),
    put: async (key, body) => {
      await putObject(cfg, key, body, 'application/json');
    },
  };
}

export function dirStore(dir: string): Store {
  return {
    label: `složka ${dir}`,
    get: async (key) => (existsSync(join(dir, key)) ? readFileSync(join(dir, key), 'utf8') : null),
    put: async (key, body) => {
      mkdirSync(dirname(join(dir, key)), { recursive: true });
      writeFileSync(join(dir, key), body);
    },
  };
}

export function memoryStore(init: Record<string, string> = {}): Store & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { label: 'paměť', data, get: async (key) => data.get(key) ?? null, put: async (key, body) => void data.set(key, body) };
}
