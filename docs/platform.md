# How the Unsattai platform works

This page covers the business logic the three apps share: sellers and delivery by PIN code, prices, order states, production and delivery planning, customer accounts, products and reviews, the CRM, and staff roles. All of it lives in `server/app/platform/`. The full list of endpoints is in `docs/openapi.json`; the marketplace endpoints are explained with examples in `docs/marketplace-api.md`.

## Settings the business controls

Everything below is changed in the operations app under **Settings**. Nothing needs a code change or a restart. Each save is versioned: a save made from an older version is refused, so two people cannot overwrite each other. Every change is kept in the history and the audit log. A save that does not validate is refused with a 422 that names the field and the problem, for example `coupons.0: a public coupon needs a title`.

| Setting | What it holds |
| --- | --- |
| Price book | Currency, garment base prices, fabrics and their surcharges, size surcharges (for example XXL), name and number prices, logo price per piece, quantity discount tiers, minimum order, express fee, tax rules, coupons and **cash on delivery** (`cod`: enabled, fee, highest order value). Each coupon can be **public** (listed under "Available offers" at checkout) with a customer-facing **title**. |
| Production | Stages in order (for example prepress, print, press, cut, stitch, QC, pack), capacity per stage per day in pieces, stages that need a fixed wait (drying, curing), working days, holidays, the daily order cutoff time and the time zone. These are the base for every seller. |
| Delivery | Zones matched by PIN code prefix or state, with a catch-all zone. Each zone has a base rate, a per-piece rate and a free-delivery threshold; these set the **delivery charge**. Also carriers, dispatch days and pickup. Transit days now come from the seller's service areas (see below). |
| Company | Name, legal name, address, tax ID, contact details and the invoice number prefix. |
| CRM | Lead stages (must include won and lost), lead sources, ticket categories, how many days after an order to suggest a reorder, the **return window** in days (0 turns returns off) and the **returnable reasons** (by default damaged, wrong item, print quality). |

Settings saved by an older server version are filled in with the new defaults when read, so an upgrade needs no data migration.

The shipped defaults are examples in Indian rupees. **Set your own prices, capacities, zones and sellers before taking real orders.** Settings → Pricing has a simulator that prices a sample order against a draft price book before you save it.

## Sellers and delivery by PIN code

A seller is a production partner: a print unit that makes and ships orders. The business's own unit is the **house seller**, `sel_house`. It is created on first start from the delivery zones (each zone's PIN code prefixes and states become service areas with that zone's transit days, and the catch-all zone becomes `*`), so an order with no seller behaves exactly as before. Orders and shipments from before sellers existed are marked as the house seller's.

Sellers are records, not settings, and are managed in the operations app (Sellers). Each has:

- **Service areas**, each `{match, transit_days, cod}`. `match` is a PIN code prefix (`"600"`), a state code (`"TN"`) or `"*"` for everywhere. The **most specific match wins**: the longest matching prefix, then the state, then `*`.
- **Blocked PIN codes** it never delivers to.
- The **garments** and **fabrics** it makes (no fabrics listed means all), and the **minimum and maximum pieces** per order.
- A **capacity factor** that multiplies every production stage's capacity, its own **holidays** (on top of the global ones) and **handling days** between packing and dispatch.
- A **price adjustment** per piece (0.05 = 5% above the price book), shown as its own "seller" part of the unit price.
- A **rating**, worked out from the visible reviews of its delivered orders.

The PIN code's state comes from a small table of leading digits (`platform/pincodes.py`). It is approximate: postal circles do not follow state borders exactly, so it is fine for display and state-level areas but it is not an address validator. A PIN code must have six digits and start with 1 to 8.

**Choosing a seller.** The customer never has to. For a PIN code, garment, fabric and quantity, every active seller that can serve it makes an offer with its unit price, ship date and delivery date (from its own plan). Offers are ranked by earliest delivery, then lowest price, then best rating; the first is **recommended**, and the fastest and cheapest are flagged. When nobody can serve, the reason is one of `invalid_pincode`, `not_serviceable`, `garment_unavailable` or `pieces_out_of_range`. A quote, order or checkout item may name a `seller_id`; if that seller cannot serve the PIN code, the quote lists a problem and an order is refused with 422. Pickup orders are made by the chosen seller, or by the house seller by default.

## Prices

Every quote is itemised, and the customer, the sales team and the invoice see the same numbers.

```
price per piece = garment base + fabric + logos + size surcharge + name + number (+ seller adjustment)
subtotal        = sum of all lines
 − quantity discount    (tier chosen by total pieces)
 + express fee          (percentage, when express production is chosen)
 − coupon
 + delivery             (zone rate, free above the zone's threshold, or the pickup fee)
 + cash on delivery fee (when paying on delivery)
 + tax                  (rate chosen by the average price per piece, e.g. GST 5% or 12%)
 = total
```

A quote also says how many more pieces reach the next discount tier, which seller it is for, and whether cash on delivery is available.

**Carts.** A cart holds up to 20 items; each item is a ready-made product or the customer's own design, with its garment, fabric, logos and roster lines. The cart quote prices every item (each with its own seller and dates) and the whole cart. A coupon applies to the whole cart: it is worked out on the cart's value after quantity discounts, then split across the items in proportion to their value (the last item takes the rounding), and each item's order carries its share.

## Checkout and orders

A checkout creates **one order per cart item**, all or nothing: every item is checked first (seller and PIN code, cash on delivery, the print checks), and if any fails nothing is created and each failing item is reported. The orders share a checkout number such as `CK-00001`, and paying the checkout confirms all of its online orders at once. The single-order `POST /orders` still works for older app versions.

An order has a production status (`fulfilment.status`) alongside the original payment status:

```
awaiting_payment → queued → in_production → ready → dispatched → delivered
                     (any state before dispatch) → cancelled
```

- **Placed.** The order gets a number (for example `US-00001`), a customer record, a seller, its prices and an estimated delivery date.
- **Paid.** The order is queued, gets its production stages and a promised ship and delivery date from its seller's plan.
- **Cash on delivery** orders skip payment and go straight to production. The amount is marked collected when the shipment is delivered, or by hand in the operations app; until then the invoice is a proforma. Cash on delivery needs the price book's `cod.enabled`, the seller area's `cod` flag, and a total within `cod.max_order_value`.
- **Production** ticks off stages in order. The first stage moves the order to `in_production`, the last one to `ready`. A stage can be undone.
- **Dispatch** creates a shipment with a carrier and a tracking number. It can only be dispatched once it is `ready`. Marking the shipment delivered completes the order and opens the return window.
- **Holds** pause an order with an internal reason. The customer only sees that it is on hold.
- **Cancel.** Customers can cancel while unpaid, or once paid as long as no production stage is done. Staff can cancel any order before dispatch. If money was taken, a refund is recorded: "demo" for demo payments (no money moved), otherwise "manual" for staff to pay back by hand.
- **Returns.** Custom printed goods can be returned only for the returnable reasons, within the return window after delivery, one open return at a time. Operations moves a return `requested → approved → picked_up → resolved` (with a replacement or a refund), or `rejected` at any step before it is resolved.
- **Reviews.** One review per delivered order (1 to 5 stars, title, text), shown on the product as a verified purchase and counted in the seller's rating. Operations can hide a review; hidden reviews stop counting.

Customers see a timeline of public events only. Internal notes, hold reasons and staff names are never sent to them. The customer's order view also says whether it can be cancelled or returned now, the return deadline, its review, returns, refunds, seller, checkout and payment method. Invoices show "Sold by" with the seller's name.

## Planning

The planner (`planning.py`) plans each seller on its own: the global stages with their capacities multiplied by the seller's capacity factor, the global holidays plus the seller's, over that seller's paid, unfinished orders only. Day by day:

1. Express orders go first, then orders with the earliest promised ship date, then the earliest paid.
2. Each order moves through its remaining stages in order. A stage with a fixed wait holds the order back that many working days.
3. When a stage is full for the day, the rest of the order moves to the next working day. Holidays and non-working days are skipped.
4. A ready order waits the seller's handling days, then ships on the next dispatch day. The seller's transit days for the PIN code give the delivery date.

The same planner answers "when would a new order arrive?" for quotes and offers: it adds the new order to that seller's current workload and schedules it. Orders that will miss their promised date are flagged as late in the production plan. The utilisation view shows planned load against capacity for each stage over the next two weeks, for one seller or for all of them added together. The plan, utilisation, board, worklist, delivery plan and shipments can all be filtered by seller.

## Customer accounts

Customers sign in with a **mobile number or an email address** and a one-time code. The answer to a code request is the same whether or not an account exists. After signing in they can set a **password** (at least 10 characters with upper and lower case letters and a digit) and then also sign in with their mobile number or email and that password. Five wrong passwords lock that mobile number or email for 15 minutes (staff sign-in has the same lock). A forgotten password is reset by signing in with a code and setting a new one within 15 minutes; otherwise changing it needs the current one. Changing the password signs out the account's other sessions. Password hashes are kept apart from the customer record, so no customer view or export carries one.

A customer has a phone, an email, and whether each is verified. Adding or changing either needs a code sent to it; one that belongs to another signed-in account is refused. A phone or email typed into the profile or by staff is only contact detail until it is verified. Each sign-in is a **session** with an id, when it started, when it was last seen and a device label (for example "Chrome on Android"); customers can list their sessions, sign one out, or sign out all the others. Databases from before sessions had these details are upgraded on start.

Orders placed as a guest are linked to the account on sign-in when their phone matches the account's verified phone, or their email matches the account's verified email. Guests can still order, and track an order with its order reference and their phone number. The server keeps a cart for signed-in customers; guests keep theirs on the device and it is merged on sign-in. Customers also have a wishlist of products, notifications, saved designs, team collections and support tickets.

**Team collections.** A captain creates a collection and shares its link. Each player adds their own name, number and size through the link, without an account. The captain then orders the whole roster at once.

## Products and reviews

Products are ready-made designs customers buy as they are or open in the designer to customise. The operations app creates them from a design spec, a brief (designed by the design engine), a past order or a sales quote (the player name and number are removed), then publishes, unpublishes and features them. On first start twelve products are seeded from the built-in rule-based design engine, spread over sports and garments; they are the same on every install. The store lists published products with search, filters by sport, garment, colour family and price, facet counts, and sorting by popularity (paid orders), newest, price or rating. A product's "price from" is the lowest one-piece price any active seller offers for it.

## Notifications

Every customer-facing event (order placed, confirmed, dispatched with the tracking number, delivered, cancelled, and each return update) is written to the customer's in-app notifications (with read flags) and to the **outbox** for SMS and email. The operations app shows the outbox. Until providers are connected, messages are only logged and have the status `logged`.

## CRM

- **Customers and organisations.** Organisations are clubs, schools and companies. Order totals, order counts and last order date are kept up to date.
- **Leads** move through configurable stages in a pipeline. Every stage change is recorded. Enquiries from the website become a customer, a lead and a follow-up task automatically.
- **Activities and tasks.** Calls, notes and meetings, with due dates and a list of what is due.
- **Quotes** have their own numbers (for example `Q-00001`), a validity date and an optional extra discount. Sending a quote gives a link the customer opens without signing in. Accepting it places the order at the quoted price, with the seller the quote was priced for.
- **Tickets** with categories and internal notes the customer does not see. A customer reply reopens a closed ticket.
- **Reorders** lists customers whose last order is older than the configured number of days.

## Staff roles

| Role | Can do |
| --- | --- |
| admin | Everything, including managing staff accounts. |
| manager | Orders, pricing and products, production, delivery, CRM, settings and sellers. |
| sales | Orders, returns, CRM (including review moderation) and quotes. |
| production | Production board and stages. |
| dispatch | Shipments, delivery and cash on delivery collection. |
| viewer | Read only. |
| seller | A production partner's own login, linked to one seller. It sees and acts only on that seller's orders, production plan, board, worklist, utilisation, shipments, returns and cash on delivery, and can read its own seller record. It cannot see customers, the CRM, the dashboard, settings, products, other sellers, staff or the outbox, and cannot change settings, prices or any seller. Asking for another seller's order gets the same 404 as a missing one. |

The first admin is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD` when the server starts and no admin exists yet. Staff passwords need at least 10 characters with upper and lower case letters and a digit. Staff sessions last one day; customer sessions last 60 days.

## What still needs a real provider

- **SMS and email.** Sending is built in: `SMS_PROVIDER` (`msg91`, `twilio`, `webhook`) and `EMAIL_PROVIDER` (`smtp`, `resend`, `webhook`) pick the service, and with neither set, codes and messages are written to the server log (`log`). All of it is in `server/app/platform/notify.py`, and every setting is in [configuration.md](configuration.md). With `OTP_DEV_ECHO=1` (the default locally) the code is also returned in the API response so testing works; `APP_ENV=production` always turns that off. The operations app's Messages page shows the connected services and sends a test.
- **Payments.** Customers can only pay with the demo payment, which takes no money, or choose cash on delivery. Staff can record payments received outside the app (cash, UPI, bank transfer, card, cheque) in the operations app. Refunds are recorded, not sent. A real payment gateway needs to be connected before selling online.
- **Carriers.** Tracking numbers are typed in by staff. No carrier API is connected.
- **Database.** SQLite suits one server. Move to a managed database before running several server instances.
