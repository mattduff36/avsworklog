import sharp from 'sharp';

interface SignatureBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface NormalizeSignatureOptions {
  width: number;
  height: number;
}

const DATA_URL_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

function isInkPixel(red: number, green: number, blue: number, alpha: number): boolean {
  if (alpha <= 8) return false;
  return red < 245 || green < 245 || blue < 245;
}

function findSignatureBounds(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
): SignatureBounds | null {
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

      if (!isInkPixel(red, green, blue, alpha)) continue;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export async function normalizeSignatureDataUrl(
  dataUrl: string,
  options: NormalizeSignatureOptions,
): Promise<string> {
  const match = dataUrl.match(DATA_URL_PATTERN);
  if (!match) return dataUrl;

  const [, , base64Payload] = match;
  const inputBuffer = Buffer.from(base64Payload, 'base64');

  try {
    const sourceImage = sharp(inputBuffer).ensureAlpha();
    const { data, info } = await sourceImage
      .raw()
      .toBuffer({ resolveWithObject: true });

    const bounds = findSignatureBounds(data, info.width, info.height, info.channels);
    if (!bounds) return dataUrl;

    const normalizedBuffer = await sharp(inputBuffer)
      .ensureAlpha()
      .extract(bounds)
      .resize(options.width, options.height, {
        fit: 'fill',
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();

    return `data:image/png;base64,${normalizedBuffer.toString('base64')}`;
  } catch {
    return dataUrl;
  }
}
