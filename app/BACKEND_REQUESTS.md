# Backend requests from the mobile app

Things the app works around today. None of them block a release.

1. **Machine-readable codes on sign-in errors.** Wrong code, expired code, wrong password, the
   password lockout, too many wrong codes and the resend wait all come back as a plain `detail`
   string (401 or 429). The app tells them apart by matching the English text
   (`src/i18n/index.ts`, `errorMessage`). Please add a `code` to each, for example `otp_wrong`,
   `otp_expired`, `otp_attempts`, `otp_wait`, `login_wrong`, `login_locked` and
   `current_password_wrong`, in the same `{message, code}` shape the AI quota errors already use.
   If the lockout ever moves to 423, the app already handles that too.
2. **Display fields in the saved cart.** `GET /me/cart`, `PUT` and `POST /me/cart/merge` return
   only the order items. A cart saved on another device therefore has no title or picture until
   the next `/shop/cart/quote`. Please add `title` and, for products, `slug` and `image` to each
   returned item.
3. **An explicit default address.** `addresses` is a plain list, and the app treats the first
   one as the default (for Deliver to and checkout). A `default: true` flag, or a
   `default_address_index`, would make "Make default" explicit instead of a reorder.
