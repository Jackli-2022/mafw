import { createPluginWebTicketStore } from '../../../src/plugins/plugin-web-ticket';

describe('plugin web ticket store', () => {
  it('issues a package-bound ticket and rejects cross-package use', () => {
    const store = createPluginWebTicketStore({ now: () => 1000, ttlMs: 1000 });
    const { ticket, expiresAt } = store.issue('demo', { projectDir: '/repo' });

    expect(ticket).toMatch(/^[0-9a-f]{48}$/);
    expect(expiresAt).toBe(2000);
    expect(store.verify('demo', ticket)).toEqual({ projectDir: '/repo' });
    expect(store.verify('other', ticket)).toBeNull();
  });

  it('binds the optional session and never leaks the package name', () => {
    const store = createPluginWebTicketStore({ now: () => 0, ttlMs: 10_000 });
    const { ticket } = store.issue('demo', { projectDir: '/repo', sessionID: 'ses_1' });

    expect(store.verify('demo', ticket)).toEqual({ projectDir: '/repo', sessionID: 'ses_1' });
    expect(store.verify('demo', 'nope')).toBeNull();
    expect(store.verify('demo', '')).toBeNull();
  });

  it('expires tickets after the ttl', () => {
    let now = 500;
    const store = createPluginWebTicketStore({ now: () => now, ttlMs: 1000 });
    const { ticket } = store.issue('demo', { projectDir: '/repo' });

    now = 1499;
    expect(store.verify('demo', ticket)).not.toBeNull();
    now = 1500;
    expect(store.verify('demo', ticket)).toBeNull();
    // Expired entries are dropped, so a later refresh cannot resurrect them.
    expect(store.refresh(ticket)).toBeNull();
  });

  it('refreshes a live ticket by extending its expiry', () => {
    let now = 0;
    const store = createPluginWebTicketStore({ now: () => now, ttlMs: 1000 });
    const { ticket } = store.issue('demo', { projectDir: '/repo' });

    now = 900;
    expect(store.refresh(ticket)).toEqual({ ticket, expiresAt: 1900 });
    now = 1800;
    expect(store.verify('demo', ticket)).toEqual({ projectDir: '/repo' });

    expect(store.refresh('unknown')).toBeNull();
  });

  it('keeps one live ticket per package + project + session', () => {
    const store = createPluginWebTicketStore({ now: () => 0, ttlMs: 1000 });
    const first = store.issue('demo', { projectDir: '/repo', sessionID: 's1' });
    const second = store.issue('demo', { projectDir: '/repo', sessionID: 's1' });

    expect(first.ticket).not.toBe(second.ticket);
    expect(store.verify('demo', first.ticket)).toBeNull();
    expect(store.verify('demo', second.ticket)).toEqual({ projectDir: '/repo', sessionID: 's1' });

    // A different session (or project) does not revoke the other ticket.
    const other = store.issue('demo', { projectDir: '/repo', sessionID: 's2' });
    expect(store.verify('demo', second.ticket)).not.toBeNull();
    expect(store.verify('demo', other.ticket)).not.toBeNull();
  });

  it('rejects invalid ttl values', () => {
    expect(() => createPluginWebTicketStore({ ttlMs: 0 })).toThrow(/ttlMs/);
    expect(() => createPluginWebTicketStore({ ttlMs: Number.NaN })).toThrow(/ttlMs/);
  });
});
