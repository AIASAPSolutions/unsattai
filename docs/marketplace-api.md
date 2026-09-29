# Marketplace API

The endpoints added for the marketplace (sellers and PIN code delivery, phone or email accounts, products, cart and checkout, cash on delivery, cancel, returns, reviews, notifications) and the operations endpoints behind them. It is written for the people building the web store, the mobile app and the operations app. Field-level schemas are in `docs/openapi.json`; the business rules are in `docs/platform.md`.

Everything that existed before still works as it did: `POST /orders`, `/shop/quote`, `/shop/catalogue`, the OTP routes with `{phone}`, `/me/*`, collections, quotes, tickets and `/ops/*`. Changes to existing endpoints are listed under [Changed endpoints](#changed-endpoints).

## Conventions

- **Base path** `/api/v1`. Operations routes are under `/api/v1/ops`.
- **Channel key.** When the server sets `API_KEYS`, every customer route needs `X-API-Key`. Operations routes need a staff session instead.
- **Sessions.** `Authorization: Bearer <token>` from a sign-in. Customer tokens last 60 days, staff tokens one day. Send a `User-Agent`; it becomes the session's device label.
- **Device.** Send a stable `X-Device-Id` (8 to 64 characters from `A-Z a-z 0-9 _ -`) from the app or browser; without it the device is the client's IP address. Orders and checkouts placed without signing in can be read and paid again from the same device.
- **Money** is in the currency's main unit (INR rupees) as a number with up to 2 decimals. The currency is in every price response.
- **Dates** are `YYYY-MM-DD`; times are ISO 8601 in UTC, for example `2026-09-28T10:21:53+00:00`.
- **Errors.** `401` not signed in or wrong code/password, `403` role not allowed or account blocked, `404` not found (also used when you may not see something), `409` conflicts with the current state, `422` invalid input, `429` too many attempts. The body is always `{"detail": ...}` where `detail` is one of:
  - a string: `{"detail": "This code has expired. Ask for a new one."}`
  - a list of field errors (request validation): `{"detail": [{"loc": ["body", "items", 0, "lines"], "msg": "...", "type": "..."}]}`
  - an object with `message` and a machine `code`: `{"detail": {"message": "We can't deliver to this PIN code yet.", "code": "not_serviceable"}}`
- **Paging.** List endpoints take `page` (from 1) and return `total`, `page` and `pages`.

### Reason codes

| Code | Meaning |
| --- | --- |
| `invalid_pincode` | Not six digits starting with 1 to 8, or not in the PIN code table. |
| `not_serviceable` | No active seller delivers to this PIN code (or it is blocked). |
| `garment_unavailable` | Sellers deliver here, but none makes this garment or fabric. |
| `pieces_out_of_range` | Sellers make it, but not in this quantity. |
| `seller_unavailable` | The `seller_id` asked for does not exist or is switched off. |
| `cod_unavailable` | Cash on delivery is off, not allowed in this area, or the total is above the limit. |
| `print_check_failed` | A roster line fails the manufacturing checks (checkout). |

---

## Customer endpoints

### Delivery and offers

#### `GET /shop/serviceability`

Which sellers can deliver, and when. Call it when the customer enters a PIN code on a product page or at checkout.

Query: `pincode` (required), `garment` (`jersey` | `vneck` | `shorts`, default `jersey`), `fabric` (fabric id, optional), `pieces` (default 1), `rush` (bool).

A bad PIN code is not an error: the response has `serviceable: false` and a `reason`.

```http
GET /api/v1/shop/serviceability?pincode=600028&garment=jersey&pieces=12
```

```json
{
  "pincode": "600028",
  "serviceable": true,
  "place": {"state": "TN", "state_name": "Tamil Nadu"},
  "reason": null,
  "offers": [
    {
      "seller_id": "sel_house", "seller_name": "UrJersey",
      "rating": {"average": 4.5, "count": 12},
      "unit_price": 474.05,
      "ship_date": "2026-10-02", "delivery_date": "2026-10-04", "transit_days": 2,
      "cod_available": true,
      "recommended": true, "fastest": true, "cheapest": true
    }
  ],
  "recommended_seller_id": "sel_house"
}
```

- `offers` is sorted best first: earliest `delivery_date`, then lowest `unit_price`, then best rating. Exactly one offer has `recommended: true` (the first); `fastest` and `cheapest` mark one offer each and can be the same offer.
- `unit_price` is one plain piece of this garment and fabric at this quantity (garment base plus fabric, the seller's adjustment, less the quantity discount), before names, numbers, logos, size surcharges, delivery and tax. Use `/shop/quote` or `/shop/cart/quote` for exact totals.
- `rating.average` is `null` until the seller has a review.
- `place` is `null` when the PIN code is invalid. Show "Delivery to Tamil Nadu" from `place.state_name`.

Not serviceable:

```json
{"pincode": "999999", "serviceable": false, "place": null, "reason": "invalid_pincode", "offers": [],
 "recommended_seller_id": null}
```

#### `GET /shop/offers`

Active public coupons for the checkout's "Available offers" list.

```json
{
  "currency": "INR",
  "items": [
    {"code": "WELCOME10", "title": "10% off orders above 1000 (up to 500)", "kind": "percent", "value": 10,
     "max_discount": 500, "min_subtotal": 1000, "expires": null}
  ]
}
```

`kind` is `percent` (value is a percentage) or `amount` (value is money). `min_subtotal` is compared with the cart's value after quantity discounts.

#### `GET /shop/sellers/{seller_id}`

Public profile for "Sold by": `{"id", "name", "rating": {"average", "count"}, "city", "state", "garments"}`. 404 for unknown or inactive sellers.

#### `GET /shop/delivery-estimate` (changed)

Query `pincode`, `pieces`, `rush`. Now answers for the recommended seller and says when the PIN code can't be served:

```json
{"zone": "Tamil Nadu", "serviceable": true, "seller": {"id": "sel_house", "name": "UrJersey"},
 "ship_date": "2026-10-02", "delivery_date": "2026-10-04", "ready_date": "2026-10-01", "production_days": 3}
```

```json
{"zone": "Rest of India", "serviceable": false, "reason": "not_serviceable", "ship_date": null,
 "delivery_date": null, "ready_date": null, "production_days": null}
```

### Products

#### `GET /shop/products`

Query (all optional):

| Param | Meaning |
| --- | --- |
| `q` | Words to match in the title, description, sport, garment, colours, tags and style name (all words must match). |
| `sport` | One of the sports in `GET /meta` (`football`, `cricket`, ...). |
| `garment` | `jersey`, `vneck` or `shorts`. |
| `colour` | A colour family: `black`, `white`, `grey`, `silver`, `red`, `maroon`, `orange`, `yellow`, `gold`, `green`, `lime`, `teal`, `sky blue`, `blue`, `navy`, `purple`, `pink`, `brown`. |
| `min_price`, `max_price` | Bounds on `price_from`. |
| `featured` | `true` for featured products only. |
| `sort` | `popular` (default: most paid orders, then featured), `new`, `price_asc`, `price_desc`, `rating`. |
| `page`, `size` | Page from 1; `size` 1 to 60, default 24. |

```json
{
  "items": [
    {
      "id": "prd_seed01", "slug": "royal-strikers", "title": "Royal Strikers",
      "description": "Midnight Legacy: a ready-made football jersey design. ...",
      "sport": "football", "garment": "jersey", "colours": ["blue", "white"], "tags": ["football", "jersey"],
      "fabric": "standard", "featured": true, "rating": {"average": null, "count": 0}, "orders_count": 0,
      "published_at": "2026-09-28T22:21:53+00:00",
      "price_from": 499.0, "currency": "INR",
      "image_url": "/api/v1/shop/products/royal-strikers/mockup.svg", "style_name": "Midnight Legacy"
    }
  ],
  "total": 12, "page": 1, "pages": 1, "sort": "popular",
  "facets": {
    "sport": [{"value": "football", "count": 2}, {"value": "cricket", "count": 1}],
    "garment": [{"value": "jersey", "count": 6}, {"value": "vneck", "count": 4}, {"value": "shorts", "count": 2}],
    "colour": [{"value": "black", "count": 4}, {"value": "white", "count": 3}],
    "price": {"min": 349.0, "max": 549.0}
  }
}
```

- Each facet is counted with every other filter applied but not its own, so the other choices in the same group stay visible with their counts. Facets are sorted by count, then name.
- `facets.price` is the range over all published products (for a slider).
- `price_from` is the lowest one-piece price any active seller offers for the product's garment and default fabric; `null` if no active seller makes it.
- `image_url` is relative to the API host (prefix it with the API base URL).

#### `GET /shop/products/{slug}`

The list fields plus:

```json
{
  "spec": {"garment": "jersey", "sport": "football", "style_name": "Midnight Legacy", "palette": {"...": "..."}},
  "review_summary": {"average": 4.0, "count": 1, "distribution": {"5": 0, "4": 1, "3": 0, "2": 0, "1": 0}},
  "reviews": [
    {"id": "rev_f796c37b8224", "rating": 4, "title": "Good print", "body": "Colours are bright.",
     "customer_name": "Asha K.", "created_at": "2026-09-28T22:23:56+00:00", "verified_purchase": true,
     "garment": "jersey", "seller_name": "UrJersey"}
  ],
  "fabrics": [{"id": "standard", "name": "Dri-fit polyester, 140 GSM", "surcharge": 0},
              {"id": "premium", "name": "Micro-mesh polyester, 160 GSM", "surcharge": 120}]
}
```

- `spec` is a full `DesignSpec`: open it in the designer to customise, or render it with `/render`.
- `reviews` holds the latest 10 visible reviews; page through the rest with the next endpoint.
- `fabrics` lists the fabrics available for this garment.
- 404 for unknown or unpublished products.

#### `GET /shop/products/{slug}/reviews?page=1`

`{"items": [review, ...], "total", "page", "pages"}`, 20 per page, newest first. Reviews have the same shape as in the product detail.

#### `GET /shop/products/{slug}/mockup.svg`

The product picture (`image/svg+xml`, cacheable for an hour).

### Cart

A cart item is a product or the customer's own design, never both:

```json
{
  "product_id": "prd_seed01",
  "spec": null,
  "design_id": "",
  "garment": null,
  "fabric": "standard",
  "logos": 0,
  "lines": [{"player_name": "Arul", "number": "7", "size": "M", "quantity": 10}],
  "seller_id": ""
}
```

| Field | Meaning |
| --- | --- |
| `product_id` | A published product. Or: |
| `spec` | A `DesignSpec` (the customer's own design). |
| `design_id` | Optional id of the generated design the spec came from. |
| `garment` | Optional: make the design as another garment. Default: the design's own. |
| `fabric` | Fabric id; must be offered for the garment. |
| `logos` | Logo count for pricing when the spec has no logo layers (0 to 4). |
| `lines` | 1 to 200 roster lines; `size` is `XS`..`XXL`, `quantity` 1 to 500, at most 5000 pieces per item. `player_name` up to 16 characters, `number` up to 3 digits. |
| `seller_id` | Optional: a seller the customer picked from the offers. Empty means the recommended seller. |

A cart holds at most 20 items.

#### `GET /me/cart` · `PUT /me/cart` · `POST /me/cart/merge`

Signed-in only. `PUT` replaces the saved cart with `{"items": [...]}`. `merge` adds a guest's device cart after sign-in, skipping items identical to saved ones and stopping at 20. All three return:

```json
{"items": [{"product_id": "prd_seed02", "design_id": "", "fabric": "standard", "logos": 0,
            "lines": [{"player_name": "", "number": "", "size": "L", "quantity": 3}], "seller_id": ""}],
 "max_items": 20}
```

Guests keep the cart on the device and call `merge` right after signing in.

#### `POST /shop/cart/quote`

Prices every item (each with its seller and dates) and the whole cart. No sign-in needed.

```json
{
  "items": [cart item, ...],
  "delivery": {"method": "ship", "pincode": "600028", "state": ""},
  "coupon": "WELCOME10",
  "rush": false,
  "payment_method": "online"
}
```

`delivery.method` is `ship` or `pickup`. `payment_method` is `online` or `cod`.

```json
{
  "currency": "INR",
  "items": [
    {
      "index": 0, "product_id": "prd_seed01", "title": "Royal Strikers", "garment": "jersey",
      "seller": {"id": "sel_house", "name": "UrJersey"},
      "quote": {"...": "the same shape as POST /shop/quote, including estimate"},
      "coupon_share": 500.0,
      "delivery_date": "2026-10-04",
      "problems": []
    }
  ],
  "coupon": {"code": "WELCOME10", "amount": 500.0, "note": "First order",
             "split": [{"index": 0, "amount": 500.0}]},
  "payment_method": "online",
  "pieces": 10,
  "totals": {"subtotal": 5690.0, "quantity_discount": 284.5, "rush": 0.0, "coupon": 500.0, "shipping": 120.0,
             "cod_fee": 0.0, "tax": 251.28, "total": 5276.78},
  "cod_available": true,
  "delivery_by": "2026-10-04",
  "problems": []
}
```

- The coupon is worked out once on the whole cart (after quantity discounts) and split by item value; `coupon.split[i].amount` equals `items[i].coupon_share` and each item quote's `coupon.amount`. When the code is not valid, `coupon` is `{"code", "amount": 0, "error": "..."}` and there is no `split`.
- Each item's `quote.seller` is `null` and `quote.seller_problem` holds a reason code when no seller (or not the chosen one) can serve it; `problems` then explains it.
- `problems` at the top lists every item's problems as `"Item 2: ..."`. An empty list means the cart can be checked out.
- `cod_available` is true when every item can be paid on delivery. `totals.cod_fee` is non-zero only with `payment_method: "cod"`; the fee is charged once per cart, on the first item (the others show 0).
- `delivery_by` is the latest delivery date over the items.
- One delivery charge per seller: it is worked out on that seller's pieces and goods value together (so the free-delivery threshold applies to the combined value), sits on the seller's first item, and the seller's other items show `shipping.amount: 0`. `shipping.combined: true` marks every item that shares one charge with other items of the same seller, including the one that carries it. Each item also has `slug` and `image_url` (null for custom designs). Pickup is one fee per cart. Taxes stay per item, because every item becomes its own order and invoice.

### Checkout

#### `POST /checkout`

Creates one order per item under one checkout number. All or nothing. The customer may be signed in (orders go to their account) or a guest.

```json
{
  "items": [cart item, ...],
  "customer": {"name": "Asha", "phone": "+91 98765 43210", "email": "asha@example.com"},
  "delivery": {"method": "ship", "address": {"name": "Asha", "phone": "+91 98765 43210", "line1": "12 Stadium Road",
               "line2": "", "city": "Chennai", "state": "TN", "pincode": "600028"}},
  "coupon": "WELCOME10",
  "rush": false,
  "payment_method": "online",
  "idempotency_key": "web-ck-000001",
  "channel": "web",
  "language": "en"
}
```

- `delivery.address` is required when `method` is `ship`. `state` is a 2 to 4 letter code such as `TN`.
- `idempotency_key`: 8 to 60 characters from `A-Z a-z 0-9 _ -`, new for every checkout attempt, and reused unchanged on retries. The same key with the same body returns the existing checkout (`200`, `"duplicate": true`); with a different body it is a `409`.
- `channel` is `web` or `app`; `language` is `en`, `hi`, `te` or `ta`.

`201 Created`:

```json
{
  "id": "chk_a6119f0ecd0e", "number": "CK-00001",
  "order_ids": ["ord_4ff60f91a155"],
  "customer": {"name": "Asha", "phone": "+91 98765 43210", "email": "asha@example.com"},
  "customer_id": "cus_ae081fb170b8",
  "payment_method": "online", "status": "open",
  "coupon": {"code": "WELCOME10", "amount": 500.0, "note": "First order", "split": [{"index": 0, "amount": 500.0}]},
  "currency": "INR",
  "totals": {"subtotal": 5690.0, "quantity_discount": 284.5, "rush": 0.0, "coupon": 500.0, "shipping": 120.0,
             "cod_fee": 0.0, "tax": 251.28, "total": 5276.78},
  "channel": "web",
  "created_at": "2026-09-28T22:21:53+00:00", "updated_at": "2026-09-28T22:21:53+00:00",
  "orders": [order view, ...],
  "duplicate": false
}
```

- `orders[i]` is the full customer order view (see [Order view](#order-view)) for `items[i]`.
- `status` is `open` until paid, `paid` after `POST /checkouts/{id}/pay`, and `paid` straight away for cash on delivery.
- `totals.total` is the sum of the orders' totals.

`422` when any item can't be ordered. Nothing is created:

```json
{
  "detail": {
    "message": "Some items can't be ordered, so nothing was ordered.",
    "items": [
      {"index": 1, "code": "print_check_failed", "message": "Some lines fail manufacturing checks.",
       "failures": [{"line": 1, "player_name": "", "number": "9", "size": "L",
                     "checks": [{"id": "text_contrast", "level": "fail",
                                 "message": "Name/number contrast vs base colour is 1.0:1 (minimum 3.0:1, 4.5:1 recommended).",
                                 "element_id": null}]}]}
    ]
  }
}
```

`items[].code` is a [reason code](#reason-codes). A missing or unpublished product is a `404` (`"product prd_x is not available"`).

#### `GET /checkouts/{id}` · `POST /checkouts/{id}/pay`

Guarded like orders: allowed for the checkout's signed-in customer, the device that placed it, staff, or with `?phone=` matching the checkout's phone. Anyone else gets `404`.

`pay` records the demo payment for every online order in the checkout that is still awaiting payment, then returns the checkout with `status: "paid"` and the updated orders (now `fulfilment.status: "queued"`). Paying again changes nothing.

#### `GET /me/checkouts`

The signed-in customer's checkouts, newest first: `{"items": [checkout without orders], "total"}`.

### Sign-in

#### `POST /auth/otp/request`

`{"phone": "+91 98765 43210"}` or `{"email": "asha@example.com"}` (exactly one).

```json
{"sent": true, "email": "asha@example.com", "expires_in": 600, "dev_code": "977319"}
```

- The key is `phone` or `email`, with the normalised value (`+919876543210`, lower-case email).
- The answer is the same whether or not an account exists.
- `dev_code` is present only while the server runs with `OTP_DEV_ECHO` on (test setups). Never rely on it in production builds.
- `429` if asked again for the same phone or email within 30 seconds. `422` for a malformed phone or email.

#### `POST /auth/otp/verify`

`{"email": "asha@example.com", "code": "977319", "name": "Asha"}` or the same with `phone`. `name` is optional and only used for a new account.

```json
{
  "token": "9xtoCCELvI4QPcqPU35_xcLTjkqM9waoPRpr0N-uM-o",
  "expires_at": "2026-11-27T22:21:53+00:00",
  "session_id": "ses_c5b6beea6454",
  "customer": {"id": "cus_ae081fb170b8", "name": "Asha", "phone": "", "email": "asha@example.com", "addresses": [],
               "marketing_opt_in": false, "orders_count": 0,
               "phone_verified": false, "email_verified": true, "has_password": false}
}
```

- An email that is no account's verified email creates a new account; a phone reuses the customer with that phone.
- Guest orders with this verified phone or verified email are linked to the account. `orders_count` counts paid orders.
- `401` wrong or expired code; `429` after 5 wrong codes (ask for a new one); `403` blocked account.

#### `POST /auth/login`

```json
{"identifier": "9876543210", "password": "Better0ne1234"}
```

`identifier` is a mobile number (any common format) or an email. Only a verified phone or email with a password set can sign in this way. Returns the same body as `otp/verify`.

- `401` `"The mobile number, email or password is not right."` for a wrong password and for unknown identifiers alike.
- `429` after 5 wrong passwords for that identifier, for 15 minutes, even with the right password. Offer "Sign in with a code" instead.

#### `POST /me/password`

```json
{"current": "Old0nePassword", "new": "Better0ne1234"}
```

- Sets or changes the password. `current` is needed when the account already has a password, except within 15 minutes of signing in with a code (the "forgot password" flow: sign in with a code, then set a new one).
- `422` when the new password is too weak (at least 10 characters, upper and lower case, a digit); `401` when `current` is wrong.
- Signs out every other session of the account: `{"ok": true, "other_sessions_signed_out": 2}`.

#### `POST /me/identifiers/request` · `POST /me/identifiers/verify`

Add or change the account's phone or email. Request with `{"email": "..."}` or `{"phone": "..."}` sends a code (same response as `otp/request`). Verify with the same key plus `"code"`; it returns the profile (`GET /me` shape) with the new value verified and links guest orders placed with it.

`409` `"This email belongs to another account."` (or mobile number) when another signed-in account holds it. A phone that only appears on guest orders is moved to this account.

#### `GET /me` (changed)

Adds `phone_verified`, `email_verified` and `has_password`. `phone` may be `""` for accounts made by email. `PATCH /me` still accepts `email`; a changed email is contact detail only (`email_verified` becomes false) until verified through `/me/identifiers`.

### Sessions

#### `GET /me/sessions`

```json
{"items": [
  {"id": "ses_c5b6beea6454", "created_at": "2026-09-28T22:21:53+00:00", "last_seen_at": "2026-09-30T08:02:11+00:00",
   "device_label": "Chrome on Android", "current": true}
]}
```

Newest activity first. `last_seen_at` is updated at most once a minute. `device_label` comes from the `User-Agent` at sign-in, for example `Chrome on Android`, `Safari on iPhone`, `UrJersey app on Android`, or `Unknown device`. A mobile app can include `UrJersey` in its `User-Agent` to be labelled as the app.

#### `DELETE /me/sessions/{id}` · `POST /me/sessions/revoke-others`

Sign out one session (`404` if it is not one of yours) or every session except the current one: `{"ok": true, "signed_out": 3}`. `POST /auth/logout` still ends the current session.

### Wishlist

- `GET /me/wishlist`
- `POST /me/wishlist` with `{"product_id": "prd_seed02"}` (`404` if not published; adding twice is harmless)
- `DELETE /me/wishlist/{product_id}`

All three return:

```json
{"product_ids": ["prd_seed02"], "items": [product as in the product list]}
```

Newest first. `items` leaves out products that were unpublished since they were saved. Saved designs (`/me/designs`) are unchanged.

### After the order

#### Order view

Every customer order response (`POST /orders`, `GET /orders/{id}`, `GET /me/orders/{id}`, `/orders/{id}/track`, checkout `orders`) has these fields in addition to the existing ones:

```json
{
  "seller": {"id": "sel_house", "name": "UrJersey"},
  "checkout_id": "chk_a6119f0ecd0e",
  "payment_method": "online",
  "can_cancel": true,
  "can_return": false,
  "return_until": null,
  "review": null,
  "returns": [],
  "refunds": []
}
```

| Field | Meaning |
| --- | --- |
| `seller` | Who makes and ships it ("Sold by"). Older orders show the house seller. |
| `checkout_id` | The checkout it belongs to, or `null` for single orders. |
| `payment_method` | `online` or `cod`. |
| `can_cancel` | The customer may cancel now: unpaid, or paid (or cash on delivery) with no production stage done. |
| `can_return` | Delivered, within the window, no open return, and returns are switched on. |
| `return_until` | Last day to ask for a return (set on delivery), else `null`. |
| `review` | `{"id", "rating", "title", "body", "created_at", "hidden"}` once reviewed, else `null`. |
| `returns` | `[{"id", "number", "status", "reason", "details", "lines", "resolution", "refund_amount", "created_at", "updated_at", "note"}]`. |
| `refunds` | `[{"id", "amount", "at", "method", "note"}]`; `method` is `demo` (no money moved) or `manual` (paid back by hand). |

Cash on delivery orders have `payment: {"method": "cod", "collected": false, "amount": 2776.2, "collected_at": null, ...}` and `fulfilment.status: "queued"` straight away. `pricing.cod` is `{"selected", "fee", "available", "max_order_value"}` and `pricing.seller` is the seller priced for.

New timeline codes: `cod_confirmed`, `cod_collected`, `refund` (param `amount`), `return_requested`, `return_approved`, `return_picked_up`, `return_resolved` (param `resolution`), `return_rejected`, `reviewed`.

#### `POST /me/orders/{id}/cancel`

`{"reason": "Ordered twice"}` (3 to 300 characters). Returns the order view with `fulfilment.status: "cancelled"` and, if money was taken, a `refunds` entry. `409` once production has started, or if it is already cancelled. `404` for someone else's order.

#### `POST /me/orders/{id}/returns`

```json
{"reason": "print_quality", "details": "Number 9 is peeling", "lines": [{"line": 1, "quantity": 1}]}
```

- `reason` must be one of the business's returnable reasons (`GET /shop/catalogue` → `returns.reasons`; by default `damaged`, `wrong_item`, `print_quality`), else `422`.
- `lines` is optional (default: the whole order); each `line` is an order line number and `quantity` at most that line's quantity, else `422`.
- `409` before delivery, after `return_until` (the message names the date), or while another return is open.

`201`:

```json
{"return": {"id": "ret_2e3931d50527", "number": "R-00001", "status": "requested", "reason": "print_quality",
            "details": "Number 9 is peeling", "lines": [{"line": 1, "quantity": 1}], "resolution": null,
            "refund_amount": null, "created_at": "2026-09-28T22:23:56+00:00",
            "updated_at": "2026-09-28T22:23:56+00:00", "note": ""},
 "order": {order view}}
```

Return statuses: `requested → approved → picked_up → resolved` (`resolution` `replacement` or `refund`), or `rejected` from any step before `resolved`. `note` is the latest message from the business.

#### `GET /me/returns`

`{"items": [return summary + "order_id", "order_number"], "total"}`, newest first.

#### `POST /me/orders/{id}/review`

`{"rating": 4, "title": "Good print", "body": "Colours are bright."}`: `rating` 1 to 5, `title` up to 120 and `body` up to 4000 characters (both optional).

`201`: `{"review": {review as on the product page}, "order": {order view with review}}`. `409` before delivery or when already reviewed. The public `customer_name` is the first name and last initial ("Asha K.").

### Notifications

#### `GET /me/notifications?unread_only=false&page=1`

```json
{"items": [{"id": "ntf_18d99c3d38cbb70d113c", "code": "placed", "title": "Order UJ-00001 placed",
            "body": "We have your order UJ-00001. Total INR 5276.78.", "order_id": "ord_4ff60f91a155",
            "read": false, "created_at": "2026-09-28T22:21:53+00:00"}],
 "total": 1, "unread": 1, "page": 1}
```

30 per page, newest first. Codes: `placed`, `confirmed`, `dispatched`, `delivered`, `cancelled`, `return_requested`, `return_approved`, `return_picked_up`, `return_resolved`, `return_rejected`. Notifications of guest orders move to the account when the order is linked on sign-in. SMS and email go to the order's phone and email either way.

#### `POST /me/notifications/read`

`{"ids": ["ntf_..."]}` or `{"all": true}` → `{"ok": true, "marked": 1, "unread": 0}`.

---

## Changed endpoints

| Endpoint | Change |
| --- | --- |
| `POST /auth/otp/request`, `/auth/otp/verify` | Accept `email` instead of `phone`. Tokens now include `session_id`. |
| `GET /me`, `PATCH /me` | See [GET /me](#get-me-changed). |
| `POST /shop/quote` | Optional `seller_id` and `payment_method` (`online` \| `cod`). The response adds `seller` (`{id, name}` or `null`), `seller_problem` (reason code or `null`), `payment_method`, `cod` (`{selected, fee, available, max_order_value}`). `shipping.transit_days` and `estimate` are now the seller's. A line's `parts` has a `seller` amount when the seller's price differs from the price book. A PIN code nobody serves is listed in `problems`. |
| `POST /orders` | Optional `seller_id` and `payment_method` (`online` \| `cod`). `422` `{"message", "code"}` with a [reason code](#reason-codes) when the PIN code can't be served by the chosen or any seller, or cash on delivery is not available. Cash on delivery orders come back already queued. |
| Order views | New fields, see [Order view](#order-view). |
| `GET /orders/{id}/invoice` | Shows "Sold by", and the cash on delivery fee. A cash on delivery order is a proforma invoice until the cash is collected. |
| `GET /shop/catalogue` | Adds `cod` (`{enabled, fee, max_order_value}`) and `returns` (`{window_days, reasons}`). |
| `GET /shop/delivery-estimate` | See above. |

---

## Operations endpoints

All under `/api/v1/ops` with a staff token. The role needed is shown for each group; `admin` can do everything. Routes marked **seller** also accept a seller login and then only ever show or change that seller's data (a `seller_id` query is ignored and replaced by the login's own seller).

### Seller filters on existing routes

These take an optional `seller_id` query parameter (role `read`, and **seller**):

| Route | Effect |
| --- | --- |
| `GET /orders?seller_id=&checkout_id=` | Orders of that seller. `checkout_id` returns just that checkout's orders. Order rows now carry `seller_id`, `seller_name`, `payment_method`, `checkout_id`, `email`, `product_id` and `cod_collected` (`null` unless cash on delivery). |
| `GET /production/plan?seller_id=` | That seller's plan; `stages` show its capacities. Each plan row has `seller_id`. |
| `GET /production/utilisation?seller_id=&days=` | That seller's load and capacity. Without it, all sellers added together (capacity counts a seller only on its working days). Response adds `seller_id`. |
| `GET /production/board?seller_id=` | Cards carry `seller_id`. |
| `GET /production/worklist?stage=&day=&seller_id=` | Items carry `seller_id`. |
| `GET /delivery/plan?seller_id=` | Rows carry `seller_id` and `payment_method`. |
| `GET /shipments?seller_id=` | Shipments carry `seller_id`. |

`GET /orders/{id}` now also returns `checkout` (`{id, number, order_ids, payment_method, status}` or `null`), `returns` and `seller` (the seller record). For a seller login it leaves out activities, audit and customer ids.

Seller logins may also: `GET /orders/{id}`, `GET /orders/{id}/invoice`, `POST /orders/{id}/stages/{stage}`, `POST /orders/{id}/shipments`, `PATCH /shipments/{id}`, `GET /shipments/{id}/label` for their own orders (another seller's order or shipment is a `404`). Every other existing ops route answers a seller login with `403`, and the customer order routes (`/orders/{id}`, payment, invoice, files) treat it like any stranger.

### Staff

`POST /staff` and `PATCH /staff/{id}` take `seller_id` (role `staff`, admin only). It is required for `"role": "seller"` and refused for other roles (`422`):

```json
{"email": "unit@partner.test", "name": "Partner", "role": "seller", "password": "Partn3rPassword",
 "seller_id": "sel_9a1b2c3d4e5f"}
```

```json
{"id": "stf_480688690de4", "email": "unit@partner.test", "role": "seller", "active": true,
 "created_at": "2026-09-28T22:23:57+00:00", "name": "Partner", "seller_id": "sel_9a1b2c3d4e5f"}
```

Staff sign-in (`POST /auth/login`) now locks an email for 15 minutes after 5 wrong passwords (`429`). A seller login's `GET /me` has `"permissions": ["seller"]` and `staff.seller_id`.

### Sellers

| Route | Role | |
| --- | --- | --- |
| `GET /sellers?q=&status=active\|inactive` | read, **seller** | `{"items": [seller], "total"}`. A seller login sees only its own. |
| `POST /sellers` | settings | Create. `201` with the seller. |
| `GET /sellers/{id}` | read, **seller** | `{"seller", "staff": [seller logins], "orders_by_status": {"queued": 3}}`. |
| `PUT /sellers/{id}` | settings | Replace all editable fields (send the whole object). |
| `DELETE /sellers/{id}` | settings | Deletes a seller with no orders; one with orders is switched off: `{"ok": true, "deleted": false, "deactivated": true}`. The house seller can't be deleted or switched off (`409`). |
| `GET /sellers/{id}/pincode-check?pincode=&garment=&fabric=&pieces=` | read, **seller** | Coverage editor's test. |

Seller body (`POST` and `PUT`):

```json
{
  "name": "Fast Prints",
  "legal_name": "Fast Prints Pvt Ltd",
  "gstin": "33ABCDE1234F1Z5",
  "email": "hello@fastprints.example",
  "phone": "+91 90000 12345",
  "address": {"line1": "4 Mill Road", "city": "Coimbatore", "state": "TN", "pincode": "641001"},
  "active": true,
  "garments": ["jersey", "vneck", "shorts"],
  "fabrics": [],
  "service_areas": [
    {"match": "641", "transit_days": 1, "cod": true},
    {"match": "TN", "transit_days": 2, "cod": true},
    {"match": "*", "transit_days": 6, "cod": false}
  ],
  "blocked_pincodes": ["600119"],
  "capacity_factor": 1.0,
  "holidays": ["2026-10-20"],
  "handling_days": 0,
  "min_pieces": 1,
  "max_pieces": 5000,
  "price_adjust": 0.05
}
```

Only `name` and `service_areas` are required; the rest default as shown (`fabrics: []` means every fabric). Validation (`422` with the field and a message):

- `service_areas[].match`: a PIN code prefix of 1 to 6 digits not starting with 0, a state code from the PIN code table (`TN`, `KA`, `DL`, ...), or `*`. Each match once. 1 to 500 areas. `transit_days` 0 to 60.
- `blocked_pincodes`: six digits each. `holidays`: `YYYY-MM-DD`.
- `garments`: at least one of `jersey`, `vneck`, `shorts`. `fabrics`: ids from the price book (`422` `"Unknown fabric 'silk'. ..."`).
- `capacity_factor` above 0, up to 20. `price_adjust` -0.5 to 2. `min_pieces` ≤ `max_pieces`. `gstin` empty or 15 characters `0-9A-Z`.

Seller response: the body plus `id`, `rating` (`{"average": 4.5 | null, "count": 12}`), `created_at`, `updated_at`, and `house: true` on `sel_house`.

Pincode check response:

```json
{"pincode": "641601", "place": {"state": "TN", "state_name": "Tamil Nadu"}, "serviceable": true, "reason": null,
 "area": {"match": "64", "transit_days": 2, "cod": true}, "blocked": false, "matched_by": "prefix",
 "estimate": {"ship_date": "2026-10-02", "delivery_date": "2026-10-04", "ready_date": "2026-10-01", "production_days": 3}}
```

`matched_by` is `prefix`, `state`, `*` or `null`. For an invalid PIN code: `place: null`, `reason: "invalid_pincode"`, `area` and `estimate` `null`.

### Products

| Route | Role | |
| --- | --- | --- |
| `GET /products?q=&status=draft\|published&page=` | read | Full product records, 50 per page, newest first. |
| `POST /products` | pricing | Create. |
| `GET /products/{id}` | read | |
| `PATCH /products/{id}` | pricing | Change any of `title`, `description`, `sport`, `tags`, `fabric`, `featured`, `status`, `spec`. |
| `DELETE /products/{id}` | pricing | |
| `POST /products/{id}/publish` · `/unpublish` | pricing | `status` becomes `published` or `draft`. |
| `POST /products/{id}/feature?featured=true` | pricing | `featured=false` removes it. |

Create body: the product fields plus **exactly one** source:

```json
{"title": "Chennai Chargers", "slug": "", "description": "", "sport": "cricket", "tags": ["club"],
 "fabric": "standard", "featured": false, "status": "draft",
 "brief": {"prompt": "yellow and blue cricket jersey", "sport": "cricket", "garment": "jersey", "team_name": "", "seed": 5}}
```

| Source | Meaning |
| --- | --- |
| `spec` | A `DesignSpec`. |
| `brief` | Designed now by the design engine (`prompt` required; `garment`, `sport`, `team_name`, `seed` optional). |
| `order_id` | The design of a past order, without its player name and number. |
| `quote_id` | The design of a sales quote, likewise. |

`slug` is optional (from the title) and made unique with `-2`, `-3`. `fabric` must be offered for the design's garment. The response is the product record: `id`, `slug`, `title`, `description`, `sport`, `garment`, `spec`, `tags`, `colours`, `fabric`, `featured`, `status`, `orders_count`, `rating`, `source` (`{"kind": "spec" | "brief" | "order" | "quote" | "seed", "ref"}`), `published_at`, `created_at`, `updated_at`.

### Reviews

| Route | Role | |
| --- | --- | --- |
| `GET /reviews?status=visible\|hidden&product_id=&seller_id=&q=&page=` | read | Full review records (with `order_id`, `customer_id`, `seller_id`, `hidden`, `hidden_reason`), newest first. |
| `POST /reviews/{id}/moderate` | crm | `{"hidden": true, "reason": "Abusive language"}` hides; `{"hidden": false}` shows it again. Ratings are recounted. |

### Returns

| Route | Role | |
| --- | --- | --- |
| `GET /returns?status=requested,approved&seller_id=&q=&page=` | read, **seller** | Return records, newest first; `q` matches the return number, order number or customer name. |
| `GET /returns/{id}` | read, **seller** | `{"return", "order": order view}`. |
| `POST /returns/{id}/status` | orders, **seller** | Move it on. |

```json
{"status": "resolved", "resolution": "refund", "refund_amount": 500, "note": "Refunded to UPI"}
```

- Allowed moves: `requested → approved | rejected`, `approved → picked_up | rejected`, `picked_up → resolved | rejected`. Anything else is `409`.
- `resolved` needs `resolution` (`replacement` or `refund`), else `422`. `refund_amount` defaults to the order total; a refund is recorded on the order.
- `note` is shown to the customer.

Return record:

```json
{"id": "ret_2e3931d50527", "number": "R-00001", "order_id": "ord_6f2079e65c36", "order_number": "UJ-00001",
 "customer_id": "cus_3fd3fda6dfe5", "customer_name": "Asha", "seller_id": "sel_house", "status": "approved",
 "reason": "print_quality", "details": "Number 9 is peeling", "lines": [{"line": 1, "quantity": 1}],
 "resolution": null, "refund_amount": null, "note": "Pickup on Monday",
 "history": [{"at": "...", "status": "requested", "by": "customer:cus_3fd3fda6dfe5"},
             {"at": "...", "status": "approved", "by": "staff:stf_290313193532", "note": "Pickup on Monday"}],
 "created_at": "...", "updated_at": "..."}
```

### Cash on delivery

| Route | Role | |
| --- | --- | --- |
| `GET /cod?collected=true\|false&seller_id=&page=` | read, **seller** | Cash on delivery orders (not cancelled) as order rows, plus `outstanding`: the total not yet collected. |
| `POST /orders/{id}/cod-collected` | delivery, **seller** | `{"reference": "RCPT-9"}` marks it collected by hand. Returns the full order. `409` if the order is not cash on delivery or was cancelled. Collected orders are unchanged by a second call. |

Delivering the shipment marks the cash collected automatically.

### Checkouts and outbox

| Route | Role | |
| --- | --- | --- |
| `GET /checkouts/{id}` | read | The checkout with `orders` as order rows. |
| `GET /messages?channel=sms\|email&status=logged\|sent\|failed&order_id=&q=&page=` | read | The SMS and email outbox, newest first, 50 per page. |

Message:

```json
{"id": "msg_18d99c3d38f40a570539", "channel": "email", "to": "asha@example.com", "subject": "Order UJ-00001 placed",
 "body": "We have your order UJ-00001. Total INR 5276.78.", "status": "logged", "customer_id": "cus_ae081fb170b8",
 "order_id": "ord_4ff60f91a155", "event": "placed", "sent_at": "2026-09-28T22:21:53+00:00",
 "created_at": "2026-09-28T22:21:53+00:00", "updated_at": "2026-09-28T22:21:53+00:00"}
```

`status` is `logged` while no provider is connected, `sent` when the provider accepted it, `failed` when it did not. One-time codes are never in the outbox.

### Settings changes

| Section | New fields |
| --- | --- |
| `price_book` | `cod`: `{"enabled": true, "fee": 49, "max_order_value": 20000}` (`fee` 0 to 10000, `max_order_value` above 0 or `null`). Each coupon: `public` (bool, default false) and `title` (up to 80 characters, required when `public`). |
| `crm` | `return_window_days` (0 to 60; 0 turns returns off) and `returnable_reasons` (ids like `print_quality`: 2 to 30 of `a-z 0-9 _`). |

Seller data is not in settings; use the sellers routes.

## Typical flows

**Product page.** `GET /shop/products/{slug}` → customer enters a PIN code → `GET /shop/serviceability?pincode=&garment=&pieces=` → show the recommended offer ("Sold by UrJersey · Delivery by Sun 4 Oct") and the others.

**Checkout.** Keep the cart (server cart when signed in) → `GET /shop/offers` → `POST /shop/cart/quote` as the customer changes the address, coupon or payment method → `POST /checkout` with a new `idempotency_key` → for online payment, `POST /checkouts/{id}/pay` → show the orders.

**Sign-in.** `POST /auth/otp/request` → `POST /auth/otp/verify` → `POST /me/cart/merge` with the device cart. With a password: `POST /auth/login`. Forgot password: sign in with a code, then `POST /me/password {"new": ...}` within 15 minutes.

**Order page.** Read `can_cancel`, `can_return`, `return_until` and `review` from the order view to show Cancel, Return and Review buttons.
