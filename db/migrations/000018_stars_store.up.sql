-- Telegram Stars store (T2, ADR-018): digital goods that never touch
-- gameplay (Club Pro, premium themes, tips). Purchases are kept apart from
-- the chip ledger: nothing here references ledger accounts, and no chips
-- move because of a purchase.

-- An invoice the player opened. Its id is the invoice payload Telegram
-- echoes back with the payment.
CREATE TABLE star_orders (
  id               uuid PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users (id),
  telegram_user_id bigint NOT NULL CHECK (telegram_user_id > 0),
  product          text NOT NULL CHECK (product IN ('CLUB_PRO', 'PREMIUM_THEMES', 'TIP_SMALL', 'TIP_MEDIUM', 'TIP_LARGE')),
  club_id          uuid REFERENCES clubs (id),
  stars            bigint NOT NULL CHECK (stars BETWEEN 1 AND 10000),
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT star_orders_club_check CHECK ((product = 'CLUB_PRO') = (club_id IS NOT NULL))
);
CREATE INDEX star_orders_user_idx ON star_orders (user_id, created_at DESC);

-- One row per charge Telegram reported (a Club Pro renewal is a new charge
-- for the same order). The charge id makes repeated deliveries harmless.
CREATE TABLE star_payments (
  id                      uuid PRIMARY KEY,
  order_id                uuid REFERENCES star_orders (id),
  user_id                 uuid REFERENCES users (id),
  telegram_user_id        bigint NOT NULL,
  telegram_charge_id      text NOT NULL CHECK (char_length(telegram_charge_id) BETWEEN 1 AND 256),
  stars                   bigint NOT NULL CHECK (stars > 0),
  recurring               boolean NOT NULL DEFAULT false,
  subscription_expires_at timestamptz,
  paid_at                 timestamptz NOT NULL DEFAULT now(),
  refunded_at             timestamptz,
  refund_reason           text CHECK (char_length(refund_reason) <= 200),
  CONSTRAINT star_payments_charge_key UNIQUE (telegram_charge_id)
);
CREATE INDEX star_payments_paid_idx ON star_payments (paid_at DESC, id DESC);
CREATE INDEX star_payments_user_idx ON star_payments (user_id, paid_at DESC);

-- One-time items a user owns (cosmetics only).
CREATE TABLE user_entitlements (
  user_id     uuid NOT NULL REFERENCES users (id),
  entitlement text NOT NULL CHECK (entitlement IN ('PREMIUM_THEMES')),
  payment_id  uuid NOT NULL REFERENCES star_payments (id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entitlement)
);

-- Club Pro: paid until active_until. Telegram renews it monthly (a new
-- charge) unless the subscriber cancels. subscription_charge_id is the
-- first charge, which identifies the subscription to Telegram.
CREATE TABLE club_subscriptions (
  club_id                uuid PRIMARY KEY REFERENCES clubs (id),
  order_id               uuid NOT NULL REFERENCES star_orders (id),
  subscriber_user_id     uuid NOT NULL REFERENCES users (id),
  subscriber_telegram_id bigint NOT NULL,
  subscription_charge_id text NOT NULL,
  active_until           timestamptz NOT NULL,
  renewing               boolean NOT NULL DEFAULT true,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
