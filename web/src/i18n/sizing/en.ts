// Garment options, fits and the size guide (English). hi.ts, te.ts and ta.ts must define every key.
const sizingEn = {
  // fits
  fitLabel: 'Fit',
  fit_men: 'Men / unisex',
  fit_women: 'Women',
  fit_kids: 'Kids',
  fitSize: '{fit}, {size}',

  // sleeves and collar
  garmentOptions: 'Sleeves and collar',
  sleevesLabel: 'Sleeves',
  sleeves_short: 'Short sleeves',
  sleeves_long: 'Long sleeves',
  sleeves_none: 'Sleeveless',
  collarLabel: 'Collar',
  collar_crew: 'Crew neck',
  collar_polo: 'Polo',
  collar_mandarin: 'Mandarin',
  optionsPerPiece: 'Price differences are per piece.',
  colourwayLabel: 'Colourway',
  colourwaysN: 'Comes in {n} colourways',
  madeWith: 'Made with',

  // size guide
  sizeGuide: 'Size guide',
  sgIntro: 'Garment measurements in {unit}, laid flat. Pick the size whose “Fits chest” includes your own chest measurement.',
  sgCaption: '{fit} sizes, measurements in {unit}',
  sgCol_chest: 'Chest',
  sgCol_length: 'Length',
  sgCol_shoulder: 'Shoulder',
  sgCol_sleeve: 'Sleeve',
  sgCol_sleeveShort: 'Sleeve (short)',
  sgCol_sleeveLong: 'Sleeve (long)',
  sgCol_waist: 'Waist',
  sgCol_hip: 'Hip',
  sgCol_body_chest: 'Fits chest',
  sgCol_height: 'Height',
  sgHowTo: 'How to measure',
  sgTolerance: 'Finished garments can differ by up to {n} {unit}.',
  sgUnavailable: 'The size guide can’t be loaded right now.',
  sgGarment: 'Garment',
  sgTops: 'Jerseys and V-necks',
  sgShorts: 'Shorts',
  sgPageTitle: 'Size guide',
  sgPageText: 'Measurements for our Men / unisex, Women and Kids sizes. Every order is cut and sewn to these measurements, so you get the same fit every time.',
  sgSleeveless: 'Sleeveless tops have no sleeve measurement.',

  // payment while online payment is not available
  payComingSoonTitle: 'Online payment is coming soon',
  payComingSoon: 'Online payment is coming soon. Please choose cash on delivery.',
  payLater: 'Pay later',
  payLaterHint: 'Online payment is coming soon. Place your order and our team will contact you to arrange payment.',
  payTeamWillContact: 'Our team will contact you to arrange payment.',
  viewOrder: 'View order',
};

export type SizingStrings = typeof sizingEn;
export default sizingEn;
