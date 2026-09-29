# Sizes, garment options and print files

## Garment options

Every design has:

| Option | Choices | Applies to |
|---|---|---|
| Sleeves | Short, Long, Sleeveless | Jerseys and V-necks |
| Collar | Crew neck, Polo (with a button placket), Mandarin | Crew-neck jerseys |

Each order line also has a **fit**: Men / unisex, Women or Kids.

Customers choose these in the studio, product page and cart. Briefs and the Ask tab understand them too ("sleeveless basketball vest", "add long sleeves", "polo collar"). The picture rebuild uses what it sees when the AI is switched on.

Prices are per piece, in **Operations → Settings → Price book → Garment options**. A negative price is a discount, for example sleeveless −20 or kids −60. A choice can be switched off, except short sleeves and the crew neck, which are the defaults.

Ready-made products can offer up to 8 **colourways**: the same design in another palette. Edit them on the product in the operations app.

### Why the Front tab has no sleeves

The 2D view shows flat pattern pieces as they are printed. A short- or long-sleeve jersey has four pieces: front, back and two sleeves, sewn together after printing. The front piece on its own therefore has no sleeves, and the panel says so. A sleeveless jersey has only front and back pieces, with a binding round the armholes.

## Size charts

**Operations → Settings → Size charts** holds the charts. The customer size guide (`GET /api/v1/shop/size-guide`) reads from them.

| Fit | Sizes |
|---|---|
| Men / unisex | XS, S, M, L, XL, XXL, 3XL |
| Women | XS, S, M, L, XL, XXL |
| Kids | 4Y, 6Y, 8Y, 10Y, 12Y, 14Y (with the child's height) |

All measurements are finished-garment centimetres, laid flat:

- Chest, waist and hip are measured straight across, so they are half the circumference.
- Length runs from the highest shoulder point to the hem.
- "Fits chest" is the wearer's chest all round.

The size list of each fit is fixed. Every measurement can be changed, and the change applies to new orders. **An order keeps the chart values it was placed with.**

## What production gets for each order

For every line (name, number, fit, size):

- **Measurements** in cm (chest, length, shoulder and sleeve, or waist, hip and length for shorts).
- **Piece sizes** in mm. For example:

  | Size | Front and back |
  |---|---|
  | Men M | 540 x 720 |
  | Kids 8Y | 380 x 520 |
  | Women S | 465 x 640 |

- **One SVG per piece**, named line, size and piece: `L01_M_front.svg` for men, `L02_WS_front.svg` for Women S and `L03_K8Y_front.svg` for Kids 8Y.

Each print file:

- is vector artwork at 1:1 in millimetres (the file's width and height are in mm), so it prints at the right size at any resolution, including 300 dpi;
- is graded to the line's size chart. Names, numbers and logos keep their proportions and are never stretched;
- has 10 mm of bleed past a magenta CutContour cut line, and a 100 mm calibration ruler;
- has a header with the order, line, fit, size, options and finished measurements.

Logos uploaded as pictures are checked for at least **300 dpi** at the printed size of the largest piece in the order. An order with a failing check can't be placed.

Every order also has a **measurement sheet** (`measurements.svg`, A4 width). It lists each line's fit, size, quantity, measurements and piece sizes, and the palette colours, for the cutting and sewing tables. Download it from the order in the operations app, next to the print files. Partners (sellers) can download it too.

API: `GET /api/v1/ops/orders/{id}/print-files/{name}`. Use `measurements.svg` as the name for the sheet.
