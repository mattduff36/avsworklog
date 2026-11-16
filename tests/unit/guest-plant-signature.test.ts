import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { validGuestSignature } from '@/lib/server/guest-plant-signature';
vi.mock('server-only', () => ({}));
const image = async (body: string, width = 300, height = 100) => `data:image/png;base64,${(await sharp(Buffer.from(`<svg width="${width}" height="${height}">${body}</svg>`)).png().toBuffer()).toString('base64')}`;
describe('Guest signature image evidence', () => {
  it('accepts an actual drawn PNG', async () => {
    expect(await validGuestSignature(await image('<rect width="300" height="100" fill="white"/><path d="M10 80 L50 20 L70 70 L140 40 L230 60" stroke="black" stroke-width="4" fill="none"/>'))).toBe(true);
  });
  it('rejects invalid PNG, blank white/transparent/solid images and excessive dimensions', async () => {
    for (const value of [`data:image/png;base64,${'A'.repeat(100)}`, await image(''), await image('<rect width="300" height="100" fill="white"/>'), await image('<rect width="300" height="100" fill="black"/>'), await image('',2001,100)]) expect(await validGuestSignature(value)).toBe(false);
  });
});
