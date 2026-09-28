import { parseDesignLink } from '../features/links/parseDesignLink';

describe('design app links', () => {
  it('prefills a valid link', () => {
    expect(parseDesignLink({ prompt: ' Navy cricket kit ', garment: 'VNECK', team: 'Chennai Strikers', lang: 'ta', autostart: '1' }))
      .toEqual({ prompt: 'Navy cricket kit', garment: 'vneck', team_name: 'Chennai Strikers', language: 'ta', autostart: true });
  });

  it('drops out-of-range values and ignores anything else in the link', () => {
    const r = parseDesignLink({ prompt: 'x'.repeat(700), garment: 'hoodie', team: 'A'.repeat(30), lang: 'fr', api_key: 'k' });
    expect(r).toEqual({ prompt: null, garment: null, team_name: null, language: null, autostart: false });
  });
});
