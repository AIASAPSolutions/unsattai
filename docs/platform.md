# How the UrJersey platform works

This page covers the business logic the three apps share: prices, order states, production and delivery planning, customer accounts, the CRM, and staff roles. All of it lives in `server/app/platform/`. The full list of endpoints is in `docs/openapi.json`.

## Settings the business controls

Everything below is changed in the operations app under **Settings**. Nothing needs a code change or a restart. Each save is versioned: a save made from an older version is refused, so two people cannot overwrite each other. Every change is kept in the history and the audit log.

| Setting | What it holds |
| --- | --- |
| Price book | Currency, garment base prices, fabrics and their surcharges, size surcharges (for example XXL), name and number prices, logo price per piece, quantity discount tiers, minimum order, express fee, tax rules and coupons. |
| Production | Stages in order (for example prepress, print, press, cut, stitch, QC, pack), capacity per stage per day in pieces, stages that need a fixed wait (drying, curing), working days, holidays, the daily order cutoff time and the time zone. |
| Delivery | Zones matched by PIN code prefix or state, with a catch-all zone. Each zone has a base rate, a per-piece rate, a free-delivery threshold and transit days. Also carriers, dispatch days and pickup. |
| Company | Name, legal name, address, tax ID, contact details and the invoice number prefix. |
| CRM | Lead stages (must include won and lost), lead sources, ticket categories and how many days after an order to suggest a reorder. |

The shipped defaults are examples in Indian rupees. **Set your own prices, capacities and zones before taking real orders.** Settings → Pricing has a simulator that prices a sample order against a draft price book before you save it.

## Prices

Every quote is itemised, and the customer, the sales team and the invoice see the same numbers.

```
price per piece = garment base + fabric + logos + size surcharge + name + number
subtotal        = sum of all lines
 − quantity discount   (tier chosen by total pieces)
 + express fee         (percentage, when express production is chosen)
 − coupon
 + delivery            (zone rate, free above the zone's threshold, or the pickup fee)
 + tax                 (rate chosen by the average price per piece, e.g. GST 5% or 12%)
 = total
```

A quote also says how many more pieces reach the next discount tier.

## Order states

An order has a production status (`fulfilment.status`) alongside the original payment status:

```
awaiting_payment → queued → in_production → ready → dispatched → delivered
                     (any state before dispatch) → cancelled
```

- **Placed.** The order gets a number (for example `UJ-00001`), a customer record, its prices and an estimated delivery date.
- **Paid.** The order is queued, gets its production stages and a promised ship and delivery date.
- **Production** ticks off stages in order. The first stage moves the order to `in_production`, the last one to `ready`. A stage can be undone.
- **Dispatch** creates a shipment with a carrier and a tracking number. It can only be dispatched once it is `ready`. Marking the shipment delivered completes the order.
- **Holds** pause an order with an internal reason. The customer only sees that it is on hold.

Customers see a timeline of public events only. Internal notes, hold reasons and staff names are never sent to them.

## Planning

The planner (`planning.py`) schedules every paid, unfinished order against the capacity of each stage, day by day:

1. Express orders go first, then orders with the earliest promised ship date, then the earliest paid.
2. Each order moves through its remaining stages in order. A stage with a fixed wait holds the order back that many working days.
3. When a stage is full for the day, the rest of the order moves to the next working day. Holidays and non-working days are skipped.
4. A ready order ships on the next dispatch day. Transit days for its zone give the delivery date.

The same planner answers "when would a new order arrive?" for quotes: it adds the new order to the current workload and schedules it. Orders that will miss their promised date are flagged as late in the production plan. The utilisation view shows planned load against capacity for each stage over the next two weeks.

## Customer accounts

Customers sign in with their phone number and a one-time code. A signed-in customer can see their orders, saved designs, team collections and support tickets. Orders placed as a guest with the same phone number are linked on the first sign-in. Guests can still order, and track an order with its order reference and their phone number.

**Team collections.** A captain creates a collection and shares its link. Each player adds their own name, number and size through the link, without an account. The captain then orders the whole roster at once.

## CRM

- **Customers and organisations.** Organisations are clubs, schools and companies. Order totals, order counts and last order date are kept up to date.
- **Leads** move through configurable stages in a pipeline. Every stage change is recorded. Enquiries from the website become a customer, a lead and a follow-up task automatically.
- **Activities and tasks.** Calls, notes and meetings, with due dates and a list of what is due.
- **Quotes** have their own numbers (for example `Q-00001`), a validity date and an optional extra discount. Sending a quote gives a link the customer opens without signing in. Accepting it places the order at the quoted price.
- **Tickets** with categories and internal notes the customer does not see. A customer reply reopens a closed ticket.
- **Reorders** lists customers whose last order is older than the configured number of days.

## Staff roles

| Role | Can do |
| --- | --- |
| admin | Everything, including managing staff accounts. |
| manager | Orders, pricing, production, delivery, CRM and settings. |
| sales | Orders, CRM and quotes. |
| production | Production board and stages. |
| dispatch | Shipments and delivery. |
| viewer | Read only. |

The first admin is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD` when the server starts and no admin exists yet. Staff passwords need at least 10 characters with upper and lower case letters and a digit. Staff sessions last one day; customer sessions last 60 days.

## What still needs a real provider

- **SMS for sign-in codes.** No SMS or WhatsApp provider is connected. The code is written to the server log, and with `OTP_DEV_ECHO=1` (the default) it is also returned in the API response so testing works. **Set `OTP_DEV_ECHO=0` in production** and connect a provider at the marked hook in `security.request_otp`.
- **Payments.** Customers can only pay with the demo payment, which takes no money. Staff can record payments received outside the app (cash, UPI, bank transfer, card, cheque) in the operations app. A real payment gateway needs to be connected before selling online.
- **Carriers.** Tracking numbers are typed in by staff. No carrier API is connected.
- **Database.** SQLite suits one server. Move to a managed database before running several server instances.
