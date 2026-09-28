# Backend requests from the ops app

> **Status (server updated after this list was written):**
> - Done: 2 (late orders now carry `number`, `customer_name`, `status`), 4 (a password reset, role change or deactivation ends that person's sessions at once), 6 (a returned or cancelled shipment puts a dispatched order back to `ready`, with a timeline event), 9 (`/ops/quotes?lead_id=` and `?customer_id=`, and lead detail no longer scans all quotes), 10 (quotes accept `valid_until`, and editing keeps the existing expiry).
> - Decided: 1. Ops routes are protected by staff sign-in and roles, so they do not need the channel key.
> - Open: 3, 5, 7, 8, 11, 12. The app's workarounds stay in place.

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
