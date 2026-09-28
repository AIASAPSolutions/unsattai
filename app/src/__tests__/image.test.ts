import { Buffer } from 'buffer';
import { inspectImage, jpegSize, sniffMime } from '../lib/image';
import { effectiveDpi, dpiLevel, maxWidthForDpi, worstSize } from '../lib/dpi';

function png(w: number, h: number): string {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b.toString('base64');
}

describe('logo inspection', () => {
  it('reads PNG dimensions from the bytes', () => {
    const r = inspectImage(png(1200, 600));
    expect(r).toMatchObject({ mime: 'image/png', width: 1200, height: 600, aspect: 0.5 });
  });

  it('reads JPEG dimensions from the SOF marker', () => {
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x90, 0x02, 0x58, 0x03]);
    expect(sniffMime(jpg)).toBe('image/jpeg');
    expect(jpegSize(jpg)).toEqual([600, 400]);
  });

  it('accepts SVG and takes its aspect from the viewBox', () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"></svg>').toString('base64');
    expect(inspectImage(svg)).toMatchObject({ mime: 'image/svg+xml', aspect: 0.5, width: null });
  });

  it('rejects other formats and files over 1.5 MB', () => {
    expect(inspectImage(Buffer.from('GIF89a....').toString('base64'))).toBe('type');
    const big = Buffer.concat([Buffer.from(png(10, 10), 'base64'), Buffer.alloc(1_600_000)]).toString('base64');
    expect(inspectImage(big)).toBe('size');
  });
});

describe('print resolution', () => {
  it('computes DPI at the ordered size and flags low resolution', () => {
    const logo = { width: 80, pixel_width: 945, kind: 'raster' } as const;
    expect(Math.round(effectiveDpi(logo, 'M')!)).toBe(300);
    expect(dpiLevel(logo as never, 'XXL')).toBe('low');
    expect(dpiLevel({ ...logo, pixel_width: 100 } as never, 'M')).toBe('unprintable');
    expect(dpiLevel({ ...logo, kind: 'vector' } as never, 'XXL')).toBe('vector');
    expect(worstSize(['S', 'XL', 'M'])).toBe('XL');
    expect(maxWidthForDpi(945, 'M')).toBeCloseTo(80, 0);
  });
});
