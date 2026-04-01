import { readFile } from 'fs/promises';
import { resolve } from 'path';

export async function loadSquiresLogoDataUrl(): Promise<string | null> {
  try {
    const logoPath = resolve(process.cwd(), 'public', 'images', 'logo.png');
    const logoBuffer = await readFile(logoPath);
    return `data:image/png;base64,${logoBuffer.toString('base64')}`;
  } catch {
    return null;
  }
}
