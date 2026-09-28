# Marketplace upgrade: sellers, PIN code delivery, phone and email accounts

Nigv asked (2026-09-28) for the customer apps to work like Amazon or Flipkart: delivery checked by PIN code against which sellers can serve it, sign-in by mobile number or email, and the usual marketplace features. This is the plan and the API contract that the server, web store, mobile app and operations app build against.

Defaults picked (can change later):
- **Sellers are production partners** (print units, including the business's own unit). Each has its own delivery coverage, capacity, garments, price and cash on delivery. The business manages them in the operations app, and each seller can get a staff login that only sees its own orders.
- **The customer never has to pick a seller.** The best offer (earliest delivery, then lowest price, then rating) is chosen automatically, like "Sold by … · Delivery by Thu". Other offers are shown on the product page.
- **Custom printed goods** are cancellable until production starts, and returnable only for defects (damaged, wrong item, print quality), within 7 days of delivery. The business can change this.

## 1. Sellers and PIN code serviceability

Seller record (`kind = "seller"`):

```
{ id "sel_…", name, legal_name, gstin, email, phone,
  address { line1, city, state, pincode }, active,
  garments ["jersey","vneck","shorts"], fabrics [] (empty = all),
  service_areas [ { match "600" | "TN" | "*", transit_days, cod } ],   // most specific match wins: longest prefix, then state, then "*"
  blocked_pincodes ["600119", …],
  capacity_factor 1.0,        // multiplies every production stage capacity for this seller
  holidays ["2026-10-20"], handling_days 0,
  min_pieces 1, max_pieces 5000,
  price_adjust 0.0,           // e.g. 0.05 = 5% above the price book per piece
  rating { average, count } }  // computed from reviews
```

- On first start the server creates `sel_house` (the company's own unit) serving `*` with the delivery zones' transit days, so current behaviour is unchanged.
- `GET /api/v1/shop/serviceability?pincode=&garment=&fabric=&pieces=&rush=` returns `{ pincode, serviceable, place {state, state_name} | null, reason, offers [ {seller_id, seller_name, rating, unit_price, ship_date, delivery_date, transit_days, cod_available, recommended, fastest, cheapest} ], recommended_seller_id }`. `reason` is one of `invalid_pincode`, `not_serviceable`, `garment_unavailable`, `pieces_out_of_range` when nothing serves it.
- A PIN code table maps the first digits to a state for display ("Chennai area, Tamil Nadu" style is not required; state is enough).
- Quotes, orders and checkouts take an optional `seller_id`. Without it the recommended seller is used. A seller that cannot serve the PIN code is a quote problem and a 422 on order.
- Planning runs per seller: the global production stages with capacities × `capacity_factor`, plus the seller's holidays, over that seller's orders. Delivery date = seller ship date + the seller's transit days for that PIN code.
- Orders store `seller {id, name}`. Invoices show "Sold by".

## 2. Accounts: mobile or email

- `POST /auth/otp/request` takes `{ phone }` or `{ email }`; `POST /auth/otp/verify` takes the same plus `code` (and optional `name`). Email codes go through an email hook exactly like SMS (logged, echoed only with `OTP_DEV_ECHO=1`). The response is the same whether or not an account exists.
- Optional password: `POST /me/password { current?, new }` (same strength rule as staff). `POST /auth/login { identifier, password }` where identifier is a phone or email. 5 wrong tries lock that identifier for 15 minutes. Forgot password = sign in with a code, then set a new one.
- A customer has `phone`, `email`, `phone_verified`, `email_verified`. Adding or changing either needs a code sent to it: `POST /me/identifiers/request`, `POST /me/identifiers/verify`. One that belongs to another account is refused (409).
- Sessions: `GET /me/sessions` (id, created, last seen, device label, current), `DELETE /me/sessions/{id}`, `POST /me/sessions/revoke-others`.
- Guest orders are linked on sign-in by verified phone or verified email.

## 3. Shopping

- **Products** (ready-made designs to buy or customise): `GET /shop/products?q=&sport=&garment=&colour=&min_price=&max_price=&sort=popular|new|price_asc|price_desc|rating&page=` with facet counts; `GET /shop/products/{slug}` with price from, rating and review summary. The operations app creates, edits, features and publishes them (from a brief, a past order or a quote). About a dozen are seeded on first start from the built-in design engine so the store is not empty.
- **Wishlist:** `GET/POST/DELETE /me/wishlist` (product ids). Saved designs stay as they are.
- **Cart:** signed-in customers keep a server cart, `GET/PUT /me/cart` (up to 20 items; each item is a product or custom design with garment, fabric, logos and lines). Guests keep it on the device and it is merged on sign-in.
- **Cart quote:** `POST /shop/cart/quote { items, delivery {method, pincode, state}, coupon, rush, payment_method }` prices every item (with seller and dates) and the whole cart. A coupon applies to the cart and is split across items by value.
- **Checkout:** `POST /checkout { items, customer, delivery {method, address}, coupon, rush, payment_method "online" | "cod", idempotency_key, channel }` creates one order per item (all or nothing: print-check failures come back per item with 422) under a checkout number `CK-00001`. `POST /checkouts/{id}/pay` confirms all online orders at once. `GET /checkouts/{id}` is guarded like orders.
- **Cash on delivery:** price book `cod { enabled, fee, max_order_value }` plus the seller area's `cod` flag. COD orders go straight to production; the amount is marked collected when the shipment is delivered (or by hand in the operations app).
- **Offers:** coupons gain `public` and `title`; `GET /shop/offers` lists active public ones for the checkout "Available offers" list.
- The single-order `POST /orders` stays for older app versions.

## 4. After the order

- **Cancel:** `POST /me/orders/{id}/cancel { reason }` while unpaid, or paid with no production stage done (refund recorded as demo/manual).
- **Returns:** `POST /me/orders/{id}/returns { reason, details, lines? }` within the return window for the allowed reasons. Operations handles `requested → approved → picked_up → resolved (replacement or refund) | rejected`.
- **Reviews:** `POST /me/orders/{id}/review { rating 1-5, title, body }` once per delivered order; shown on the product (verified purchase) and counted in the seller rating. Operations can hide a review.
- The order view gains `can_cancel`, `can_return`, `return_until`, `review`, `returns`, `seller`, `checkout_id`, `payment_method`.
- **Notifications:** every customer-facing event (placed, confirmed, dispatched with tracking, delivered, cancel and return updates) is written to an outbox for SMS and email (logged until providers are connected) and to `GET /me/notifications` with read flags. The operations app shows the outbox.

## 5. Operations app

Sellers (list, create, edit, coverage editor with a PIN code test, capacity, COD, holidays, active), a seller filter on orders, plan, capacity and shipments, a `seller` role scoped to one seller, products, reviews moderation, returns queue, COD collection, checkout grouping on the order page, and the message outbox.
