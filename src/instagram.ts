// Instagram API: vydání obrázku a péče o token. Převzato z Pub League (promo/ig/social.ts), kde
// to běží denně; zkrácené na obrázky (Venca zatím nedělá videa).
//
// Meta má pro Instagram dvě adresy a token říká, která platí: token Instagramu (začíná IG) mluví
// s graph.instagram.com, token Facebooku z Unified loginu (začíná EAA) s graph.facebook.com.

export const IG_API = 'https://graph.instagram.com';
export const FB_API = 'https://graph.facebook.com';

export const apiHost = (token: string): string => (token.startsWith('IG') ? IG_API : FB_API);

export interface IgIo {
  fetch: typeof fetch;
  token: string;
  /** Id účtu Instagramu; bez něj se zjistí z tokenu. */
  userId?: string;
  sleep?: (ms: number) => Promise<void>;
}

export interface ImagePost {
  /** Veřejná adresa JPEGu: Instagram si soubor stahuje sám. */
  url: string;
  caption: string;
}

export class IgError extends Error {
  code: number | null;
  constructor(message: string, code: number | null = null) {
    super(message);
    this.code = code;
  }
}

interface IgErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number };
}

async function igCall<T>(io: IgIo, method: 'GET' | 'POST', path: string, body?: Record<string, string>): Promise<T> {
  const safe = (text: string) => text.split(io.token).join('***');
  let res: Response;
  try {
    res = await io.fetch(`${apiHost(io.token)}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${io.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    throw new IgError(safe(`Instagram neodpověděl: ${e instanceof Error ? e.message : String(e)}`));
  }
  const json = (await res.json().catch(() => null)) as (T & IgErrorBody) | null;
  if (!res.ok || !json || json.error) {
    const err = json?.error;
    throw new IgError(safe(`Instagram odmítl ${method} ${path.split('?')[0]}: ${err?.message ?? `stav ${res.status}`}${err?.code ? ` (kód ${err.code}${err.error_subcode ? `/${err.error_subcode}` : ''})` : ''}`), err?.code ?? null);
  }
  return json;
}

interface AccountRef {
  id?: string;
  username?: string;
}
interface AccountItem extends AccountRef {
  instagram_business_account?: AccountRef;
  instagram_account?: AccountRef;
}

/** Účet Instagramu, na který token vydává (u tokenu Facebooku se hledá mezi přiřazenými účty). */
export async function accountId(io: IgIo): Promise<string> {
  if (io.userId) return io.userId;
  if (apiHost(io.token) === IG_API) return 'me';
  const found = new Map<string, string>();
  let why = '';
  for (const path of ['me/assigned_instagram_accounts?fields=id,username', 'me/accounts?fields=instagram_business_account{id,username}']) {
    try {
      const list = await igCall<{ data?: AccountItem[] }>(io, 'GET', path);
      for (const item of list.data ?? []) {
        const acc = item.instagram_business_account ?? item.instagram_account ?? (path.startsWith('me/assigned') ? item : undefined);
        if (acc?.id) found.set(acc.id, acc.username ?? acc.id);
      }
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
    if (found.size) break;
  }
  if (found.size === 1) return [...found.keys()][0] as string;
  if (found.size > 1) throw new IgError(`Token má přístup k více účtům Instagramu (${[...found.values()].join(', ')}): urči ten pravý tajemstvím IG_USER_ID.`);
  throw new IgError(`K tokenu se nenašel žádný účet Instagramu${why ? ` (${why})` : ''}. Zkontroluj oprávnění tokenu, nebo zadej id účtu tajemstvím IG_USER_ID.`);
}

export interface Published {
  id: string;
  permalink: string | null;
}

/** Založí kontejner a počká, až ho Instagram zpracuje. Nic se tím nezveřejní. */
export async function prepareContainer(io: IgIo, post: ImagePost, opts: { polls?: number; pollMs?: number } = {}): Promise<{ account: string; container: string }> {
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const account = await accountId(io);
  const container = await igCall<{ id: string }>(io, 'POST', `${account}/media`, { image_url: post.url, caption: post.caption });
  const polls = opts.polls ?? 36;
  let status = '';
  for (let i = 0; i < polls; i++) {
    const state = await igCall<{ status_code?: string; status?: string }>(io, 'GET', `${container.id}?fields=status_code,status`);
    status = state.status_code ?? '';
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED') throw new IgError(`Instagram soubor nezpracoval (${status}): ${state.status ?? 'bez podrobností'}`);
    await sleep(opts.pollMs ?? 5000);
  }
  if (status !== 'FINISHED') throw new IgError('Instagram soubor nestihl zpracovat (kontejner není hotový).');
  return { account, container: container.id };
}

/** Vydá obrázek s popiskem. */
export async function publishImage(io: IgIo, post: ImagePost, opts: { polls?: number; pollMs?: number } = {}): Promise<Published> {
  const { account, container } = await prepareContainer(io, post, opts);
  const done = await igCall<{ id: string }>(io, 'POST', `${account}/media_publish`, { creation_id: container });
  const link = await igCall<{ permalink?: string }>(io, 'GET', `${done.id}?fields=permalink`).catch(() => null);
  return { id: done.id, permalink: link?.permalink ?? null };
}

export interface Refreshed {
  token: string;
  changed: boolean;
  /** Kolik dní token ještě platí; `null`, když nevyprší. */
  days: number | null;
}

/** Prodlouží token Instagramu o 60 dní; u tokenu Facebooku jen ověří platnost. */
export async function refreshToken(io: IgIo, now: number = Date.now() / 1000): Promise<Refreshed> {
  if (apiHost(io.token) === FB_API) {
    const info = await igCall<{ data?: { is_valid?: boolean; expires_at?: number } }>(io, 'GET', `debug_token?input_token=${encodeURIComponent(io.token)}`);
    if (!info.data || info.data.is_valid === false) throw new IgError('Token už neplatí: vystav nový a ulož ho do tajemství IG_ACCESS_TOKEN.', 190);
    const until = info.data.expires_at ?? 0;
    return { token: io.token, changed: false, days: until > 0 ? Math.max(0, Math.floor((until - now) / 86400)) : null };
  }
  const out = await igCall<{ access_token?: string; expires_in?: number }>(io, 'GET', `refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(io.token)}`);
  if (!out.access_token) throw new IgError('Instagram při obnově nevrátil token.');
  return { token: out.access_token, changed: out.access_token !== io.token, days: Math.floor((out.expires_in ?? 0) / 86400) };
}

/** Je JPEG na veřejné adrese? Instagram by chybu hlásil až při zpracování. */
export async function checkImage(io: Pick<IgIo, 'fetch' | 'sleep'>, url: string, tries = 5): Promise<void> {
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let why = '';
  for (let i = 0; i < tries; i++) {
    try {
      const res = await io.fetch(url, { headers: { Range: 'bytes=0-0' } });
      const type = res.headers.get('content-type') ?? '';
      if ((res.status === 200 || res.status === 206) && type.startsWith('image/jpeg')) return;
      why = `stav ${res.status}, druh ${type || 'neuvedený'}`;
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
    if (i < tries - 1) await sleep(3000);
  }
  throw new IgError(`Obrázek pro Instagram není veřejně dostupný jako JPEG (${why}).`);
}
