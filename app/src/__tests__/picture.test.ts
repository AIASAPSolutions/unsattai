import { buildOutsidePrompt, colorWord } from '../features/picture/outsidePrompt';
import { MAX_SIDE, targetSize } from '../features/picture/preparePicture';

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));

const NAMES = [{ name: 'navy', hex: '#14213d' }, { name: 'gold', hex: '#d4a017' }];

describe('outside prompt', () => {
  it('asks for a flat, text-free picture of the chosen garment in the chosen colours', () => {
    const p = buildOutsidePrompt({ garment: 'vneck', idea: '  tiger   stripes ', sport: 'kabaddi', colors: ['#14213D', '#2e8b57'], colorNames: NAMES });
    expect(p).toContain('kabaddi short-sleeve V-neck sports jersey');
    expect(p).toContain('navy (#14213d), #2e8b57');
    expect(p).toContain('Style idea: tiger stripes.');
    expect(p).toMatch(/plain white background/);
    expect(p).toMatch(/No text, no letters, no numbers, no logos/);
  });

  it('works with an empty brief', () => {
    const p = buildOutsidePrompt({ garment: 'shorts', idea: '', colors: [] });
    expect(p).toContain('pair of sports shorts');
    expect(p).toContain('two or three strong team colours');
  });

  it('names a colour only when it is close', () => {
    expect(colorWord('#15223e', NAMES)).toBe('navy (#15223e)');
    expect(colorWord('#ff00ff', NAMES)).toBe('#ff00ff');
  });
});

describe('picture size before upload', () => {
  it('keeps small pictures and scales big ones to the long side', () => {
    expect(targetSize(1024, 1024)).toBeNull();
    expect(targetSize(4000, 3000)).toEqual({ width: MAX_SIDE, height: 1200 });
    expect(targetSize(3000, 6000)).toEqual({ width: 800, height: MAX_SIDE });
  });
});
