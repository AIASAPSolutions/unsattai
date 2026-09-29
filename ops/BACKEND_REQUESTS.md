# Backend requests from the ops app

> **Status (server updated after this list was written):**
> - Done: 2 (late orders now carry `number`, `customer_name`, `status`), 4 (a password reset, role change or deactivation ends that person's sessions at once), 6 (a returned or cancelled shipment puts a dispatched order back to `ready`, with a timeline event), 9 (`/ops/quotes?lead_id=` and `?customer_id=`, and lead detail no longer scans all quotes), 10 (quotes accept `valid_until`, and editing keeps the existing expiry).
> - Decided: 1. Ops routes are protected by staff sign-in and roles, so they do not need the channel key.
> - Open: 3, 5, 7, 8, 11, 12. The app's workarounds stay in place.
> - Used: 6. The shipment status dialog now says the order goes back to Ready to ship.
> - Done and used: 14 (`GET /ops/carriers`; the shipment dialog lists carriers for staff and seller logins alike), 15 (`GET /ops/orders/{id}/print-files/{name}`; seller logins and production staff download print files from the order screen), 16 (`min_rating`/`max_rating` on `/ops/reviews`; the rating range is filtered on the server). Their workarounds are removed.
> - New with the marketplace upgrade: 13 to 21, below. Open: 13, 17 to 21.

The ops app works against the current API as it is. Each item below says what I would like
changed in `server/`, why, and what the ops app does in the meantime.

## 1. Ops router ignores `X-API-Key`
- **What:** `/api/v1/ops/*` has no API-key dependency. The shop and design routes do.
- **Why:** If the store and the API are deployed with `API_KEYS`, the ops endpoints are still
  guarded only by the staff bearer token. That is probably fine, but it is inconsistent, and it
  means an operator can't restrict ops traffic to known clients.
- **Proposed:** Decide on one policy and document it. If a key is wanted, add the same dependency
  to the ops router, driven by an optional `OPS_API_KEYS` setting.
- **Workaround:** The app sends `X-API-Key` on every request when `VITE_API_KEY` is set, so it
  keeps working if the key check is turned on.

## 2. Dashboard `late_orders` has too few fields
- **What:** Items are raw plan entries, without the order-index summary (number, customer,
  pieces).
- **Proposed:** Add `number`, `customer_name`, `status` and `stage` to each item in
  `GET /ops/dashboard`.
- **Workaround:** The dashboard also fetches `/ops/production/plan` and joins the two by order id.

## 3. Order index has no shipment info
- **What:** `GET /ops/orders` doesn't say whether a shipment exists, or which one.
- **Proposed:** Add `shipment: {id, status, carrier, tracking} | null` to each row, and a
  `has_shipment` filter.
- **Workaround:** The Delivery "Ready to ship" list also fetches open shipments
  (`status=planned,packed`) and matches them by order id.

## 4. Resetting a password doesn't revoke sessions
- **What:** When an admin resets a staff password, or the user changes it, existing tokens stay
  valid until they expire (1 day).
- **Proposed:** Store a `token_version` or `password_changed_at` on staff and reject tokens issued
  before it. Also add `POST /ops/staff/{id}/revoke-sessions`.
- **Workaround:** Deactivating works immediately, because `active` is checked on every request.
  The password-reset dialog on the Staff screen says so.

## 5. No endpoint to list sessions
- **Proposed:** `GET /ops/me/sessions` and `GET /ops/staff/{id}/sessions`, returning
  `[{id, created_at, last_seen_at, ip, user_agent}]`, plus DELETE to revoke one.
- **Workaround:** None. The feature isn't shown.

## 6. Returned or cancelled shipments don't change the order
- **What:** When a shipment is set to `returned` or `cancelled`, the order stays `dispatched`.
- **Proposed:** Put the order back to `ready` (or a new `returned` status) and write an order
  event.
- **Workaround:** Picking returned or cancelled in the shipment status dialog shows a warning
  that the order keeps its status.

## 7. Audit log filtering is limited
- **What:** Filters are exact-match only, and the result is capped at 200 rows with no paging.
- **Proposed:** Add `q` (substring over action/entity/summary), `from`/`to` dates, and cursor
  paging (`before_id`, `limit`), returning `next_cursor`.
- **Workaround:** The audit screen says "Exact subject match. The latest 200 entries are shown." 

## 8. Pipeline value is 0 for web enquiries
- **What:** Leads created from the web enquiry form have no `value`, so pipeline totals under-count.
- **Proposed:** Estimate the value from the enquiry's quantity × the price-book base price, or
  store `estimated_value` separately.
- **Workaround:** Lead cards show "No value" rather than ₹0, and staff can set the value on the lead.

## 9. Finding a lead's quotes scans 500 quotes
- **What:** There is no `lead_id` filter on `GET /ops/quotes`.
- **Proposed:** Add `?lead_id=` and `?customer_id=` filters, or embed `quotes` in
  `GET /ops/leads/{id}`.
- **Workaround:** None needed yet. Lead detail uses the `quotes` list that `GET /ops/leads/{id}`
  already returns. It will silently miss quotes once there are more than 500.

## 10. Quote `valid_until` resets on every save
- **What:** Each save recalculates `valid_until` as today + the CRM default validity. Editing an
  old quote quietly extends it, and a custom expiry can't be set.
- **Proposed:** Accept an optional `valid_until` in the quote body. Default it only on create or
  when it is missing.
- **Workaround:** The editor shows the expiry as read-only in the header.

## 11. Ticket owner is free text
- **What:** `owner` on tickets is a string. Tasks and leads use a staff id.
- **Proposed:** Store `owner_id` (staff id) and validate it against active staff.
- **Workaround:** The ticket owner dropdown lists staff and stores the staff id in that string.

## 12. Renaming CRM stages doesn't migrate leads
- **What:** If a stage is renamed or removed in Settings → CRM, leads keep the old stage.
  `crm.pipeline()` silently drops them, so they vanish from the board and the totals.
- **Proposed:** On save, either reject a removal while leads still use that stage (422 with a
  count), or accept a `renames: {old: new}` map and migrate the leads.
- **Workaround:** The CRM settings editor warns about this under the stage list. The leads can
  still be opened from their customer.

## 13. Marketplace numbers on the dashboard and the sellers list
- **What:** `GET /ops/dashboard` has no returns, COD or per-seller figures, and `GET /ops/sellers`
  has no order counts.
- **Proposed:** Add `returns_open`, `cod: {total, outstanding}` and
  `by_seller: [{seller_id, open, total}]` to the dashboard, and `open_orders`/`orders` to each
  seller in `GET /ops/sellers`.
- **Workaround:** The dashboard reads `/ops/returns` and `/ops/cod` and counts orders per seller
  from `/ops/orders`. The sellers list runs one small `/ops/orders?seller_id=` count per seller,
  which is fine for tens of sellers but not hundreds.

## 14. Seller logins can't read the carrier list
- **Status:** Done on the server and used by the app; the workaround below is removed.
- **What:** Carriers live in the delivery settings, and `/ops/settings/*` is 403 for a seller.
- **Proposed:** `GET /ops/carriers` (id and name only), readable with `seller`.
- **Workaround:** A seller types the carrier id in the shipment dialog, with suggestions taken
  from carriers already on its shipments. Staff still get the dropdown.

## 15. Seller logins can't download print files
- **Status:** Done on the server and used by the app; the workaround below is removed.
- **What:** The print-file download is a customer route, so a seller login can see an order but
  not fetch the artwork it must print.
- **Proposed:** `GET /ops/orders/{id}/print-files/{name}` under `need("production", seller=True)`,
  scoped to the seller's own orders.
- **Workaround:** The order screen tells a seller login to ask the UrJersey team for the files.

## 16. No rating filter on `/ops/reviews`
- **Status:** Done on the server and used by the app; the workaround below is removed.
- **Proposed:** `min_rating` and `max_rating` (or `rating`) query parameters.
- **Workaround:** The star chips filter the page that came back, and the screen says so.

## 17. Return photos
- **What:** A return carries `details` text only. Printing defects are hard to judge without a
  photo.
- **Proposed:** Accept up to 4 images on `POST /returns` and return their URLs on the ops record.
- **Workaround:** None. The drawer shows the customer's text.

## 18. `price_from` on the ops product record
- **What:** The shop shows a "from" price, but `GET /ops/products` doesn't return it.
- **Proposed:** Include the same `price_from` the shop computes.
- **Workaround:** `src/lib/marketplace.ts` (`priceFrom`) repeats the server's rule from the price
  book and the active sellers' price adjustments. It is display only.

## 19. Checkouts per customer
- **What:** There is `GET /ops/checkouts/{id}` but no list.
- **Proposed:** `GET /ops/checkouts?customer_id=`.
- **Workaround:** Customer detail collects the checkout ids from the customer's orders and fetches
  each one (the first 30).

## 20. `garment` in `ProductPatch`
- **Proposed:** Accept `garment` directly, re-making the spec on the server.
- **Workaround:** The product editor sends `spec` with the new garment.

## 21. Product source when a generated design is picked
- **What:** Creating from a brief with a picked preview has to send the picked `spec`, so the
  product's source is recorded as `spec` and the brief is lost.
- **Proposed:** Accept `brief` together with `spec` (or a `design_id`) and keep both in `source`.
- **Workaround:** None needed for the flow. Only the record of where the product came from is
  less precise.
