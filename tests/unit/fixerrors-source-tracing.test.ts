import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import config from '@/next.config';

describe('Fixerrors serverless diagnostic assets', () => {
  it('includes safe source types and checked-in knowledge only for the capture route', () => {
    expect(config.outputFileTracingIncludes).toEqual({
      '/api/debug/fixerrors': [
        './{app,components,lib,hooks,utils,services}/**/*.{ts,tsx,js,jsx}',
        './lib/config/fixerrors-knowledge.json',
      ],
    });
    expect(existsSync(resolve('lib', 'config', 'fixerrors-knowledge.json'))).toBe(true);
    const included = JSON.stringify(config.outputFileTracingIncludes);
    for (const excluded of ['.env', 'docs_private', 'node_modules', 'supabase', '.git']) {
      expect(included).not.toContain(excluded);
    }
  });
});
