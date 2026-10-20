import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export default {
  experimental: { externalDir: true },
  serverExternalPackages: ['@electric-sql/pglite'],
  webpack(config) { config.resolve.alias['@'] = root; return config; },
};
