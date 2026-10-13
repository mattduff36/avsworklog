import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');

export default {
  experimental: { externalDir: true },
  webpack(config) {
    config.resolve.alias['@'] = root;
    return config;
  },
};
