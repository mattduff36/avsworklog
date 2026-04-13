import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { normalizeSignatureDataUrl } from '@/lib/pdf/signature-image';

function findInkBounds(pixels: Buffer, width: number, height: number, channels: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];

      if (alpha <= 8) continue;
      if (red >= 245 && green >= 245 && blue >= 245) continue;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  return { minX, minY, maxX, maxY };
}

describe('normalizeSignatureDataUrl', () => {
  it('expands a small top-left signature to fill the target canvas', async () => {
    const source = await sharp({
      create: {
        width: 120,
        height: 40,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      },
    })
      .composite([
        {
          input: {
            create: {
              width: 22,
              height: 8,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 1 },
            },
          },
          left: 4,
          top: 3,
        },
      ])
      .png()
      .toBuffer();

    const inputDataUrl = `data:image/png;base64,${source.toString('base64')}`;
    const outputDataUrl = await normalizeSignatureDataUrl(inputDataUrl, { width: 40, height: 20 });
    const outputBuffer = Buffer.from(outputDataUrl.split(',')[1], 'base64');
    const { data, info } = await sharp(outputBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const bounds = findInkBounds(data, info.width, info.height, info.channels);

    expect(info.width).toBe(40);
    expect(info.height).toBe(20);
    expect(bounds.minX).toBeLessThanOrEqual(1);
    expect(bounds.minY).toBeLessThanOrEqual(1);
    expect(bounds.maxX).toBeGreaterThanOrEqual(38);
    expect(bounds.maxY).toBeGreaterThanOrEqual(18);
  });
});
