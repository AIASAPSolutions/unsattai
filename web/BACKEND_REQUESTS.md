# Backend requests from the web store

> **Status (server updated after this list was written):**
> - Done: 1 (the public order view has `fulfilment.shipment` with carrier, tracking number, tracking link and dates), 2 (`GET /me/tickets/{id}`), 3 (`/orders/{number}/track?phone=` accepts the order number), 4 (timeline events carry `params`), 5 (orders, payment, invoice and print files are limited to the customer, the device that placed the order, staff, or someone with the order's phone number), 6 (`edit_key` is no longer sent to the organiser), 9 (`/shop/quote` returns `estimate_express` when express is off).
> - Open: 7 (size chart). 8 is a settings change in the operations app.
> - The web store still uses its earlier workarounds for 1 to 4 and 9. They keep working, and can be switched to the new fields later.
> - New with the marketplace upgrade: 11 (quote items carry `slug` and `image_url`) and 12 (the API guide now documents what `combined` means) are done; 10 is open.

The web store (`web/`) uses the API as it is today. Each item below says what we need,
why, the shape we propose, and what the web app does in the meantime. Nothing under
`server/` was changed.

## 1. Shipment details for customers

- **Endpoint:** `GET /api/v1/me/orders/{id}/shipments`, and the same data inside the public views (`GET /orders/{id}`, `GET /orders/{id}/track`).
- **Why:** customers ask "where is my parcel?". The public order view only carries `shipments: ["shp_…"]` and a timeline line "Dispatched with {carrier}". The tracking number, carrier link and planned date are staff-only.
- **Proposed shape:**
  ```json
  { "shipments": [ { "id": "shp_1", "carrier": "DTDC", "tracking_no": "D1234", "tracking_url": "https://…",
                     "status": "dispatched", "planned_date": "2026-10-02", "dispatched_at": "…", "delivered_at": null } ] }
  ```
- **Workaround:** the order page shows the dispatch date, the "Dispatched with …" timeline text and the shipment reference ids.

## 2. Read one support ticket

- **Endpoint:** `GET /api/v1/me/tickets/{id}`
- **Why:** the conversation page opens one ticket, but there is only the list endpoint, which is capped at 100 tickets.
- **Proposed shape:** the same object `POST /me/tickets/{id}/reply` returns (public ticket, internal notes left out).
- **Workaround:** the web app loads `GET /me/tickets` and picks the ticket out of the list.

## 3. Track by order number

- **Endpoint:** accept the order number as well as the id in `GET /api/v1/orders/{id_or_number}/track?phone=`.
- **Why:** confirmations and invoices show the number (`UJ-00001`) most prominently, but tracking only works with the internal id (`ord_…`).
- **Workaround:** the confirmation page, order pages and invoice link show "Order ID (for tracking): ord_…" next to the number, and the track form asks for the order ID.

## 4. Timeline events with parameters

- **Endpoint:** add `params` to each public timeline event, e.g. `{ "at": "…", "code": "stage", "text": "Cutting done", "params": { "stage": "Cutting" } }`.
- **Why:** timeline texts are English. Codes without parameters (placed, paid, ready…) are translated in the web app; "stage", "dispatched" and "note" can't be, because the stage or carrier name is only inside the English sentence.
- **Workaround:** those three codes are shown in the server's English text.

## 5. Public order view is readable with only the order id

- **Endpoint:** `GET /api/v1/orders/{id}` (and `POST /orders/{id}/payment-confirmed`).
- **Why:** anyone who has an order id can read the full public view, including the customer's name, phone, email and address. The id is random (`ord_` + 12 hex), so this is only as strong as keeping the id private. For a public web store we'd prefer the order to be tied to the device or session that created it (the API already records `X-Device-Id` on create) or to require `?phone=` like `/track`.
- **Proposed:** allow `GET /orders/{id}` when the caller is the order's customer (bearer), the device that created it (`X-Device-Id`), or staff; otherwise 404. Same for payment confirmation.
- **Workaround:** none needed for the flow; the web store only links to orders from the confirmation, the account and tracking. The proxy forwards the device id so this can be switched on without web changes.

## 6. Team list entries: organiser sees players' edit keys

- **Endpoint:** `GET /api/v1/me/collections/{id}` returns each entry's `edit_key`.
- **Why:** the key lets anyone edit that player's entry through the public page; the organiser doesn't need it.
- **Proposed:** drop `edit_key` from the organiser view.
- **Workaround:** the dashboard never shows or uses it.

## 7. Size chart in the catalogue

- **Endpoint:** add `size_chart` to `GET /api/v1/shop/catalogue`, per garment: `{ "jersey": [{ "size": "M", "chest_cm": 52, "length_cm": 72 }], "shorts": [...] }`.
- **Why:** the checkout shows a size chart, and the measurements should come from production, not from the web code.
- **Workaround:** the web app ships an approximate chart (`src/lib/states.ts`, `SIZE_CHART`) and labels it as approximate.

## 8. Company contact details

- **Endpoint:** `GET /api/v1/shop/catalogue` → `company.email` and `company.phone` are empty in the default configuration.
- **Why:** the footer, bulk enquiry page and landing page show them when present.
- **Workaround:** those lines are hidden when empty. Please fill them in the company settings (ops app), no code change needed.

## 9. Express date without a second request

- **Endpoint:** always return `estimate_rush` (or `estimate_standard` and `estimate_rush`) from `POST /shop/quote`, not only `estimate_standard` when rush is on.
- **Why:** checkout shows "Standard: date · Express: date" before the customer turns express on.
- **Workaround:** when express is off the web app also calls `GET /shop/delivery-estimate?rush=true` alongside each quote.

## 10. Team lists through `POST /checkout`

- **Endpoint:** accept `collection_id` on a cart item (or on the checkout body) in `POST /checkout` and `POST /shop/cart/quote`, and close the team list when the checkout is placed, as `POST /orders` does today.
- **Why:** everything else is ordered through the cart and `POST /checkout` (one checkout number, orders grouped by seller, cash on delivery). A team list is the one thing that still has to use the older `POST /orders`.
- **Workaround:** a team list can only be ordered with **Buy now** (not added to the cart). The checkout page then places it with `POST /orders` (`collection_id`, `payment_method`, `idempotency_key`) and continues to `/order/{id}/pay` or `/order/{id}`.

## 11. Product details for cart items

- **Endpoint:** add `slug` and `image_url` to each `POST /shop/cart/quote` item (and to `GET /me/cart` items with a `product_id`), or allow `GET /shop/products?ids=prd_1,prd_2`.
- **Why:** the cart and checkout show each ready-made item's picture and link to its page. The cart item and the quote only carry `product_id` and `title`.
- **Workaround:** the web app loads the first 60 products once (`GET /shop/products?size=60`) and looks items up there. A cart item for a product outside that list shows its title from the quote, a placeholder picture and no link.

## 12. `shipping.combined` on every item of a seller

- **Endpoint:** `POST /shop/cart/quote`.
- **Why:** the API guide says the seller's first item carries the charge and "the seller's other items show `shipping.amount: 0` with `shipping.combined: true`". In practice every item of a seller with more than one item has `combined: true`, including the first one that carries the charge.
- **Proposed:** set `combined: true` only on the items whose charge moved to another item (or document the current meaning: "shares one charge with other items").
- **Workaround:** the web app does not use the flag; it groups by `seller.id` and sums `shipping.amount` per seller.
