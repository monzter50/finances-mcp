import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resolveEnv } from '../src/config.js';

describe('loadConfig', () => {
  it('throws without FINANCES_API_URL', () => {
    expect(() => loadConfig({ FINANCES_API_TOKEN: 'fpat_x' })).toThrow('FINANCES_API_URL is required');
  });

  it('throws without FINANCES_API_TOKEN', () => {
    expect(() => loadConfig({ FINANCES_API_URL: 'http://localhost:3000/api' })).toThrow('FINANCES_API_TOKEN');
  });

  it('rejects a token that is not a personal API token', () => {
    expect(() => loadConfig({ FINANCES_API_URL: 'http://x/api', FINANCES_API_TOKEN: 'eyJhbGciOi...' })).toThrow('fpat_');
  });

  it('trims trailing slashes from the URL', () => {
    const cfg = loadConfig({ FINANCES_API_URL: ' http://localhost:3000/api// ', FINANCES_API_TOKEN: 'fpat_x' });
    expect(cfg.apiUrl).toBe('http://localhost:3000/api');
  });
});

describe('loadConfig URL scheme', () => {
  const token = { FINANCES_API_TOKEN: 'fpat_x' };

  it('allows http for localhost', () => {
    expect(loadConfig({ ...token, FINANCES_API_URL: 'http://127.0.0.1:3000/api' }).apiUrl).toBe('http://127.0.0.1:3000/api');
  });

  it('rejects plain http for remote hosts', () => {
    expect(() => loadConfig({ ...token, FINANCES_API_URL: 'http://api.example.com/api' })).toThrow('https');
  });

  it('accepts https for remote hosts', () => {
    expect(loadConfig({ ...token, FINANCES_API_URL: 'https://api.example.com/api' }).apiUrl).toBe('https://api.example.com/api');
  });
});

describe('resolveEnv', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'finances-mcp-'));
    writeFileSync(join(root, '.env.staging'), 'FINANCES_API_URL=https://staging.example.com/api\nFINANCES_API_TOKEN=fpat_staging\n');
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('returns the process env unchanged without --env', () => {
    const env = { FINANCES_API_URL: 'x' };
    expect(resolveEnv([], env, root)).toBe(env);
  });

  it('loads .env.<name> and lets it win over the process env', () => {
    const env = resolveEnv(['--env', 'staging'], { FINANCES_API_URL: 'http://localhost:3000/api', HOME: '/h' }, root);
    expect(env.FINANCES_API_URL).toBe('https://staging.example.com/api');
    expect(env.FINANCES_API_TOKEN).toBe('fpat_staging');
    expect(env.HOME).toBe('/h');
  });

  it('throws when the env file is missing', () => {
    expect(() => resolveEnv(['--env', 'production'], {}, root)).toThrow('.env.production not found');
  });

  it('rejects names that could escape the repo root', () => {
    expect(() => resolveEnv(['--env', '../secrets'], {}, root)).toThrow('simple name');
  });

  it('rejects unknown flags', () => {
    expect(() => resolveEnv(['--envv', 'staging'], {}, root)).toThrow();
  });
});
