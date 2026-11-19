// Péče o token Instagramu (ranní úloha token): ověření platnosti a prodloužení.

import { describe, expect, it, vi } from 'vitest';
import { IgError, refreshToken } from '../src/instagram.ts';

/** Falešné Graph API: odpověď podle začátku cesty, zapisuje volané cesty. */
function fakeGraph(routes: Record<string, { status: number; body: unknown }>) {
  const paths: string[] = [];
  const f = vi.fn(async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname.slice(1) + new URL(String(url)).search;
    paths.push(path);
    const hit = Object.entries(routes).find(([prefix]) => path.startsWith(prefix));
    const r = hit?.[1] ?? { status: 404, body: { error: { message: 'neznámá cesta' } } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  return { f: f as unknown as typeof fetch, paths };
}

const FB = 'EAAtesttoken';

describe('token Instagramu', () => {
  it('token Facebooku: debug_token řekne, že platí a nevyprší', async () => {
    const { f, paths } = fakeGraph({ debug_token: { status: 200, body: { data: { is_valid: true, expires_at: 0 } } } });
    expect(await refreshToken({ fetch: f, token: FB })).toEqual({ token: FB, changed: false, days: null });
    expect(paths).toHaveLength(1);
  });

  it('token Facebooku bez práv na debug_token (kód 100): ověří se obyčejným voláním, poplach ne', async () => {
    const { f, paths } = fakeGraph({
      debug_token: { status: 400, body: { error: { message: 'You must provide an app access token, or a user access token that is an owner or developer of the app', code: 100 } } },
      me: { status: 200, body: { id: '123' } },
    });
    expect(await refreshToken({ fetch: f, token: FB })).toEqual({ token: FB, changed: false, days: null });
    expect(paths.map((p) => p.split('?')[0])).toEqual(['debug_token', 'me']);
  });

  it('token Facebooku, který neplatí (kód 190), je chyba: úloha založí issue', async () => {
    const { f } = fakeGraph({
      debug_token: { status: 400, body: { error: { message: 'no developer', code: 100 } } },
      me: { status: 400, body: { error: { message: 'Error validating access token', code: 190 } } },
    });
    await expect(refreshToken({ fetch: f, token: FB })).rejects.toBeInstanceOf(IgError);
  });

  it('token Facebooku, který podle debug_token vyprší: počet dní', async () => {
    const now = 1_800_000_000;
    const { f } = fakeGraph({ debug_token: { status: 200, body: { data: { is_valid: true, expires_at: now + 9 * 86400 + 100 } } } });
    expect((await refreshToken({ fetch: f, token: FB }, now)).days).toBe(9);
  });

  it('token Instagramu se prodlouží o 60 dní', async () => {
    const { f, paths } = fakeGraph({ refresh_access_token: { status: 200, body: { access_token: 'IGnew', expires_in: 60 * 86400 } } });
    expect(await refreshToken({ fetch: f, token: 'IGold' })).toEqual({ token: 'IGnew', changed: true, days: 60 });
    expect(paths[0]).toContain('grant_type=ig_refresh_token');
  });
});
