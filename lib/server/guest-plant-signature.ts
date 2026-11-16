import 'server-only';
import sharp from 'sharp';

/** Validate image evidence, not the identity or meaning of the handwriting. */
export async function validGuestSignature(value: string): Promise<boolean> {
  if (value.length > 300000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const bytes = Buffer.from(value.slice('data:image/png;base64,'.length), 'base64');
    if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return false;
    const image = sharp(bytes, { limitInputPixels: 2000000, failOn: 'warning' });
    const meta = await image.metadata();
    if (meta.format !== 'png' || !meta.width || !meta.height || meta.width < 20 || meta.height < 20 || meta.width > 2000 || meta.height > 1000 || (meta.pages ?? 1) > 1) return false;
    const { data, info } = await image.flatten({ background: '#ffffff' }).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
    let ink = 0; let light = 0;
    for (const pixel of data) { if (pixel < 180) ink++; if (pixel > 230) light++; }
    return ink >= 20 && light >= info.width * info.height * 0.05;
  } catch { return false; }
}
