# CartCloud — Multi-Vendor Smart Cart Ordering Platform
## Production Architecture Document

**Version:** 1.0
**Stack:** FastAPI (async) · PostgreSQL · Redis · Celery · WebSockets · S3-compatible storage
**Scope:** Multi-vendor SaaS — many independent street-food/cart vendors operate on one platform

---

## 1. System Overview

### 1.1 What this is

A platform where any street-food cart, food truck, or small stall owner can register their business, set up a digital menu, generate a QR code, and start taking orders — without the customer ever creating an account. The customer scans, sees the live menu, orders, pays (cash or online), and watches a live countdown until a phone vibration/alert tells them the order is ready.

Underneath, this is a **multi-tenant marketplace**, not a single restaurant app. Tenant isolation, per-vendor billing, per-vendor analytics, and a platform-level Admin/Super Admin layer are first-class concerns from day one — not retrofitted later.

### 1.2 Core actors

| Role | Who they are | Primary surface |
|---|---|---|
| **Customer** | Anonymous-ish guest identified by phone + name, no signup | Mobile web PWA (scans QR) |
| **Cart Worker** | Staff member at a specific cart (cooks, packs orders) | Kitchen Display System (KDS) — tablet/phone web app |
| **Cart Owner** | Owns/manages one or more carts (vendor) | Owner dashboard (web) |
| **Cart Owner Staff (Manager)** | Owner-delegated role with partial permissions | Owner dashboard (scoped) |
| **Platform Admin** | Anthropic-of-this-platform — full visibility across all tenants | Admin console |
| **Platform Support Agent** | Limited admin — can view/assist but not modify billing/payouts | Admin console (scoped) |

### 1.3 Non-negotiable product constraints (from requirements)

1. **Zero-friction customer identity.** No password, no email, no OAuth. Phone number + name only. Returning customers should be recognized by phone number across sessions and across *every* vendor on the platform (since it's one platform, one customer identity record, many order histories).
2. **QR → menu → order → pay, in under 60 seconds of customer effort.**
3. **Cash AND online payment**, selectable per vendor (a vendor can disable online payment if they don't have a settlement account yet).
4. **Real-time order status with a live countdown**, and a **push notification that can vibrate/alert the phone** even if the browser tab is backgrounded or closed — this is a hard constraint that shapes the whole notification architecture (see Part 4).
5. **Multi-vendor**, each vendor fully isolated from every other vendor's data, menu, staff, and orders, except where the Platform Admin needs cross-tenant visibility.
6. **REST API first**, with real-time as a parallel WebSocket/push layer — not REST polling.
7. **AI features that are genuinely useful**, not decorative (detailed in Part 6): demand forecasting, dynamic prep-time prediction, smart queue sequencing, voice ordering, anomaly/fraud detection, and a vendor-facing AI copilot.

### 1.4 High-level architecture diagram (textual)

```
                         ┌─────────────────────────┐
                         │   Customer PWA (React)   │
                         │ scans QR → /c/{cart_slug}│
                         └────────────┬─────────────┘
                                       │ HTTPS REST + WSS
┌──────────────────────────────────────┼───────────────────────────────────┐
│                              API GATEWAY / NGINX                          │
│                     (TLS term, rate limiting, routing)                    │
└──────────────────────────────────────┼───────────────────────────────────┘
            ┌──────────────────────────┼───────────────────────────────┐
            │                          │                               │
   ┌────────▼────────┐      ┌──────────▼──────────┐         ┌──────────▼─────────┐
   │  FastAPI Core    │      │ FastAPI Realtime     │         │ FastAPI AI/ML       │
   │  (REST, sync     │      │ Gateway (WS, async,  │         │ Inference Service   │
   │  business logic) │      │ pub/sub via Redis)   │         │ (forecasting, NLP,  │
   │                  │      │                      │         │ queue optimizer)    │
   └────────┬─────────┘      └──────────┬───────────┘         └──────────┬─────────┘
            │                           │                                 │
            │            ┌──────────────▼──────────────┐                  │
            └───────────►│   Redis (pub/sub, cache,     │◄─────────────────┘
                         │   rate limit, Celery broker) │
                         └──────────────┬────────────────┘
                                        │
                         ┌──────────────▼────────────────┐
                         │   PostgreSQL (primary store,    │
                         │   row-level tenant isolation,    │
                         │   read replica for analytics)    │
                         └──────────────┬────────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              │                         │                         │
     ┌────────▼────────┐      ┌─────────▼─────────┐     ┌─────────▼─────────┐
     │ Celery Workers    │      │ S3-compatible      │     │ External Services  │
     │ (async jobs:      │      │ Object Storage     │     │ - bKash/Nagad/      │
     │ notifications,    │      │ (menu images, logos,│     │   SSLCommerz/Stripe │
     │ payouts, reports, │      │ receipts)           │     │ - FCM/APNs (push)   │
     │ AI batch jobs)     │      │                     │     │ - SMS gateway (OTP) │
     └───────────────────┘      └─────────────────────┘     └─────────────────────┘
```

### 1.5 Why FastAPI-only (per decision)

- Native `async/await` end to end — important because this system is dominated by I/O-bound work: DB queries, Redis pub/sub, push notification dispatch, and external payment gateway calls. A sync framework would burn threads waiting on bKash's API.
- WebSocket support is first-class (`fastapi.WebSocket`), so the real-time gateway lives in the *same* ecosystem as REST instead of bolting on Django Channels.
- Pydantic v2 gives us strict request/response validation and doubles as our serialization layer for both REST and WS messages — one schema definition, two transports.
- We lose Django's admin-for-free, so **we build a proper internal Admin Console as its own first-class product surface** (Part 7), not an afterthought — this is actually a feature here, not a gap, because platform admins need tenant-aware views Django admin doesn't give you anyway.

We use **three logical FastAPI services** sharing one codebase (monorepo, separate deployable entrypoints), not one monolith process:

1. **Core API** — all REST CRUD, auth, orders, menu, payments, admin.
2. **Realtime Gateway** — WebSocket connections only, stateless, horizontally scalable, talks to everything else only via Redis pub/sub and the DB.
3. **AI Inference Service** — forecasting, NLP (voice/chat ordering), anomaly detection. Isolated so a heavy model load or a Python ML dependency conflict never risks the order-taking path. Communicates via internal REST + a job queue.

This separation matters in production: if the AI service crashes or is mid-deploy, customers must still be able to order food. If the Realtime Gateway is overwhelmed by reconnect storms, REST ordering must still work via fallback polling.

---

## 2. Multi-Tenancy Model

### 2.1 Tenancy strategy: shared database, shared schema, row-level isolation

Given this is a marketplace with potentially thousands of small vendors (each with low individual data volume), **schema-per-tenant or database-per-tenant is the wrong choice** — it doesn't scale operationally (migrations across 5,000 schemas) and is overkill for the data volume per vendor. Instead:

- **One shared PostgreSQL database**, shared schema.
- Every tenant-scoped table carries a `vendor_id` (FK to `vendors.id`).
- **Postgres Row-Level Security (RLS)** is enabled on all tenant-scoped tables as a defense-in-depth layer — even if application code has a bug and forgets a `WHERE vendor_id = ...` filter, the database itself refuses to return cross-tenant rows.
- The API sets a session-local Postgres variable (`SET app.current_vendor_id = '...'`) per request via a dependency, and RLS policies key off that variable.
- Platform Admins bypass RLS via a dedicated Postgres role (`platform_admin_role`) that has `BYPASSRLS`, used only by admin-console-specific endpoints — never by the general request path.

This gives us SaaS-grade isolation with operational simplicity of a single database, single migration path, single connection pool.

### 2.2 Tenant hierarchy

```
Platform
 └── Vendor (a registered business — e.g. "Rafiq's Fuchka Cart")
      └── Cart (a physical stall/location — a vendor can have 1..N carts)
           └── Menu (versioned, belongs to a Cart)
                └── MenuCategory
                     └── MenuItem
           └── Staff assignments (Cart Workers assigned to this specific cart)
           └── Orders (always scoped to one Cart)
```

A **Vendor** is the billing entity and the owner account. A **Cart** is the operational unit customers actually scan and order from — this split matters because a vendor like a small chain ("Rafiq's Fuchka") might run 3 physical cart locations under one business account, each with its own QR code, its own menu (or shared menu with location-specific availability), and its own staff.

### 2.3 Cart-level QR identity

Each Cart has:
- `public_slug` — short, human-shareable, URL-safe (e.g. `rafiqs-dhanmondi-7`)
- `qr_token` — a separate, rotatable opaque token embedded in the actual QR code payload (not just the slug), so a vendor can invalidate/regenerate a printed QR (e.g. if a competitor cart copies it) without changing their friendly URL.

QR payload resolves to: `https://CartCloud.app/c/{public_slug}?t={qr_token}`

The `qr_token` is checked server-side on the menu-fetch endpoint; mismatch → 403 with a "this QR code may be outdated, ask the vendor for a fresh one" message, not a generic error. This is also our first anti-fraud control (Part 6.5) — it stops someone photographing and reprinting a competitor's QR sticker to redirect orders/payouts to themselves.

---

## 3. Identity & Access Model

### 3.1 Customer identity — phone + name, no password

This is the most important UX decision in the whole system, so it gets its own careful treatment.

**Flow:**
1. Customer scans QR → lands on cart menu page. **No login wall.** They can browse the entire menu, see prices, see photos, with zero identity provided.
2. Only at checkout (placing the actual order) are phone number and name required.
3. On submitting phone + name:
   - Backend checks if a `Customer` record with that phone number already exists (phone number is the durable, platform-wide identity key — **not vendor-scoped**, because the same person orders from many carts).
   - If new: create `Customer` record, send an **OTP via SMS** (see 3.1.1 for why OTP, despite "no account" framing).
   - If existing and the device has a valid long-lived session token already (see 3.1.2), skip OTP entirely — frictionless repeat ordering.
   - If existing but new device/no valid session: OTP required (prevents anyone typing in a stranger's phone number and ordering against their saved payment/order history).
4. On OTP verify (or skip), backend issues a **guest session JWT**, scoped to that `Customer`, long-lived (30 days, refreshable), stored in browser as an HttpOnly cookie *and* returned in body for PWA local-storage fallback (Safari iOS PWA cookie quirks).

**3.1.1 — Why OTP at all, if the spec says "no account needed"?**

"No account" in the product sense means: no password to remember, no signup form, no email verification, no app install. It does **not** mean "no verification ever," because:
- Online payment requires knowing the payer is who they claim to be (basic fraud control).
- The "ready" notification and order history need a trustworthy identity, or anyone could order food under a rival vendor's regular customer's number and cause real-world confusion/harassment.
- We mitigate the friction: **OTP is only sent once per device-pair (phone+device fingerprint) within a rolling 30-day window.** A returning customer on the same phone, same browser, ordering from a *different* cart across town, does not see an OTP screen again. This satisfies "no account needed" from the customer's lived experience while keeping a verification floor.

**3.1.2 — Device/session persistence**

- `CustomerSession` table: `id, customer_id, device_fingerprint_hash, refresh_token_hash, created_at, last_used_at, expires_at, revoked_at`.
- Device fingerprint = a non-invasive hash (no canvas/audio fingerprinting — privacy-respecting) built from: browser UA family + a randomly generated, locally-stored `device_id` (UUID set in localStorage on first visit, regenerated if cleared — acceptable, since worst case is one extra OTP).
- Session JWT: short-lived **access token** (15 min, used per-request) + long-lived **refresh token** (30 days, rotated on use, stored hashed in DB so a DB leak doesn't equal session takeover).

**3.1.3 — What if the customer's number is already linked to a different name?**
People share phones (couples, family). We do **not** hard-fail this. If phone exists but submitted name differs from the stored name, we:
- Keep the canonical `Customer.phone` record as the identity anchor.
- Store the name as an `order.guest_display_name` override on that specific order (so the kitchen ticket and "Order ready" message show the name the *orderer* typed, not a stale stored name), while all loyalty/order-history/AI personalization still keys off the phone-linked `Customer.id`.

### 3.2 Staff & Owner identity — real accounts, real auth

Unlike customers, **Cart Owners, Managers, Cart Workers, and Platform Admins have real authenticated accounts** — phone or email + password, with mandatory 2FA (TOTP) for Owners and all Admin roles, since these accounts control payouts and tenant data.

- Standard **OAuth2 password grant + JWT** (access + refresh), via FastAPI's `OAuth2PasswordBearer`, backed by `passlib[bcrypt]` for hashing.
- Cart Workers can *optionally* be onboarded via a lighter **PIN + cart-device pairing** model instead of full password auth, because kitchen staff turnover is high and typing passwords on a greasy tablet is bad UX:
  - Owner generates a 6-digit PIN per worker from the dashboard.
  - Worker enters PIN once on the KDS tablet; tablet itself becomes a "paired device" (`KdsDevice` record bound to that Cart) and stays logged in until the owner unpairs it.
  - This means **the auth boundary for a Cart Worker is effectively "physical access to the paired tablet,"** which matches the real-world trust model of a small food cart — explicitly documented here as an accepted, deliberate tradeoff, not an oversight.

### 3.3 Role & Permission matrix (RBAC)

We implement RBAC with explicit permission strings, not just role names, so future roles (e.g. "Accountant," "Marketing Manager") can be composed from existing permissions without new code paths.

| Permission | Customer | Cart Worker | Manager | Cart Owner | Support Agent | Platform Admin |
|---|---|---|---|---|---|---|
| `menu:view` | ✅ (public) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `order:create` | ✅ (own) | ❌ | ❌ | ❌ | ❌ | ❌ |
| `order:view_own` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `order:view_cart_queue` | ❌ | ✅ (assigned cart) | ✅ (owned carts) | ✅ (own carts) | ✅ (read-only) | ✅ |
| `order:update_status` | ❌ | ✅ (assigned cart) | ✅ | ✅ | ❌ | ✅ |
| `menu:edit` | ❌ | ❌ | ✅ (if granted) | ✅ | ❌ | ✅ |
| `staff:manage` | ❌ | ❌ | ✅ (if granted) | ✅ | ❌ | ✅ |
| `payout:view` | ❌ | ❌ | ❌ | ✅ | ✅ (read-only) | ✅ |
| `payout:initiate` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ (override) |
| `vendor:suspend` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `analytics:cross_tenant` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `ai:configure` | ❌ | ❌ | ❌ | ✅ (own cart) | ❌ | ✅ |

Implementation: a `Role` table with a `permissions: JSONB` array column, a `UserRoleAssignment` join table scoping a role to a specific `vendor_id`/`cart_id` (so the *same person* could be a Manager at Cart A and just a Worker at Cart B), and a FastAPI dependency `require_permission("order:update_status")` that resolves current user → roles → permissions → checks scope match against the path's `cart_id`.

---


# Part 2: Data Model & Database Schema

All tables use `UUID` primary keys (`uuid4`, generated app-side via Pydantic/Python, not DB-side — keeps ID generation portable and avoids round-tripping for the ID before insert). Timestamps are `TIMESTAMPTZ`, always UTC, converted to vendor's local timezone (`Asia/Dhaka` by default, but stored per-vendor for future expansion) at the presentation layer only.

## 2.1 Identity & Tenancy Tables

```sql
-- Platform-wide customer identity (NOT vendor-scoped)
CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number    VARCHAR(20) UNIQUE NOT NULL,   -- E.164 format, e.g. +8801xxxxxxxxx
    display_name    VARCHAR(100) NOT NULL,
    phone_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    preferred_language VARCHAR(8) DEFAULT 'bn',     -- 'bn' | 'en' — drives SMS/UI language
    marketing_opt_in BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_blocked      BOOLEAN NOT NULL DEFAULT FALSE,  -- platform-level block (fraud/abuse)
    blocked_reason  TEXT,
    risk_score      SMALLINT NOT NULL DEFAULT 0       -- updated by AI fraud model, 0-100
);
CREATE INDEX idx_customers_phone ON customers(phone_number);

CREATE TABLE customer_sessions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id             UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    device_fingerprint_hash VARCHAR(128) NOT NULL,
    refresh_token_hash      VARCHAR(256) NOT NULL,
    push_subscription_id    UUID REFERENCES push_subscriptions(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at              TIMESTAMPTZ NOT NULL,
    revoked_at              TIMESTAMPTZ
);
CREATE INDEX idx_sessions_customer ON customer_sessions(customer_id);
CREATE INDEX idx_sessions_refresh_hash ON customer_sessions(refresh_token_hash);

-- Vendors = billing/business entity
CREATE TABLE vendors (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name       VARCHAR(150) NOT NULL,
    owner_user_id       UUID NOT NULL REFERENCES staff_users(id),
    registration_status VARCHAR(20) NOT NULL DEFAULT 'pending',
                        -- pending | verified | suspended | terminated
    kyc_document_url    TEXT,            -- trade license / NID upload for verification
    tax_id              VARCHAR(50),
    settlement_account_json JSONB,       -- encrypted bKash/Nagad/bank details for payouts
    platform_commission_pct NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    default_timezone   VARCHAR(50) NOT NULL DEFAULT 'Asia/Dhaka',
    default_currency   VARCHAR(8) NOT NULL DEFAULT 'BDT',
    subscription_tier  VARCHAR(20) NOT NULL DEFAULT 'free',
                        -- free | growth | pro  (SaaS pricing tier — gates AI features, cart count)
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    suspended_at        TIMESTAMPTZ,
    suspension_reason   TEXT
);

-- Carts = physical, scannable, orderable location
CREATE TABLE carts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id       UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    public_slug     VARCHAR(80) UNIQUE NOT NULL,
    qr_token        VARCHAR(64) NOT NULL,         -- rotatable, regenerated on demand
    qr_token_version SMALLINT NOT NULL DEFAULT 1,
    location_lat    NUMERIC(9,6),
    location_lng    NUMERIC(9,6),
    address_text    VARCHAR(255),
    is_open          BOOLEAN NOT NULL DEFAULT FALSE,   -- manual toggle by owner/worker
    is_accepting_online_orders BOOLEAN NOT NULL DEFAULT TRUE,
    accepts_cash     BOOLEAN NOT NULL DEFAULT TRUE,
    accepts_online_payment BOOLEAN NOT NULL DEFAULT FALSE,
    avg_prep_time_seconds INTEGER NOT NULL DEFAULT 600,  -- seed value; AI model overrides per-item
    max_concurrent_orders SMALLINT NOT NULL DEFAULT 10,  -- throttle — see 4.5 backpressure
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_carts_vendor ON carts(vendor_id);
CREATE UNIQUE INDEX idx_carts_slug ON carts(public_slug);

-- Row Level Security example (applied to every tenant-scoped table)
ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_carts ON carts
    USING (vendor_id = current_setting('app.current_vendor_id')::UUID);
```

## 2.2 Staff & RBAC Tables

```sql
CREATE TABLE staff_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number    VARCHAR(20) UNIQUE,
    email           VARCHAR(255) UNIQUE,
    password_hash   VARCHAR(255),             -- null for PIN-only KDS workers
    full_name       VARCHAR(150) NOT NULL,
    is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
    is_support_agent  BOOLEAN NOT NULL DEFAULT FALSE,
    totp_secret_encrypted VARCHAR(255),       -- 2FA, mandatory for owners/admins
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(50) NOT NULL,         -- 'cart_owner' | 'manager' | 'cart_worker' | custom
    permissions JSONB NOT NULL DEFAULT '[]',  -- ["order:update_status", "menu:edit", ...]
    is_system_role BOOLEAN NOT NULL DEFAULT TRUE,
    vendor_id   UUID REFERENCES vendors(id)    -- null = system-defined role; set = vendor's custom role
);

CREATE TABLE user_role_assignments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
    role_id     UUID NOT NULL REFERENCES roles(id),
    vendor_id   UUID REFERENCES vendors(id),    -- scope: this assignment applies within this vendor
    cart_id     UUID REFERENCES carts(id),      -- optional finer scope: only this cart
    granted_by  UUID REFERENCES staff_users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, role_id, vendor_id, cart_id)
);

CREATE TABLE kds_devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id         UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    worker_user_id  UUID REFERENCES staff_users(id),
    device_label    VARCHAR(80),               -- "Kitchen Tablet 1"
    pin_hash        VARCHAR(255) NOT NULL,
    paired_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ,
    unpaired_at     TIMESTAMPTZ
);
```

## 2.3 Menu Tables

```sql
CREATE TABLE menus (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id     UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL DEFAULT 1,     -- versioned: editing publishes a new version
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE menu_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_id     UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,         -- "Fuchka", "Drinks", "Combos"
    sort_order  SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE menu_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id         UUID NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
    cart_id             UUID NOT NULL REFERENCES carts(id),   -- denormalized for fast RLS + queries
    name                VARCHAR(150) NOT NULL,
    name_bn             VARCHAR(150),          -- Bengali name for local-language UI
    description         TEXT,
    price               NUMERIC(10,2) NOT NULL,
    image_url           TEXT,
    is_available        BOOLEAN NOT NULL DEFAULT TRUE,   -- manual "sold out" toggle
    avg_prep_time_seconds INTEGER,              -- per-item override; null = use cart default
    dietary_tags        JSONB DEFAULT '[]',     -- ["vegetarian","spicy","contains_nuts"]
    sort_order          SMALLINT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_menu_items_cart ON menu_items(cart_id);

CREATE TABLE menu_item_options (
    -- e.g. "Spice level" with choices Mild/Medium/Hot, or "Add egg" +10 BDT
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    option_group_name VARCHAR(100) NOT NULL,   -- "Spice Level"
    is_required        BOOLEAN NOT NULL DEFAULT FALSE,
    allows_multiple     BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order          SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE menu_item_option_choices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    option_id       UUID NOT NULL REFERENCES menu_item_options(id) ON DELETE CASCADE,
    label           VARCHAR(100) NOT NULL,      -- "Hot"
    price_delta     NUMERIC(10,2) NOT NULL DEFAULT 0,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE
);
```

## 2.4 Order Tables — the core of the system

```sql
CREATE TYPE order_status AS ENUM (
    'pending_payment',   -- online payment chosen, awaiting gateway confirmation
    'placed',            -- confirmed (cash, or online payment succeeded)
    'accepted',          -- cart worker/owner acknowledged the order
    'preparing',
    'ready',             -- THIS triggers the phone alert
    'completed',         -- customer picked it up
    'cancelled_by_customer',
    'cancelled_by_vendor',
    'payment_failed'
);

CREATE TABLE orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number        VARCHAR(20) NOT NULL,    -- human-friendly, e.g. "A-042", scoped per cart per day
    cart_id             UUID NOT NULL REFERENCES carts(id),
    vendor_id           UUID NOT NULL REFERENCES vendors(id),  -- denormalized for RLS speed
    customer_id         UUID NOT NULL REFERENCES customers(id),
    guest_display_name  VARCHAR(100) NOT NULL,    -- name as typed THIS order (see 3.1.3)
    status              order_status NOT NULL DEFAULT 'placed',
    payment_method      VARCHAR(20) NOT NULL,     -- 'cash' | 'bkash' | 'nagad' | 'sslcommerz' | 'stripe'
    subtotal            NUMERIC(10,2) NOT NULL,
    platform_fee        NUMERIC(10,2) NOT NULL DEFAULT 0,
    total               NUMERIC(10,2) NOT NULL,
    currency             VARCHAR(8) NOT NULL DEFAULT 'BDT',
    special_instructions TEXT,
    estimated_ready_at   TIMESTAMPTZ,              -- AI-predicted; drives the countdown
    estimated_ready_at_initial TIMESTAMPTZ,         -- snapshot of FIRST estimate, for accuracy tracking
    accepted_at          TIMESTAMPTZ,
    ready_at             TIMESTAMPTZ,
    completed_at         TIMESTAMPTZ,
    cancelled_at         TIMESTAMPTZ,
    cancellation_reason  TEXT,
    queue_position       SMALLINT,                 -- updated live by queue engine
    placed_via            VARCHAR(20) NOT NULL DEFAULT 'qr_web',  -- 'qr_web' | 'voice_ai' | 'reorder'
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_cart_status ON orders(cart_id, status);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE UNIQUE INDEX idx_orders_cart_daily_number ON orders(cart_id, order_number, (created_at::date));

CREATE TABLE order_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id    UUID NOT NULL REFERENCES menu_items(id),
    item_name_snapshot VARCHAR(150) NOT NULL,    -- denormalized: menu may change after order
    unit_price_snapshot NUMERIC(10,2) NOT NULL,
    quantity        SMALLINT NOT NULL DEFAULT 1,
    selected_options JSONB DEFAULT '[]',          -- snapshot of chosen option choices + price deltas
    line_total      NUMERIC(10,2) NOT NULL
);

CREATE TABLE order_status_events (
    -- full audit trail — every status transition, who triggered it, when
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    from_status order_status,
    to_status   order_status NOT NULL,
    triggered_by_user_id UUID REFERENCES staff_users(id),  -- null if system/AI triggered
    triggered_by_system  VARCHAR(50),                       -- 'queue_engine' | 'payment_webhook' | etc
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 2.5 Payment Tables

```sql
CREATE TABLE payment_transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            UUID NOT NULL REFERENCES orders(id),
    gateway              VARCHAR(20) NOT NULL,     -- 'bkash'|'nagad'|'sslcommerz'|'stripe'|'cash'
    gateway_transaction_id VARCHAR(120),
    amount               NUMERIC(10,2) NOT NULL,
    currency              VARCHAR(8) NOT NULL,
    status                VARCHAR(20) NOT NULL,     -- 'initiated'|'success'|'failed'|'refunded'
    raw_gateway_payload   JSONB,                    -- full webhook/callback body, for disputes
    initiated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at          TIMESTAMPTZ
);
CREATE INDEX idx_payment_order ON payment_transactions(order_id);

CREATE TABLE vendor_payouts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id       UUID NOT NULL REFERENCES vendors(id),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    gross_amount    NUMERIC(12,2) NOT NULL,
    platform_commission NUMERIC(12,2) NOT NULL,
    net_payout      NUMERIC(12,2) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending|processing|paid|failed
    payout_method   VARCHAR(30),
    payout_reference VARCHAR(120),
    processed_by    UUID REFERENCES staff_users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at         TIMESTAMPTZ
);
```

## 2.6 Notification / Push Tables

```sql
CREATE TABLE push_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID REFERENCES customers(id),
    endpoint_type   VARCHAR(20) NOT NULL,    -- 'web_push'|'fcm'|'apns'
    subscription_payload JSONB NOT NULL,      -- Web Push subscription object or FCM token
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_success_at   TIMESTAMPTZ
);

CREATE TABLE notification_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID REFERENCES orders(id),
    customer_id     UUID REFERENCES customers(id),
    channel         VARCHAR(20) NOT NULL,    -- 'push'|'sms'|'websocket'
    event_type      VARCHAR(40) NOT NULL,    -- 'order_ready'|'order_accepted'|'eta_changed'
    payload          JSONB,
    delivery_status  VARCHAR(20) NOT NULL DEFAULT 'sent',  -- sent|delivered|failed
    sent_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 2.7 AI-Supporting Tables

```sql
-- Historical observations the forecasting/prep-time models train on
CREATE TABLE order_fulfillment_metrics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id),
    cart_id         UUID NOT NULL REFERENCES carts(id),
    item_count      SMALLINT NOT NULL,
    predicted_prep_seconds INTEGER NOT NULL,
    actual_prep_seconds    INTEGER,             -- accepted_at -> ready_at, filled when ready
    queue_depth_at_placement SMALLINT,           -- how many orders were ahead
    hour_of_day      SMALLINT,
    day_of_week       SMALLINT,
    weather_condition  VARCHAR(30),               -- enriched async from weather API
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE demand_forecasts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id         UUID NOT NULL REFERENCES carts(id),
    forecast_for_date DATE NOT NULL,
    forecast_for_hour SMALLINT NOT NULL,
    predicted_order_count NUMERIC(6,2) NOT NULL,
    predicted_top_items   JSONB,                 -- [{item_id, predicted_qty}, ...]
    model_version          VARCHAR(20) NOT NULL,
    generated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fraud_risk_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID REFERENCES customers(id),
    order_id        UUID REFERENCES orders(id),
    risk_type        VARCHAR(40) NOT NULL,   -- 'rapid_cancel'|'card_testing'|'velocity'|'fake_gps'
    risk_score        SMALLINT NOT NULL,
    model_version      VARCHAR(20),
    action_taken        VARCHAR(40),          -- 'flagged'|'blocked'|'manual_review'
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_conversation_logs (
    -- for the voice/chat ordering assistant — see Part 6.4
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID REFERENCES customers(id),
    cart_id         UUID REFERENCES carts(id),
    session_id       UUID NOT NULL,
    turn_index        SMALLINT NOT NULL,
    role               VARCHAR(10) NOT NULL,  -- 'user'|'assistant'
    content_text       TEXT,
    resolved_order_id   UUID REFERENCES orders(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 2.8 Entity Relationship Summary (textual ERD)

```
customers ──1:N── customer_sessions
customers ──1:N── orders
customers ──1:N── push_subscriptions

vendors ──1:N── carts
vendors ──1:N── vendor_payouts
vendors ──1:1── staff_users (owner_user_id)

carts ──1:N── menus ──1:N── menu_categories ──1:N── menu_items ──1:N── menu_item_options ──1:N── menu_item_option_choices
carts ──1:N── orders
carts ──1:N── kds_devices
carts ──1:N── demand_forecasts

orders ──1:N── order_items
orders ──1:N── order_status_events
orders ──1:N── payment_transactions
orders ──1:1── order_fulfillment_metrics
orders ──1:N── notification_log

staff_users ──1:N── user_role_assignments ──N:1── roles
```

## 2.9 Indexing & performance notes

- `orders(cart_id, status)` composite index is the single most important index in the system — the KDS queue view and the queue-position calculation hit this on every poll/update.
- `payment_transactions.raw_gateway_payload` is `JSONB` and deliberately **never** queried by content in hot paths — it exists purely as an immutable audit/dispute record. A GIN index is added only if support tooling needs to search it later.
- Partition `order_status_events` and `notification_log` by month (Postgres native partitioning) once volume grows — both are append-only audit tables that will dominate row count over time but are rarely queried for anything except a specific `order_id`.
- `customers.phone_number` index must be the fastest lookup path in the entire schema — it's hit on every single checkout across every vendor on the platform.

---


# Part 3: REST API Design

**Base URL:** `https://api.CartCloud.app/v1`
**Format:** JSON, `Content-Type: application/json`
**Auth:** `Authorization: Bearer <jwt>` for staff/admin; customer guest JWT sent the same way (issued at OTP-verify step) plus a `X-Device-Id` header.
**Versioning:** URL-path versioned (`/v1`, `/v2`...) — explicit and visible in logs/monitoring, easier to reason about than header-based versioning at this team size.

All list endpoints are paginated with `?page=1&page_size=20` (cursor pagination for high-volume tables like `order_status_events`, offset pagination elsewhere). All endpoints return a consistent envelope:

```json
{
  "data": { ... } | [ ... ],
  "meta": { "page": 1, "page_size": 20, "total": 134 },
  "error": null
}
```

Errors:
```json
{
  "data": null,
  "meta": null,
  "error": { "code": "ORDER_NOT_FOUND", "message": "...", "field_errors": {} }
}
```

## 3.1 Public / Customer-facing endpoints (no staff auth)

```
POST   /v1/customers/identify
       body: { phone_number, display_name, device_id }
       → if known device+phone combo: returns session tokens directly
       → else: triggers OTP, returns { otp_required: true, otp_session_id }

POST   /v1/customers/verify-otp
       body: { otp_session_id, otp_code }
       → { access_token, refresh_token, customer: {...} }

POST   /v1/auth/refresh
       body: { refresh_token }
       → { access_token, refresh_token }   (rotated)

GET    /v1/carts/{public_slug}?t={qr_token}
       → public cart info: name, is_open, accepts_cash, accepts_online_payment, location

GET    /v1/carts/{public_slug}/menu?t={qr_token}
       → full active menu tree: categories → items → options
       → includes `estimated_wait_seconds` (current AI-predicted wait for a NEW order placed now)

POST   /v1/carts/{public_slug}/orders          [customer auth required]
       body: {
         items: [{ menu_item_id, quantity, selected_option_choice_ids: [...] }],
         payment_method: "cash" | "bkash" | "nagad" | "sslcommerz" | "stripe",
         special_instructions: "no chili please"
       }
       → creates order in `pending_payment` (if online) or `placed` (if cash)
       → returns order with `estimated_ready_at`, `payment.redirect_url` (if online)

GET    /v1/orders/{order_id}                    [customer auth required, own order only]
       → live order detail including current status, queue_position, estimated_ready_at

GET    /v1/orders/me                             [customer auth required]
       → paginated order history across ALL vendors (this customer's full history)
       → powers AI "reorder" suggestions

POST   /v1/orders/{order_id}/cancel              [customer auth required]
       body: { reason }
       → only allowed while status in {placed, accepted} and within vendor's cancel-window config

POST   /v1/push-subscriptions                    [customer auth required]
       body: { endpoint_type, subscription_payload }
       → registers Web Push / FCM token for "order ready" alerts

POST   /v1/payments/{order_id}/webhook/{gateway}  [gateway signature verified, no user auth]
       → bKash/Nagad/SSLCommerz/Stripe callback handler — see Part 5
```

## 3.2 Cart Worker / KDS endpoints

```
POST   /v1/kds/pair
       body: { cart_id, pin }
       → { device_token }  (long-lived, bound to this physical device)

GET    /v1/kds/queue                              [device_token or worker JWT]
       → live queue for this worker's cart: orders in {placed, accepted, preparing}, sorted by
         AI-optimized sequence (see Part 6.3), each with countdown remaining

PATCH  /v1/kds/orders/{order_id}/status
       body: { status: "accepted" | "preparing" | "ready" | "completed" }
       → validates legal transition, writes order_status_events, fires WS broadcast + push notification
         if transitioning into "ready"

PATCH  /v1/kds/menu-items/{item_id}/availability
       body: { is_available: false }
       → instant 86 (sold-out) toggle, broadcast to all active menu viewers via WS
```

## 3.3 Cart Owner / Manager dashboard endpoints

```
POST   /v1/auth/login                              body: { phone_or_email, password, totp_code }
POST   /v1/auth/logout
GET    /v1/vendors/me
PATCH  /v1/vendors/me                               body: { business_name, settlement_account_json, ... }

POST   /v1/vendors/me/carts
GET    /v1/vendors/me/carts
GET    /v1/carts/{cart_id}
PATCH  /v1/carts/{cart_id}                          body: { is_open, accepts_cash, max_concurrent_orders, ... }
POST   /v1/carts/{cart_id}/qr/regenerate            → rotates qr_token, invalidates old printed QR

GET    /v1/carts/{cart_id}/menus/active
POST   /v1/carts/{cart_id}/menus                    → creates new menu version (draft)
POST   /v1/menus/{menu_id}/publish                  → activates this version, deactivates previous
POST   /v1/menus/{menu_id}/categories
POST   /v1/menu-categories/{category_id}/items
PATCH  /v1/menu-items/{item_id}
DELETE /v1/menu-items/{item_id}

GET    /v1/carts/{cart_id}/orders?status=&date_from=&date_to=
GET    /v1/carts/{cart_id}/analytics/summary        → revenue, order count, avg prep time, top items
GET    /v1/carts/{cart_id}/analytics/ai-insights     → see Part 6.6 (AI copilot digest)

POST   /v1/vendors/me/staff/invite                   body: { phone_number, role, cart_id }
GET    /v1/vendors/me/staff
PATCH  /v1/staff-assignments/{assignment_id}
DELETE /v1/staff-assignments/{assignment_id}

GET    /v1/vendors/me/payouts
GET    /v1/payouts/{payout_id}
```

## 3.4 Platform Admin endpoints

```
GET    /v1/admin/vendors?status=&search=
GET    /v1/admin/vendors/{vendor_id}                  → full cross-tenant detail (bypasses RLS via admin role)
PATCH  /v1/admin/vendors/{vendor_id}/suspend           body: { reason }
PATCH  /v1/admin/vendors/{vendor_id}/reinstate
PATCH  /v1/admin/vendors/{vendor_id}/verify-kyc

GET    /v1/admin/orders?cart_id=&vendor_id=&date_from=&date_to=  → platform-wide order search
GET    /v1/admin/fraud-events?min_risk_score=&status=
PATCH  /v1/admin/fraud-events/{event_id}/resolve

GET    /v1/admin/analytics/platform-summary          → GMV, active vendors, active carts, order volume trend
GET    /v1/admin/analytics/vendor-health             → churn-risk scoring per vendor (AI-assisted, Part 6.6)

POST   /v1/admin/payouts/batch-process
PATCH  /v1/admin/payouts/{payout_id}/override-status

GET    /v1/admin/support/customers/{customer_id}      → support agent view: order history, sessions, risk score
POST   /v1/admin/support/customers/{customer_id}/unblock
```

## 3.5 AI-specific endpoints (proxied through Core API to the AI Inference Service)

```
POST   /v1/ai/voice-order/session                     [customer auth]
       → opens a session_id for the conversational ordering flow (Part 6.4)

POST   /v1/ai/voice-order/session/{session_id}/turn
       body: { audio_base64 } or { text }
       → { assistant_text, assistant_audio_url?, draft_order: {...}, requires_confirmation: bool }

POST   /v1/ai/voice-order/session/{session_id}/confirm
       → converts draft_order into a real order via the standard order-creation path (re-uses 3.1 logic,
         never bypasses payment/validation rules just because AI assembled it)

GET    /v1/carts/{cart_id}/ai/demand-forecast?date=
GET    /v1/carts/{cart_id}/ai/queue-recommendation     → internal, used by KDS sequencing (Part 6.3)
GET    /v1/carts/{cart_id}/ai/copilot-digest           → owner-facing plain-language daily insight (Part 6.6)
```

## 3.6 API design conventions

- **Idempotency.** `POST /orders` requires an `Idempotency-Key` header. We store a short-lived (10 min) Redis key mapping idempotency key → created `order_id`, so a flaky mobile connection retrying a checkout POST never double-charges or double-creates an order. This is essential at cart-side network quality (BD street connectivity is not always great).
- **Optimistic concurrency on menu edits.** `PATCH /menu-items/{id}` accepts an `If-Match` header with the item's current `updated_at`; mismatch → `409 Conflict`, preventing a manager's edit from silently clobbering a concurrent edit by another manager.
- **Field-level validation errors** always return which field failed (`field_errors: { "quantity": "must be >= 1" }`), since the customer-facing client is a guest flow with no account-recovery safety net — errors must be self-explanatory.
- **Soft deletes everywhere tenant data is concerned.** Menu items, categories, and carts are never hard-deleted (`deleted_at` column), because historical orders reference them and because vendor offboarding/disputes need the trail.
- **Rate limiting** (enforced at the Nginx/gateway layer + a Redis token-bucket in-app as backup):
  - `POST /customers/identify`: 5/min per IP, 3/min per phone number (OTP abuse prevention)
  - `POST /carts/{slug}/orders`: 10/min per customer (prevents order-spam/DoS on a single cart)
  - Admin endpoints: generous (100/min), staff endpoints: moderate (60/min)

## 3.7 OpenAPI / documentation

FastAPI generates the OpenAPI 3.1 schema automatically from Pydantic models and route definitions — this is one of the concrete production benefits of the FastAPI-only decision. We additionally:
- Tag every route by domain (`customers`, `orders`, `kds`, `admin`, `ai`) so `/docs` (Swagger UI) and `/redoc` are navigable per-role.
- Generate a typed TypeScript client from the OpenAPI schema (`openapi-typescript-codegen`) for the React frontend, run in CI on every merge to `main` so frontend and backend contracts never silently drift.

---


# Part 4: Real-Time Architecture & the "Order Ready" Alert

This is the part of the spec that most naive implementations get wrong, so it's worth being explicit about *why* the design looks like this.

## 4.1 The core problem

The requirement is: "live countdown timer, and when ready, the cart sends a ready message and **the user's phone beeps/alerts** — even though the user never installed an app and never created an account."

A plain WebSocket connection **cannot** do this reliably, because:
- Mobile browsers suspend/throttle JS execution and close WS connections when a tab is backgrounded or the screen locks — which is exactly when a customer waiting for fuchka has put their phone in their pocket.
- There is no "ringtone" capability for a backgrounded browser tab via WebSocket alone.

So we need **two parallel, complementary real-time channels**, not one:

| Channel | Purpose | Works when tab backgrounded/closed? |
|---|---|---|
| **WebSocket** | Live countdown updates, queue position changes, instant UI refresh while customer is actively looking at the order page | ❌ No |
| **Web Push (Push API + Service Worker)** | The actual "order ready" alert — vibration, sound, system notification | ✅ Yes |
| **SMS (fallback)** | Last-resort delivery if push subscription fails/unsupported (older phones, push permission denied) | ✅ Yes (always) |

The countdown *feels* live via WebSocket while the customer is watching; the **critical "it's ready" moment is delivered via Web Push**, which is what actually triggers a vibration/sound/banner notification on the lock screen, browser closed or not — because the Service Worker that receives the push event runs independently of the page being open.

## 4.2 Why this doesn't require "installing an app"

This is the detail that makes "no app install, no account" actually compatible with "phone beeps":

- The customer-facing surface is a **PWA (Progressive Web App)**: a normal website with a `manifest.json` and a registered **Service Worker**.
- On first visit (or right after placing the first order), the browser prompts: *"CartCloud.app wants to send you notifications"* — a single native browser permission prompt, not an app install. iOS Safari (16.4+) and all modern Android browsers support Web Push without any app store interaction.
- If the customer grants it once, **every future order from any vendor on the platform** can alert them — because the push subscription is tied to the browser/device, and we store it against their `Customer` record (platform-wide identity), not per-vendor.
- If they decline the permission (or are on an unsupported browser), we transparently fall back to SMS for the "ready" event only (not for routine updates, to control SMS cost) — so the feature **always works**, just with push as the best-effort fast path and SMS as the guaranteed path.

## 4.3 Sequence: order placed → ready → alert delivered

```
1. Customer places order (REST POST /carts/{slug}/orders)
2. Core API:
   a. Writes order (status=placed), order_items
   b. Calls AI Inference Service → predicted prep time → sets estimated_ready_at
   c. Publishes event to Redis channel `cart:{cart_id}:queue` AND `order:{order_id}:updates`
   d. Returns order detail incl. estimated_ready_at to customer immediately (REST response)

3. Customer's browser:
   a. Opens WebSocket to wss://realtime.CartCloud.app/ws/orders/{order_id}?token=...
   b. Realtime Gateway subscribes to Redis channel `order:{order_id}:updates`
   c. Renders live countdown client-side (computed from estimated_ready_at, ticking locally —
      NOT re-fetched every second, to avoid hammering the server; WS pushes only on actual changes)

4. Cart Worker, on KDS, marks order "preparing" → later "ready"
   PATCH /v1/kds/orders/{order_id}/status {status: "ready"}

5. Core API, on transition → "ready":
   a. Writes order_status_events row
   b. Publishes to Redis `order:{order_id}:updates` (any open WS tab updates instantly, shows "READY!" banner)
   c. Enqueues a Celery task: `send_order_ready_alert(order_id)`  ← this is the critical path

6. Celery worker `send_order_ready_alert`:
   a. Looks up customer's active push_subscriptions
   b. Sends Web Push payload via VAPID-authenticated request to the browser's push service
      (Google FCM endpoint for Chrome/Edge/Android, Apple Push endpoint for Safari/iOS, Mozilla for Firefox —
      the pywebpush library abstracts the differences; we just need each subscription's `endpoint` URL)
   c. Push payload: { title: "🔔 Your order is ready!", body: "Pickup at Rafiq's Fuchka Cart, Counter 2",
      vibrate pattern set in Service Worker's notification options, tag: order_id (so repeat pushes
      replace/update one notification instead of stacking) }
   d. On push delivery failure (expired subscription, 410 Gone) → immediately fall back to SMS
   e. Writes notification_log row regardless of channel/outcome
   f. If customer has NOT opened the order page within 90 seconds of push delivery (tracked via a
      lightweight "delivery confirmed" beacon ping from the Service Worker's notificationclick/show
      handler) → send a follow-up SMS anyway, since an undelivered/unseen push is functionally a failure
```

### 4.3.1 Service Worker notification behavior (client-side contract)

```javascript
// sw.js — registered once on first page load
self.addEventListener('push', function(event) {
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/order-ready.png',
      vibrate: [200, 100, 200, 100, 400],   // distinct pattern, not a generic single buzz
      tag: data.order_id,                    // collapses duplicate notifications for same order
      requireInteraction: true,               // stays on screen until dismissed — don't let it auto-clear
      data: { order_id: data.order_id, url: `/orders/${data.order_id}` }
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
```

`requireInteraction: true` matters specifically for this use case — a notification that auto-dismisses after a few seconds defeats the point when the customer is mid-conversation 10 meters from the cart and doesn't glance at their phone instantly.

## 4.4 Realtime Gateway internals

- Pure FastAPI `WebSocket` endpoints, **stateless** — holds no business logic, no DB writes. Its only job: authenticate the connection, subscribe to the right Redis pub/sub channel(s), relay messages.
- Horizontally scalable: any number of Realtime Gateway instances can run behind the load balancer, because Redis pub/sub (not in-memory state) is the source of truth for "who needs to hear about this event." A customer's WS connection can land on *any* gateway instance; it'll still get the right events because all instances subscribe to the same Redis channels.
- **Channels:**
  - `order:{order_id}:updates` — single order detail (countdown, status)
  - `cart:{cart_id}:queue` — full queue view, used by the KDS dashboard (sees every order on the cart, reorders live as AI re-sequences — Part 6.3)
  - `vendor:{vendor_id}:dashboard` — aggregate events for the owner's live dashboard (new order arrived, revenue ticking up)
- **Connection lifecycle:** heartbeat ping/pong every 25s; client auto-reconnects with exponential backoff (capped at 30s) on drop; on reconnect, client immediately does a one-shot REST `GET /orders/{id}` to resync state (covers any events missed while disconnected) before resubscribing to WS — **WS is an optimization for instant updates, REST is always the source of truth for current state.**

## 4.5 Backpressure & queue throttling

A single cart (one stall, one or two workers) cannot physically prepare unlimited concurrent orders. `carts.max_concurrent_orders` is enforced:
- When `count(orders WHERE cart_id=X AND status IN (placed,accepted,preparing)) >= max_concurrent_orders`, new orders are still **accepted** (we don't want to turn away revenue) but the customer sees an honest, AI-adjusted estimated wait that reflects the real backlog (Part 6.2) rather than a falsely optimistic number — trust in the countdown is the whole point of the feature, so we never let it be decorative.
- If a vendor wants a hard cap (literally refuse new orders past a threshold, e.g. near closing time), `is_accepting_online_orders` is a manual owner-controlled kill switch, checked before order creation.

## 4.6 Polling fallback (defense in depth)

For the rare customer on a browser/network that can't sustain a WebSocket (some embedded WebViews, restrictive corporate/campus proxies — relevant since Sayed's context includes polytechnic/campus environments where this might be tested):
- Client detects WS connection failure after 2 retry attempts → falls back to REST polling `GET /orders/{id}` every 8 seconds.
- This is a graceful degradation path, documented and tested, not an afterthought — "the countdown silently freezes" is a worse failure mode than "it updates a bit slower."

---


# Part 5: Payments — Pluggable Gateway Abstraction

## 5.1 Design goal

A vendor in Dhaka needs bKash/Nagad. A future vendor in another market might need Stripe or Razorpay. The platform itself needs **one** consistent internal contract so adding a new gateway is a new adapter class, not a rewrite of order/payment logic.

## 5.2 The abstraction

```python
# payments/base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass
class PaymentInitiationResult:
    transaction_id: str          # gateway's reference, stored in payment_transactions
    redirect_url: str | None     # for redirect-based flows (bKash, SSLCommerz, Stripe Checkout)
    client_secret: str | None    # for client-side SDK flows (Stripe PaymentIntent)
    status: str                  # 'initiated' | 'requires_action'

@dataclass
class PaymentVerificationResult:
    success: bool
    transaction_id: str
    amount: float
    raw_payload: dict

class PaymentGateway(ABC):
    @abstractmethod
    async def initiate(self, order, amount: float, currency: str, return_url: str) -> PaymentInitiationResult: ...

    @abstractmethod
    async def verify_webhook(self, headers: dict, body: bytes) -> PaymentVerificationResult:
        """Verify signature, parse callback payload — gateway-specific crypto/format lives only here."""
        ...

    @abstractmethod
    async def refund(self, transaction_id: str, amount: float) -> bool: ...
```

Concrete adapters: `BkashGateway`, `NagadGateway`, `SSLCommerzGateway`, `StripeGateway` — each implements the same three methods, each fully encapsulating that provider's quirks (bKash's OAuth-token-then-create-payment dance, SSLCommerz's hash validation, Stripe's webhook signature scheme). The order-creation and webhook-handling code in Core API never branches on gateway type beyond a single factory lookup:

```python
GATEWAY_REGISTRY: dict[str, type[PaymentGateway]] = {
    "bkash": BkashGateway,
    "nagad": NagadGateway,
    "sslcommerz": SSLCommerzGateway,
    "stripe": StripeGateway,
}

def get_gateway(name: str) -> PaymentGateway:
    return GATEWAY_REGISTRY[name]()
```

## 5.3 Per-vendor gateway configuration

A vendor enables only the gateways relevant to them:

```sql
CREATE TABLE vendor_payment_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id       UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    gateway         VARCHAR(20) NOT NULL,
    is_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    credentials_encrypted JSONB NOT NULL,   -- vendor's own bKash merchant creds, or platform-pooled creds
    settlement_mode VARCHAR(20) NOT NULL DEFAULT 'platform_pooled',
                    -- 'platform_pooled' (platform collects, pays out vendor on schedule)
                    -- 'direct'          (vendor's own merchant account, platform takes commission separately)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Two settlement models, explicitly supported because they suit different vendor sizes:**
- **Platform-pooled** (default, suits small carts with no merchant account of their own): platform's own bKash/SSLCommerz merchant account collects payment, platform commission is deducted, net amount goes into the vendor's scheduled payout (`vendor_payouts` table, Part 2.5) via bank transfer/mobile wallet.
- **Direct**: vendor has their own bKash Merchant or Stripe account; money goes straight to them; platform commission is invoiced/deducted separately (e.g. monthly SaaS fee) rather than skimmed off each transaction. This suits a vendor on a `growth`/`pro` subscription tier who wants instant settlement and doesn't want to wait on a platform payout cycle.

## 5.4 Cash handling

Cash is **not** "no payment system" — it still needs to flow through the same state machine for reporting integrity:
- `payment_method = 'cash'` orders go straight to `placed` status (no `pending_payment` wait).
- A `payment_transactions` row is still created with `gateway = 'cash'`, `status = 'success'`, `completed_at = now()` — this keeps revenue analytics, payout commission calculations, and the AI demand-forecasting training data uniform regardless of payment method. Cash orders still count toward GMV and still owe platform commission (deducted from the vendor's next online settlement, or invoiced if a vendor is 100% cash-only — handled by a monthly Celery reconciliation job).
- Cart Workers can optionally mark a cash order "cash collected" as a separate confirmation tap (useful for vendors who want a paper-trail-like digital log even for cash), but this does not block order progression — a kitchen shouldn't stall food prep waiting on a cashier.

## 5.5 Webhook handling — idempotency and security

```python
@router.post("/payments/{order_id}/webhook/{gateway}")
async def payment_webhook(order_id: UUID, gateway: str, request: Request):
    gw = get_gateway(gateway)
    body = await request.body()
    result = await gw.verify_webhook(dict(request.headers), body)   # raises on bad signature

    # Idempotency: gateway_transaction_id is unique; a duplicate webhook delivery
    # (all these providers retry webhooks) must not double-process the order.
    existing = await get_transaction_by_gateway_id(result.transaction_id)
    if existing and existing.status == "success":
        return {"status": "already_processed"}   # 200 OK — ack so gateway stops retrying

    if result.success:
        await mark_order_placed(order_id, result)
        await trigger_ai_eta_prediction(order_id)
        await publish_ws_event(order_id, "payment_confirmed")
    else:
        await mark_order_payment_failed(order_id, result)

    return {"status": "ok"}
```

Webhook signature verification is **mandatory and gateway-specific** (bKash uses a different scheme than Stripe's `Stripe-Signature` HMAC) — this lives entirely inside each adapter's `verify_webhook`, so a vulnerability in one adapter's verification logic can't be copy-pasted into believing all gateways are equally protected.

## 5.6 Refunds & cancellations

- `POST /orders/{id}/cancel` by customer, while order is still `placed`/`accepted`: if paid online, triggers `gateway.refund()`; if cash, no monetary action needed (nothing was collected yet).
- Vendor-initiated cancellation (e.g. "sold out mid-order," rare but must be handled): same refund path, plus a mandatory `cancellation_reason`, plus the AI fraud-risk model logs an event if a vendor cancels paid orders unusually often (could indicate the vendor is gaming online-order numbers without fulfilling them — a real moderation signal the Platform Admin needs, see Part 6.5 and Part 7).

---


# Part 6: AI Systems

Every AI feature below is scoped to a concrete data input, a concrete model choice, and a concrete failure mode (what happens if the model is wrong or unavailable) — because an AI feature that can silently make the order pipeline worse is worse than no AI feature. The guiding rule throughout: **AI informs and ranks; it never gets unilateral authority over money movement or order validity.**

## 6.1 AI Inference Service — isolation rationale

A separate deployable FastAPI service (`ai-inference`), because:
- ML dependencies (torch/onnxruntime, scikit-learn, sentence-transformers) are heavy and version-sensitive; isolating them means a dependency upgrade for the AI service can never break the order-taking Core API.
- It can be scaled independently (GPU/CPU-optimized instances) without scaling the whole platform.
- It can degrade gracefully: every AI feature has a **rule-based fallback** baked into Core API itself, so if the AI service is down, slow, or returns low-confidence results, the platform falls back to a simple heuristic and keeps functioning — explicitly designed, not accidental.

Communication: Core API → AI Inference Service via internal REST (`http://ai-inference.internal:8000`), with a short timeout (800ms) and circuit breaker (after 5 consecutive failures, skip calling AI for 60s and use fallback directly) using a simple in-process circuit breaker pattern.

## 6.2 Smart Prep-Time Prediction (the engine behind the countdown's honesty)

**Problem this solves:** a fixed "10 minutes for everything" estimate is what makes existing systems feel fake. The countdown must reflect reality — different items take different times, queue depth matters, and a tired cart at 9pm after 200 orders is slower than the same cart at 11am.

**Model:** Gradient-boosted regression (LightGBM/XGBoost — these vastly outperform deep learning for this kind of small-tabular-feature regression problem, and matter a lot for inference latency, which must be sub-200ms since it sits in the order-creation hot path).

**Features:**
- Item-level base prep time (learned per `menu_item_id`, seeded from owner-entered estimate, corrected by actual observed data over time)
- Current `queue_depth` (orders ahead in `placed`/`accepted`/`preparing` states)
- Hour of day, day of week (lunch rush vs. quiet afternoon)
- Rolling 7-day average actual-vs-predicted error for this specific cart (a per-cart bias correction term — some carts are just consistently slower than their stated estimate, and the model should learn that fast)
- Number of distinct *option customizations* in the order (an order with 3 items each customized 4 ways takes longer than 3 identical items)
- Weather (rain → typically more orders, slower cart movement — enriched async from a weather API per Bangladesh district, cached hourly)

**Training loop:** `order_fulfillment_metrics` table (Part 2.7) accumulates `actual_prep_seconds` every time an order moves to `ready`. A nightly Celery batch job retrains a per-cart-cluster model (carts are clustered by cuisine type + order volume tier, not strictly 1 model per cart — a brand-new cart with 3 historical orders has no data to train on, so it inherits the model of similar carts until it has enough of its own history, a classic cold-start solution).

**Fallback if AI service unavailable or cart has <20 historical orders:** simple deterministic formula —
`estimated_seconds = sum(item.avg_prep_time_seconds for item in order_items, deduplicated by parallel prep) + queue_depth * cart.avg_prep_time_seconds * 0.4`
— a transparent, explainable heuristic, not a black box, and good enough to never leave a customer with no estimate at all.

**Crucial UX rule:** if the AI re-predicts a longer ETA mid-preparation (e.g. cart got slammed with 5 orders at once), the customer's countdown is allowed to extend — but never silently. The WS event for an ETA change includes a `reason` the UI surfaces honestly: *"Running a bit behind — updated estimate: 4 more minutes."* Trust matters more than a number that's always shrinking.

## 6.3 AI Queue Sequencing (the kitchen's "what should I cook next")

**Problem this solves:** FIFO (first-in-first-out) is the naive default, but it's not actually optimal. A cart worker looking at 6 pending orders should sometimes batch two identical-item orders together (cook 4 of the same fuchka order in one pass instead of two), and should never let a 2-minute drink-only order sit behind a 12-minute complex order if it arrived only slightly later — customers waiting on fast orders churn/complain disproportionately.

**Approach:** this is **not** a deep learning problem — it's a constrained optimization/scheduling problem, solved well with a scoring heuristic re-ranked every time the queue changes (recomputed in the AI service, cached in Redis, pushed to KDS via the `cart:{cart_id}:queue` WS channel from Part 4.4):

```
priority_score(order) =
    w1 * (time_already_waited / promised_wait_time)      # SLA pressure — closer to breaching promise = higher priority
  + w2 * (1 / predicted_prep_seconds)                      # shorter jobs get a boost (minimize average wait, classic SJF)
  + w3 * batching_bonus(order, currently_queued_orders)    # bonus if items overlap with another queued order
  - w4 * (customer.is_first_time ? 0 : loyalty_discount)   # slight, intentionally small, fairness term — see note below
```

Weights (`w1..w4`) are vendor-tunable defaults with sane platform-wide starting values, exposed (simplified, as a single "Speed vs. Fairness" slider, not raw weights) in the owner dashboard's AI settings — because different cart types want different tradeoffs (a drinks stand wants pure speed/throughput; a made-to-order grill wants more strict fairness/FIFO to avoid customer complaints about being skipped).

**Important honesty constraint:** the *customer-facing* queue position and ETA must always be consistent with what the AI sequencing actually intends to do — we never show a customer "you're #2" while privately planning to bump them for batching efficiency reasons without updating their displayed ETA accordingly. The KDS recommendation and the customer's countdown are computed from the **same** underlying priority score, not two divergent systems.

**Fallback:** plain FIFO. Always available, zero risk, the literal default if the AI service is unreachable.

## 6.4 Conversational / Voice Ordering Assistant

**Problem this solves:** typing out a food order on a small phone screen, especially with item customizations, is friction — and for a meaningful chunk of Bangladesh's population, typing in English-script menu names is itself a barrier even though they're fluent verbally in Bangla. This is also a genuinely good fit for an "extraordinary AI feature" that's actually useful, not gimmicky.

**Flow:**
1. Customer taps a mic icon (or types) on the cart's menu page → opens `POST /ai/voice-order/session`.
2. Customer speaks (or types) naturally: *"Ek plate fuchka dao, bhalo jhal, ar ek glass borhani"* (Bangla, code-mixed, totally natural).
3. Audio → speech-to-text (Whisper, self-hosted or via API, with Bangla support) → text passed to an LLM-based order-extraction step **constrained to the cart's actual current menu** (the menu items, their `id`s, and their option groups are injected into the model's context — the model is never allowed to invent an item that doesn't exist on this specific cart's live menu).
4. The LLM step outputs **structured JSON**, not free text — a `draft_order` matching the same `{items: [{menu_item_id, quantity, selected_option_choice_ids}]}` shape the regular REST order-creation endpoint expects. This is the critical design choice: **the AI never has a special, less-validated path to create an order.** Its only output is a pre-filled draft that still goes through the exact same `POST /carts/{slug}/orders` validation, pricing calculation, and payment flow as a manually-tapped order.
5. The assistant replies conversationally (text + optional TTS audio) confirming what it understood: *"Got it — 1 plate fuchka, extra spicy, and 1 borhani. That's 90 taka. Should I place the order?"* — and only proceeds to actual order creation on explicit confirmation (`POST .../confirm`), never silently.
6. If the model is uncertain (ambiguous item, item not found, mishears quantity), it **asks a clarifying question** rather than guessing — `requires_confirmation: true` with a clarifying `assistant_text`, not a best-guess silent fill.

**Why this is the "extraordinary" feature that's actually defensible:** it directly serves the platform's actual user base (Bangla-first, possibly less comfortable with English UI text or fiddly multi-step menu tapping), it reduces order-entry time, and — because the underlying validation path is identical to manual ordering — it introduces **zero new attack surface or pricing-integrity risk.** The AI is a better input method, not a parallel order pipeline.

**Logged for improvement:** every turn → `ai_conversation_logs` (Part 2.7), used to retrain/improve prompt design and catch systematic misunderstandings (e.g. if "kom jhal" — "less spicy" — is consistently mis-mapped, that's a fixable prompt/menu-option-labeling issue, surfaced via a weekly review dashboard for the platform team, not silently absorbed).

## 6.5 Fraud & Anomaly Detection

Three distinct fraud surfaces, each genuinely different in nature:

**(a) Customer-side abuse**
- Signals: rapid order-then-cancel cycles, many orders from one device fingerprint across many phone numbers (suggests fake-number cycling to repeatedly grab first-time promos), implausible order velocity (5 orders from different carts across town within 10 minutes — physically impossible for one person to be picking up).
- Model: a lightweight isolation-forest anomaly detector over per-customer behavioral features, run async (not blocking checkout) — flags write to `fraud_risk_events`, and crossing a risk threshold sets `customers.risk_score`, which can gate future actions (e.g. require OTP every time, regardless of device trust, once risk_score is elevated) without ever blocking a legitimate hungry customer's first order on a false positive. **First orders are never auto-blocked** — only patterns over multiple orders trigger friction increases.

**(b) Vendor-side integrity**
- Signals: a vendor's online-payment-order cancellation rate spiking (possible attempt to collect cash side-payments while showing fake "out of stock" on the platform to avoid commission — a real-world incentive problem in commission-based marketplaces), suspiciously round/repeated transaction amounts (potential money-laundering-adjacent pattern through the pooled settlement account), QR token mismatches spiking for one cart (someone's printed/copied a competitor's QR — see 2.3).
- These don't auto-suspend a vendor (too high-stakes for a fully automated action) — they create a `fraud_risk_events` row with `action_taken = 'flagged'` that surfaces in the **Platform Admin console** (Part 7) for human review, with `action_taken = 'manual_review'` as the actual gate before any suspension.

**(c) Payment-specific (card/wallet testing)**
- Standard velocity checks (many failed payment attempts in short succession from one device/customer) feed directly into the gateway-agnostic webhook handler (Part 5.5) — failed attempts beyond a threshold temporarily disable online payment for that customer (cash still always available, so this never blocks them from eating, just from one payment rail).

## 6.6 Owner-Facing AI Copilot ("Digest")

**Problem this solves:** a cart owner is busy running a stall, not reading dashboards. A daily/weekly plain-language digest, generated by an LLM grounded strictly in **that vendor's own queried data** (never invented), surfaces what actually matters:

> *"This week your busiest hours were 1–2pm and 7–8pm. Fuchka sold out by 6pm three days running — consider prepping more for the evening rush. Average wait time crept up to 14 minutes on Thursday, above your usual 9 — likely linked to the rain that day slowing your queue. Cash orders made up 70% of revenue; enabling bKash could capture customers who skip your cart when they don't have exact change."*

**Architecture:** a scheduled Celery job queries `order_fulfillment_metrics`, `orders`, `demand_forecasts` for the vendor → assembles a structured numeric summary (not raw rows) → passes that summary as grounding context to an LLM with a strict instruction to **only narrate the provided numbers**, never fabricate figures — this is a classic retrieval-grounded generation pattern, and the "retrieval" here is just our own SQL aggregation, which is simpler and more reliable than a RAG/vector-search setup for this use case since the data is fully structured, not unstructured documents.

**Also powers demand forecasting surfaced to the owner directly:** `demand_forecasts` (Part 2.7) predictions ("expect ~40 orders tomorrow 1–2pm, mostly fuchka and chotpoti") help a vendor decide how much to prep in advance — trained via a time-series model (Prophet or a simple seasonal-ARIMA per cart, falling back to a 4-week rolling average for new carts with insufficient history) on historical hourly order counts, enriched with day-of-week, public holiday calendar (Bangladesh-specific), and weather.

## 6.7 What is deliberately NOT AI-automated

Stated explicitly, because restraint is part of good architecture:
- **No AI-driven dynamic pricing.** Prices are vendor-set, full stop — surge pricing on street food erodes the trust this whole product depends on.
- **No AI auto-acceptance of orders on the vendor's behalf.** A human (worker/owner) always taps "accept" — the AI predicts and ranks, it never commits a vendor's kitchen capacity without a human in the loop.
- **No automated vendor suspension.** Fraud signals reach a human admin queue; suspension is always a human action (Part 6.5b, Part 7).

---


# Part 7: Admin Console, Observability, Security & Deployment

## 7.1 Platform Admin Console — why it's a first-class product, not "just the DB"

Because we chose FastAPI over Django, we don't inherit Django's free admin UI — so the Admin Console is explicitly built as its own frontend application (separate React app, `admin.CartCloud.app`), backed entirely by the `/v1/admin/*` REST endpoints from Part 3.4. This is presented as an advantage, not a gap: a hand-built admin gets tenant-aware views (cross-vendor search, fraud queues, payout batch actions) that a generic auto-admin never models well anyway.

**Core admin surfaces:**
1. **Vendor directory** — search/filter all vendors by status, KYC state, subscription tier, GMV; drill into any vendor's full operational view (their carts, their orders, their staff) bypassing RLS via the dedicated admin Postgres role.
2. **Live operations map** — all currently-open carts plotted on a map (using `carts.location_lat/lng`), color-coded by current queue depth/health — lets platform support spot a cart that's gone silent (no status updates in 30+ min while marked "open," likely a stuck KDS device) before the vendor even notices.
3. **Fraud queue** — `fraud_risk_events` sorted by `risk_score`, with one-click "flag," "block customer," "suspend vendor," "dismiss" actions, each writing a full audit row.
4. **Payout control center** — batch-process scheduled payouts, override a stuck payout, view full per-vendor settlement history.
5. **Platform analytics** — GMV trend, active-vendor trend, cohort retention of vendors (do vendors who enable AI features stick around longer? — directly answerable since every AI feature usage is logged), churn-risk scoring per vendor (a simple model: declining order volume + declining login frequency + support ticket sentiment → risk score, surfaced so platform success teams can proactively reach out).
6. **Support agent view** — scoped subset: customer lookup by phone (order history, session list, risk score), with "unblock customer" action but explicitly **no** access to payout/financial controls (enforced by the `is_support_agent` vs `is_platform_admin` distinction in `staff_users`, Part 2.2).

## 7.2 Observability

- **Structured logging**: every log line JSON-formatted, always including `request_id`, `vendor_id` (if applicable), `cart_id` (if applicable), `customer_id` (if applicable) — so any incident can be traced across the Core API, Realtime Gateway, and AI Inference Service by a single `request_id` threaded through via a FastAPI middleware that generates/propagates it via header.
- **Metrics** (Prometheus + Grafana): request latency histograms per endpoint, WebSocket connection count, Celery queue depth, payment gateway success/failure rate per provider, AI Inference Service call latency and circuit-breaker state, push notification delivery success rate (critical — a silent regression here is the single worst possible failure of this entire product, so it gets its own dashboard panel and a PagerDuty-style alert if delivery success drops below 95% over a 15-minute window).
- **Distributed tracing** (OpenTelemetry): spans across Core API → AI Inference Service → external payment gateway calls, so a slow checkout can be diagnosed (was it our DB? the AI ETA call? bKash's API being slow today?) without guessing.
- **Order funnel tracking**: every order's full lifecycle timestamps (`placed_at → accepted_at → preparing→ ready_at → completed_at`) feeds a funnel dashboard — average time stuck "placed" but not yet "accepted" is a direct proxy for vendor responsiveness, and an early-warning signal worth its own alert threshold per vendor.

## 7.3 Security checklist (explicit, not assumed)

- **TLS everywhere**, HSTS enforced, no plaintext HTTP path even for redirects.
- **RLS as defense in depth** (Part 2.1) — never the *only* layer; application code still always filters by tenant explicitly, RLS catches the bugs, doesn't replace careful query-writing.
- **Encryption at rest** for `vendors.settlement_account_json` and `vendor_payment_configs.credentials_encrypted` — application-layer encryption (e.g. via a KMS-backed envelope encryption scheme), not relying on disk encryption alone, since these are the literal keys to moving vendor money.
- **PII minimization**: customer phone numbers are the one durable PII anchor — never logged in plaintext in general application logs (masked as `+8801XXXXX678` in logs, full value only in the encrypted DB column and in necessary SMS-send calls).
- **Webhook signature verification mandatory** (Part 5.5) — no payment webhook is ever trusted without provider-specific signature validation; a missing/invalid signature is a hard 401, not a warning.
- **JWT hygiene**: short-lived access tokens (15 min customer, 30 min staff), refresh token rotation on every use, refresh tokens stored hashed (never plaintext) so a DB read-replica leak doesn't equal session hijack.
- **2FA mandatory** for Cart Owners and all Admin/Support roles (Part 3.2) — these accounts touch money and cross-tenant data.
- **Audit trail**: `order_status_events`, `fraud_risk_events`, and all admin actions write immutable audit rows with `triggered_by_user_id` — every status change and every admin override is forensically traceable.
- **Dependency & container scanning** in CI (Trivy/Snyk), automated, blocking merges on critical CVEs in the Docker images.

## 7.4 Deployment Architecture

```
                          ┌────────────────────┐
                          │   CDN (CloudFront/  │
                          │   Cloudflare) for    │
                          │   static PWA assets  │
                          └─────────┬────────────┘
                                    │
                          ┌─────────▼────────────┐
                          │  Load Balancer (ALB)  │
                          └─────────┬────────────┘
              ┌─────────────────────┼─────────────────────┐
     ┌────────▼────────┐  ┌─────────▼─────────┐  ┌─────────▼─────────┐
     │ Core API pods    │  │ Realtime Gateway   │  │ AI Inference pods  │
     │ (k8s Deployment, │  │ pods (k8s, sticky   │  │ (k8s, separate     │
     │ HPA 3-15 replicas│  │ session via Redis,   │  │ node pool, can be  │
     │ on CPU)          │  │ HPA on conn count)    │  │ GPU-backed)         │
     └────────┬─────────┘  └──────────┬──────────┘  └──────────┬─────────┘
              │                       │                          │
              └───────────┬───────────┴──────────────┬───────────┘
                ┌──────────▼──────────┐    ┌───────────▼───────────┐
                │ PostgreSQL (RDS/     │    │ Redis (ElastiCache/   │
                │ managed, primary +   │    │ managed, cluster mode  │
                │ read replica)        │    │ for pub/sub + cache)   │
                └──────────────────────┘    └────────────────────────┘
                ┌──────────────────────────────────────────────────┐
                │  Celery workers (k8s, separate queues:            │
                │  notifications [high priority], reports [low],    │
                │  ai_batch [scheduled])                              │
                └──────────────────────────────────────────────────┘
```

- **Environments**: `dev`, `staging`, `prod` — fully isolated DBs and Redis instances, staging seeded with anonymized production-shaped data for realistic load testing of the real-time/notification path before any release touches prod.
- **CI/CD**: GitHub Actions — lint (ruff) → type-check (mypy/pydantic strict) → unit tests → integration tests against an ephemeral Postgres+Redis via `docker-compose` in CI → build/push Docker images → deploy to staging automatically → manual promotion gate to prod.
- **Database migrations**: Alembic, every migration reviewed for RLS policy implications (a new tenant-scoped table without its RLS policy is a checklist item in the PR template, not optional).
- **Blue/green or canary rollout** for the Realtime Gateway specifically — it's the most connection-state-sensitive service; a bad rollout here means dropped WS connections platform-wide at the worst possible moment (dinner rush).

## 7.5 Testing Strategy

- **Unit tests**: business logic (pricing calculation, queue priority scoring, RBAC permission resolution) — pure functions, fast, no DB.
- **Integration tests**: full request → DB → response cycles against a real (test) Postgres, including RLS policy verification tests (explicitly try to read cross-tenant data with the wrong `app.current_vendor_id` set and assert it's blocked — RLS without a test that proves it works is a false sense of security).
- **Contract tests**: payment gateway adapters tested against each provider's official sandbox environment (bKash sandbox, SSLCommerz sandbox, Stripe test mode) — webhook signature verification specifically gets dedicated test fixtures with real (sandbox) signed payloads, not hand-rolled fake ones.
- **Load testing**: simulate a realistic "dinner rush" scenario — N concurrent carts, each receiving bursts of orders, WebSocket connection storms, push notification fan-out — using Locust or k6, run against staging before any major release, with the push-delivery-success-rate metric as a pass/fail gate.
- **AI model evaluation**: prep-time prediction model evaluated on held-out historical data (MAE in seconds, tracked over model versions — a new model version that regresses MAE doesn't ship); queue sequencing heuristic evaluated via simulation (replay historical order arrival patterns through both FIFO and the scoring heuristic, compare average/p95 wait time); voice-ordering NLU evaluated on a hand-curated set of real Bangla/code-mixed order phrasings with expected structured-output ground truth.

## 7.6 Build Roadmap (phased, not "do everything at once")

**Phase 1 — Core ordering (MVP, no AI yet)**
Auth (customer phone+OTP, staff JWT), vendor/cart/menu CRUD, QR resolution, order creation + cash payment, basic KDS status updates, plain WebSocket live status (no push yet — REST polling acceptable interim), Platform Admin read-only vendor list.
*Goal: a real cart could use this end-to-end with cash only.*

**Phase 2 — Real-time + Notifications**
Web Push integration, Service Worker, SMS fallback, Realtime Gateway properly built out (Redis pub/sub architecture from Part 4), queue position display, backpressure/`max_concurrent_orders` enforcement.

**Phase 3 — Payments**
Pluggable gateway abstraction, bKash + SSLCommerz adapters (BD market priority), webhook handling, vendor payout batch processing, cash/online unified reporting.

**Phase 4 — AI Wave 1 (the deterministic-fallback-first features)**
Smart prep-time prediction (starts on the simple heuristic fallback from day one of Phase 1 actually — Phase 4 is where the learned model replaces the heuristic once enough `order_fulfillment_metrics` data exists), queue sequencing heuristic, basic fraud velocity checks.

**Phase 5 — AI Wave 2 (the differentiated features)**
Voice/conversational ordering assistant, demand forecasting, owner-facing AI copilot digest, vendor health/churn scoring for the admin console.

**Phase 6 — Scale & polish**
Multi-region considerations if expanding beyond Bangladesh, advanced admin analytics, A/B testing framework for AI feature tuning (e.g. testing different queue-sequencing weight presets across cart cohorts), public API for vendors who want to integrate their own POS systems (a `vendor_api_keys` table and a documented partner API — natural extension of the same REST contract).

---

## Summary

This architecture treats the product's two hardest real constraints — **zero-friction guest identity** and **a phone alert that works without an installed app** — as the load-bearing design decisions they actually are, rather than UI afterthoughts, and builds multi-tenancy and payment pluggability in from the schema level up rather than retrofitting them once one vendor becomes many. The AI layer is scoped to problems with real data and real fallbacks (prep-time prediction, queue sequencing, fraud signals, voice ordering, owner insights), explicitly avoiding the kind of AI-for-its-own-sake feature that would erode trust in a product whose entire value proposition is an honest countdown timer.
# Part 8: Role-Specific Dashboards — Detailed Statistics

Part 3 listed dashboard *endpoints* in passing. This part specifies what actually renders on screen for each role: which metrics, computed how, over what time windows, and why those specific numbers matter to that specific person's job. Each dashboard below maps to a concrete `GET` endpoint and a concrete SQL aggregation — nothing here is decorative.

A general principle applied throughout: **every dashboard is scoped by role to the data that role can act on.** A Cart Worker doesn't need revenue figures (they can't act on revenue), and a Cart Owner doesn't need platform-wide GMV (they can't act on other vendors' numbers). Showing irrelevant numbers is itself a UX failure in a dashboard — it's noise that buries the number the person actually opened the screen to check.

## 8.1 Cart Worker Dashboard (the KDS — Kitchen Display System)

**Who:** the person physically cooking/packing at the cart. They glance at this screen between orders, often with wet/messy hands — the design constraint is **glanceability**, not depth.

**Primary view: Live Queue Board**

```
GET /v1/kds/queue
```

Renders as a kanban-style board, three columns, sorted within each column by AI queue-priority score (Part 6.3):

| New (placed) | Preparing | Ready for pickup |
|---|---|---|
| Order #A-041 — 2 items — waited 1m | Order #A-039 — 4 items — 3m elapsed / ~6m est. | Order #A-038 — waiting 45s for pickup |
| Order #A-042 — 1 item — waited 0m | | |

Each card shows, at minimum:
- Order number (not customer name by default — names appear only on tap/expand, since a worker tracking 8 cards needs a short scannable token, not prose)
- Item count + a compressed item list (e.g. "2× Fuchka, 1× Borhani")
- A live elapsed/remaining timer per card (driven by the same WS channel from Part 4.4)
- A color/urgency indicator: green (within promised time), amber (within 90% of promised time), red (breached promised time) — this single visual cue is the most important statistic on the entire screen, because it's the one number that turns into a customer complaint if ignored.
- One tap action: advance to next status (`placed → accepted → preparing → ready → completed`)

**Secondary view: Today's shift summary** (a single collapsible strip, not a separate page — workers don't navigate during a rush)

```
GET /v1/kds/shift-summary?cart_id=&date=today
```

| Metric | Computation |
|---|---|
| Orders completed today | `COUNT(*) WHERE cart_id=X AND status='completed' AND DATE(completed_at)=today` |
| Orders currently active | `COUNT(*) WHERE cart_id=X AND status IN ('placed','accepted','preparing')` |
| Average prep time today | `AVG(actual_prep_seconds) FROM order_fulfillment_metrics WHERE cart_id=X AND DATE(created_at)=today` |
| SLA breaches today | `COUNT(*) WHERE ready_at > estimated_ready_at_initial AND DATE(created_at)=today` |
| Sold-out items right now | `SELECT name FROM menu_items WHERE cart_id=X AND is_available=false` |

No revenue figures here deliberately — a worker can't change pricing or commission, so showing money is noise relative to their job, which is throughput and order accuracy.

## 8.2 Cart Owner Dashboard

**Who:** runs the business day-to-day, makes pricing/staffing/menu decisions, watches money and customer experience together.

### 8.2.1 Today-at-a-glance (landing screen)

```
GET /v1/carts/{cart_id}/analytics/summary?range=today
```

| Stat | Computation | Why it matters to an owner |
|---|---|---|
| Revenue today | `SUM(total) WHERE cart_id=X AND status NOT IN (cancelled_*, payment_failed) AND DATE(created_at)=today` | The number they check first, always |
| Orders today (count) | `COUNT(*)` same filter | Volume vs. revenue tells them if avg order value moved |
| Average order value | `revenue_today / orders_today` | Upsell/combo effectiveness signal |
| Cash vs. online split | `SUM(total) GROUP BY payment_method` | Tells them whether to push harder on enabling more online gateways |
| Average wait time today | `AVG(actual_prep_seconds)/60` from `order_fulfillment_metrics` | Direct proxy for customer experience |
| Current queue depth (live) | `COUNT(*) WHERE status IN (placed,accepted,preparing)` | "Is it busy right now" at a glance, pushed live via the `vendor:{id}:dashboard` WS channel (Part 4.4), not polled |
| Cancellation rate today | `cancelled_orders / total_orders` | Early warning — spikes here usually mean a stockout or a slow kitchen, both fixable same-day |
| Comparison to same weekday last week | Each of the above with a `↑12%` / `↓4%` delta badge | Raw numbers without trend context are nearly meaningless to a busy owner — the delta is what actually drives a decision |

### 8.2.2 Trends view (revenue & volume over time)

```
GET /v1/carts/{cart_id}/analytics/trends?range=7d|30d|90d&granularity=hour|day
```

- Time-series chart: revenue and order count, selectable granularity. Hourly granularity over a single day reveals lunch/dinner rush shape; daily granularity over 30 days reveals weekday vs. weekend patterns and any growth/decline trend.
- **Hour-of-day heatmap** (day-of-week × hour-of-day grid, color intensity = order volume) — this is the single most actionable visual for a small food cart, since it directly informs staffing ("I only need a second worker Thu–Sat 6–9pm") and prep planning. Backed by a `GROUP BY EXTRACT(dow FROM created_at), EXTRACT(hour FROM created_at)` aggregation, cached hourly in Redis since it's read-heavy and only needs to update once new orders land, not on every dashboard view.

### 8.2.3 Menu performance

```
GET /v1/carts/{cart_id}/analytics/menu-performance?range=30d
```

| Column | Computation |
|---|---|
| Item name | — |
| Units sold | `SUM(quantity) FROM order_items JOIN orders ... WHERE menu_item_id=X` |
| Revenue contributed | `SUM(line_total)` |
| % of total cart revenue | `item_revenue / cart_total_revenue` |
| Times marked sold-out | `COUNT(*) FROM menu_item_availability_log WHERE is_available transitioned false` *(new lightweight log table, see 8.2.4)* |
| Avg prep time (this item alone) | learned value from the AI prep-time model (Part 6.2), surfaced read-only here |
| Attach rate with other items | `% of orders containing this item that also contain item Y`, top 3 shown — genuinely useful for combo/bundle pricing decisions |

Sortable by units sold (best-sellers) and by revenue (highest earners — not always the same items, and that gap is exactly the kind of insight an owner can't eyeball from memory).

**8.2.4 — small schema addition needed to support "times marked sold-out":**

```sql
CREATE TABLE menu_item_availability_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_item_id    UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    is_available    BOOLEAN NOT NULL,
    changed_by      UUID REFERENCES staff_users(id),
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
This wasn't in Part 2 originally — flagging it explicitly here because "how often does this item sell out" is a real, commonly-requested vendor stat (it directly signals under-prepping a popular item) and needs its own append-only log; deriving it from `menu_items.is_available`'s current value alone would lose all history.

### 8.2.5 Customer insight panel

```
GET /v1/carts/{cart_id}/analytics/customers?range=30d
```

| Stat | Computation |
|---|---|
| Unique customers | `COUNT(DISTINCT customer_id)` |
| Repeat customer rate | `customers with >1 order / unique customers` |
| New vs. returning revenue split | self-explanatory join against first-ever-order-date per customer |
| Top 10 repeat customers | by order count — shown only as masked phone (`+8801XXXXX678`) + order count + total spend, never full PII surfaced casually in a dashboard, consistent with Part 7.3's PII minimization rule |

### 8.2.6 AI Copilot Digest panel (Part 6.6, surfaced here)

The plain-language weekly digest renders as a card at the top of the dashboard, generated by the grounded-LLM job described in Part 6.6 — explicitly **not** a replacement for the numeric panels above, but a narrated summary of them for an owner who wants the "so what" before the raw numbers.

### 8.2.7 Multi-cart owners — the rollup view

If `vendors.id` has more than one `cart_id` (Part 1.2/2.1), the owner's landing dashboard defaults to a **rollup across all their carts** with a per-cart breakdown table beneath it, before drilling into any single cart's detail view above. Computation is identical aggregations, just `GROUP BY cart_id` instead of filtered to one cart — same endpoints, an additional `?cart_id=all` mode rather than a separate codepath.

## 8.3 Manager Dashboard

Identical to the Cart Owner dashboard (8.2), **scoped by the manager's actual granted permissions** (Part 1.3's permission matrix) rather than a separately designed screen — e.g. a Manager without `payout:view` sees every panel above except payout/settlement figures, which are hidden entirely rather than shown-and-grayed-out (hiding avoids a manager fixating on a number they can't act on and can't query further about). This is a deliberate reuse decision: one dashboard codebase, permission-filtered at render time based on the same RBAC permission strings already enforced server-side on each endpoint — the frontend never has to maintain its own separate notion of "what can a manager see."

## 8.4 Customer-Facing "Dashboard" (Order History view)

Smaller in scope by design — a guest customer doesn't need a dashboard in the operational sense, but the **order history view** (`GET /v1/orders/me`, Part 3.1) does carry light personal statistics, since they add real value without adding friction:

```
GET /v1/orders/me/stats
```

| Stat | Computation |
|---|---|
| Total orders placed (platform-wide) | `COUNT(*) WHERE customer_id=me` |
| Favorite cart | `cart_id with MAX(COUNT(*)) GROUP BY cart_id` |
| Favorite item | same pattern over `order_items` |
| Total spent (platform-wide) | `SUM(total)` |

This list is also exactly what feeds the **AI reorder suggestion** ("Order your usual from Rafiq's Fuchka Cart again?") referenced in Part 6 — the stats panel and the AI feature share one query, not two.

## 8.5 Platform Admin Dashboard — full breakdown

Part 7.1 named the admin console's surfaces; here is what each surface's *statistics panel* actually contains, since "platform analytics" was previously a one-line bullet.

### 8.5.1 Platform Health (landing screen)

```
GET /v1/admin/analytics/platform-summary?range=today|7d|30d
```

| Stat | Computation | Why a platform admin needs it |
|---|---|---|
| GMV (Gross Merchandise Value) | `SUM(orders.total)` across all vendors, all statuses except cancelled/failed | The core platform health number |
| Platform revenue (commission earned) | `SUM(orders.platform_fee)` | What the business actually keeps |
| Active vendors | `COUNT(DISTINCT vendor_id) WHERE has order in range` | Engagement, not just signups |
| Active carts | same pattern at cart granularity | A vendor can have carts going stale even while "active" overall |
| New vendor signups | `COUNT(*) FROM vendors WHERE created_at in range` | Growth |
| New vendor activation rate | `% of new signups that took ≥1 real order within 7 days` | Catches a broken onboarding funnel — a vendor who signs up but never gets a single order is a churn-before-they-started case, and this metric is the only thing that surfaces it early |
| Order success rate | `completed / (completed + cancelled_* + payment_failed)` platform-wide | Cross-vendor operational health in one number |
| Push notification delivery rate | from `notification_log`, `delivered / sent` for `event_type='order_ready'` | Flagged in Part 7.2 as the single most important reliability metric in the whole product — repeated here because it belongs on the admin landing screen, not buried in an ops-only panel |

### 8.5.2 Vendor Health & Churn Risk table

```
GET /v1/admin/analytics/vendor-health?sort=risk_score&order=desc
```

| Column | Computation |
|---|---|
| Vendor name | — |
| Order volume trend (4-week) | linear regression slope over weekly order counts |
| Days since last order | `now() - MAX(orders.created_at)` |
| Login frequency trend | from `staff_users.last_login_at` history (requires a lightweight `login_events` append log — flagging as another small schema addition, same rationale as 8.2.4: a single "last login" column can't show a *trend*, only a snapshot) |
| Support tickets (last 30d) | count, if a support-ticket table exists (natural future addition under the Admin Console; not yet specified in Part 2 — noting the gap honestly rather than implying it's built) |
| Computed churn-risk score | weighted combination of the above (Part 6.6's "simple model" made concrete here: declining order trend weighted highest, then login decline, then ticket volume) |

This table is the actual actionable artifact behind the one-line "churn-risk scoring" bullet from Part 7.1 — a platform success person works this table top-down, reaching out to the highest-risk active vendors before they silently disappear.

### 8.5.3 Fraud Queue statistics

```
GET /v1/admin/fraud-events?min_risk_score=&status=
```
Plus a summary strip above the queue table itself:

| Stat | Computation |
|---|---|
| Open flags (unresolved) | `COUNT(*) WHERE action_taken IN ('flagged','manual_review')` |
| Flags resolved today | `COUNT(*) WHERE resolved_at::date = today` |
| Breakdown by risk_type | `COUNT(*) GROUP BY risk_type` (rapid_cancel / card_testing / velocity / fake_gps / vendor cancellation spikes) — tells the admin team *what kind* of fraud is currently trending, which changes what they look for that week |
| Average time-to-resolution | `AVG(resolved_at - created_at)` for resolved flags — an ops SLA on the admin team's own responsiveness |

### 8.5.4 Live Operations Map — the stats layer

Part 7.1 described the map visually; the data backing each marker:

| Per-cart marker shows | Computation |
|---|---|
| Status dot color | green: `is_open=true AND last status update <10min ago`; amber: `is_open=true AND last update 10-30min ago` (possibly stuck); red: `is_open=true AND no update >30min` (likely a frozen KDS device, paged to support) |
| Current queue depth | live, from the same Redis-cached value the owner's own dashboard uses (Part 8.2.1) — one source of truth, two consumers |
| Today's order count | same query as 8.2.1, just queried per-cart across all carts in one batched call rather than the owner's single-cart call |

## 8.6 Cross-cutting implementation note: one aggregation layer, many consumers

Every dashboard stat above is intentionally built from a **small, shared set of SQL aggregation functions** (`get_revenue_summary(cart_id, range)`, `get_order_funnel_stats(...)`, `get_menu_performance(...)`, etc.) living in a `analytics/queries.py` module, parameterized by scope (`cart_id`, `vendor_id`, or platform-wide with admin's RLS-bypass role). The Cart Owner dashboard, the Manager dashboard (permission-filtered), and the Admin's per-vendor drill-down view all call the *same* underlying functions at different scope levels — this is why 8.3's Manager dashboard could be specified in one paragraph instead of a full re-spec: there is deliberately only one implementation of "what does a cart's performance look like," reused at every role's appropriate zoom level, which is also what keeps the numbers trustworthy — an owner and a support agent looking at the same cart on the same day will always see identical figures, because they're hitting the same function, never two parallel hand-rolled queries that can quietly drift apart.

Heavy aggregations (trends, heatmaps, menu performance over 30/90 days) are **not** computed live on every request — they're precomputed by a Celery beat schedule (hourly for "today" stats, nightly for 7/30/90-day rollups) into a small `analytics_cache` table/Redis key, keyed by `(scope_type, scope_id, metric, range)`. Only the "right now, live" numbers (current queue depth, today's running revenue) hit the database directly, and even those are read from the Postgres **read replica** (Part 1.4/7.4), never the primary — dashboards must never compete with the order-placement write path for database resources, especially during the dinner rush when both are busiest at the same time.

```sql
CREATE TABLE analytics_cache (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type  VARCHAR(20) NOT NULL,   -- 'cart' | 'vendor' | 'platform'
    scope_id    UUID,                    -- null for platform-wide
    metric_key  VARCHAR(60) NOT NULL,    -- 'revenue_trend_30d' | 'menu_performance_30d' | etc.
    range_param VARCHAR(20),
    payload     JSONB NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(scope_type, scope_id, metric_key, range_param)
);
```
# Part 9: AI Engineering Deep-Dive

Part 6 described the AI *systems* at an architecture level — what each feature does, why, and its fallback. This part goes one layer deeper: the actual prompts, schemas, training code, evaluation harness, and serving setup — the artifacts an AI engineering interviewer or hiring manager would actually want to see in a repo. If you're using this project to apply for AI engineer roles, **this is the part to actually build and screenshot/demo**, not just describe.

A portfolio reviewer for an AI engineering role is typically checking for four distinct skills. This part is organized around exactly those four, so you can point to a specific section when asked "tell me about the AI work in this project":

1. **LLM application engineering** — prompting, structured output, function calling, RAG, agentic flows, guardrails (9.1–9.3)
2. **Applied ML** — training a real model on real data, not just calling an API (9.4)
3. **Evaluation & MLOps** — proving a model works and keeping it working in production (9.5–9.6)
4. **Systems judgment** — knowing when *not* to use an LLM, and designing for failure (9.7, ties back to Part 6.7)

## 9.1 LLM Integration #1 — Voice/Conversational Ordering (Function Calling + Structured Output)

This is the centerpiece LLM feature (Part 6.4) and the one to lead with in an interview, because it demonstrates **constrained generation grounded in live, per-tenant data** — a materially harder and more realistic problem than a generic chatbot demo.

### 9.1.1 The actual system prompt

```text
You are an order-taking assistant for "{cart_name}", a food cart in Bangladesh.
You ONLY know about the menu provided below. Never invent items, prices, or
options that are not listed. If the customer asks for something not on this
menu, say it's not available and suggest the closest real item.

CURRENT MENU (JSON):
{menu_json}
# Example shape:
# [{"id": "a1b2...", "name": "Fuchka", "name_bn": "ফুচকা", "price": 60,
#    "options": [{"group": "Spice Level", "required": true,
#                 "choices": [{"id":"c1","label":"Mild","delta":0},
#                             {"id":"c2","label":"Hot","delta":0}]}]}]

The customer may speak in Bangla, English, or a casual mix of both (Banglish).
Understand both. Respond in the SAME language style the customer used.

Your job each turn:
1. Update your understanding of what they want to order so far.
2. If anything required is missing or ambiguous (e.g. spice level not stated for
   an item that requires it, unclear quantity), ask ONE short clarifying question.
3. If you're confident in the full order, summarize it back in plain language
   and ask for confirmation before finalizing.
4. NEVER finalize an order without explicit customer confirmation.

You MUST respond by calling the `update_draft_order` function on every turn.
Do not respond with plain text outside of the function call.
```

### 9.1.2 The function-calling schema (the actual contract)

```json
{
  "name": "update_draft_order",
  "description": "Update the customer's draft order based on the conversation so far.",
  "parameters": {
    "type": "object",
    "properties": {
      "assistant_message": {
        "type": "string",
        "description": "What to say back to the customer in chat — confirmation, clarifying question, or summary."
      },
      "items": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "menu_item_id": { "type": "string", "description": "Must be an exact id from the provided menu — never invented." },
            "quantity": { "type": "integer", "minimum": 1 },
            "selected_option_choice_ids": { "type": "array", "items": { "type": "string" } }
          },
          "required": ["menu_item_id", "quantity"]
        }
      },
      "status": {
        "type": "string",
        "enum": ["gathering", "needs_clarification", "ready_to_confirm", "confirmed"]
      }
    },
    "required": ["assistant_message", "items", "status"]
  }
}
```

**Why this design choice matters and is worth explaining in an interview:** forcing the model to call a function on *every* turn (rather than free-form chat with occasional tool calls) means the backend never has to parse natural language to figure out order state — it always receives structured JSON. The `menu_item_id` field is validated server-side against the real menu on every single turn (not trusted blindly), which is the actual guardrail that prevents hallucinated items or stale prices from ever reaching a real order — restated from Part 6.4, but this is *where* that guarantee is enforced in code, not just asserted in prose.

### 9.1.3 Server-side validation wrapper (the part that makes this production-safe, not a demo)

```python
async def process_voice_order_turn(session: VoiceOrderSession, user_input: str) -> TurnResult:
    menu = await get_active_menu_json(session.cart_id)  # always fetched fresh, never cached stale into the prompt
    response = await llm_client.chat.completions.create(
        model="claude-sonnet-4-6",
        system=SYSTEM_PROMPT.format(cart_name=session.cart_name, menu_json=menu),
        messages=session.history + [{"role": "user", "content": user_input}],
        tools=[UPDATE_DRAFT_ORDER_SCHEMA],
        tool_choice={"type": "tool", "name": "update_draft_order"},
    )
    draft = parse_tool_call(response)

    # Hard validation — the model's output is NEVER trusted as-is
    valid_item_ids = {item.id for item in menu.items}
    for line in draft.items:
        if line.menu_item_id not in valid_item_ids:
            # Model hallucinated or referenced a stale/removed item — strip it and
            # force a clarification turn rather than silently dropping it.
            return TurnResult(
                assistant_message=f"Sorry, that item isn't on the menu right now. Did you mean one of: {suggest_similar(line, menu)}?",
                status="needs_clarification",
            )

    if draft.status == "confirmed":
        # Re-use the EXACT same order-creation path a manually-tapped order uses —
        # pricing, stock checks, payment flow all re-validated independently here.
        order = await create_order_from_items(session.cart_id, session.customer_id, draft.items)
        return TurnResult(assistant_message=draft.assistant_message, order=order, status="confirmed")

    return TurnResult(assistant_message=draft.assistant_message, draft_items=draft.items, status=draft.status)
```

### 9.1.4 Speech-to-text pipeline (the audio half)

- **STT:** Whisper (`large-v3`, self-hosted via `faster-whisper` for latency, or the hosted Whisper API as a v1 shortcut) — chosen specifically because it has meaningfully better Bangla ASR accuracy than most alternatives, which matters concretely here since the customer base is Bangla-first.
- **Code-mixing handling:** Bangla/English code-mixing ("ek glass cola dao") is **not** handled by trying to force Whisper into one language mode — `language=None` (auto-detect per segment) with a post-processing normalization step that doesn't translate, just passes the natural mixed transcript straight to the LLM, which handles code-mixed input natively far better than a translation-then-process pipeline would (translation would lose intent on food-specific Bangla terms that don't map 1:1 to English anyway).
- **TTS (optional reply audio):** a Bangla-capable TTS (e.g. Coqui TTS fine-tuned, or a cloud TTS with Bangla voice support) — flagged in the architecture as optional/Phase 5-late, because text replies alone already solve the core friction; voice-out is a nice-to-have, not load-bearing.

## 9.2 LLM Integration #2 — RAG-Grounded Owner Copilot Digest (filling a real gap from Part 6.6)

Part 6.6 described the copilot digest as "grounded in structured numeric summaries" — true, but worth being explicit that this is **not** actually a RAG (retrieval-augmented generation) system in the vector-search sense, since the data is fully structured (SQL), not unstructured documents. That's a correct engineering call, but a portfolio benefits from also showing you can build *real* RAG where it's actually the right tool — so here's where vector retrieval genuinely belongs in this system:

**Genuine RAG use case: Menu-aware customer support / FAQ assistant.**

A customer (or a new vendor onboarding) asks free-text questions like *"does this cart do delivery?"*, *"is the chicken halal?"*, *"how do I get my QR code printed?"* — answers come from a mix of (a) this specific vendor's own menu/policy text fields, and (b) a platform-wide help-center knowledge base (onboarding docs, payout FAQs, policy text). This is genuine unstructured-document retrieval and is the right place to actually build a vector-search pipeline:

```python
# Ingestion (run once per vendor menu update + once for platform help docs)
from sentence_transformers import SentenceTransformer

embedder = SentenceTransformer("intfloat/multilingual-e5-base")  # handles Bangla + English well

def index_document(doc_id: str, text: str, source_type: str, scope_id: str | None):
    chunks = chunk_text(text, max_tokens=300, overlap=50)
    embeddings = embedder.encode(chunks)
    for chunk, vec in zip(chunks, embeddings):
        upsert_to_pgvector(doc_id, chunk, vec, source_type, scope_id)
```

```sql
-- pgvector extension on the same Postgres instance — no separate vector DB needed at this scale
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_chunks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR(30) NOT NULL,   -- 'vendor_policy' | 'platform_help' | 'menu_item_description'
    scope_id    UUID,                    -- vendor_id/cart_id, or null for platform-wide docs
    chunk_text  TEXT NOT NULL,
    embedding   vector(768),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
```

```python
async def answer_support_question(question: str, cart_id: str | None) -> str:
    query_vec = embedder.encode([question])[0]
    # Retrieve from BOTH this vendor's own docs AND platform-wide docs, vendor-scoped
    # docs ranked higher — tenant scoping matters in retrieval too, not just in the
    # transactional DB (echoes the RLS principle from Part 2.1 in the vector layer).
    chunks = await pgvector_search(query_vec, scope_id=cart_id, k=5, boost_scope=True)
    context = "\n\n".join(c.chunk_text for c in chunks)
    return await llm_client.complete(
        system="Answer using ONLY the provided context. If the context doesn't "
               "contain the answer, say you don't know and suggest contacting the vendor directly.",
        user=f"Context:\n{context}\n\nQuestion: {question}",
    )
```

**Why `pgvector` over a dedicated vector database (Pinecone/Weaviate) here, and why that's a defensible interview answer:** the corpus per tenant is small (one cart's menu/policy text is a handful of paragraphs), total platform corpus is modest even at thousands of vendors, and we already run Postgres — adding a second specialized datastore for a workload this size is unjustified operational overhead. This is the kind of "right-sized tool, not the trendiest tool" judgment call that's worth saying out loud in an interview, not hiding.

## 9.3 LLM Integration #3 — Fraud Narrative Explanation (LLM-as-explainer, not LLM-as-decider)

A small but interview-relevant addition: the fraud detection model (Part 6.5) produces a `risk_score` and a `risk_type`, but a human admin reviewing the fraud queue (Part 8.5.3) shouldn't have to reverse-engineer *why* a score of 78 was assigned. An LLM call, given the structured feature values that fed the isolation-forest model, generates a one-line plain-English rationale:

```python
def explain_fraud_flag(features: dict, risk_score: int, risk_type: str) -> str:
    return llm_client.complete(
        system="Explain in ONE plain sentence why this customer order pattern looks "
               "suspicious, for a non-technical fraud reviewer. Be factual, cite only "
               "the numbers given, no speculation beyond them.",
        user=f"risk_type: {risk_type}\nfeatures: {json.dumps(features)}\nrisk_score: {risk_score}",
    )
    # e.g. "Flagged because this device placed 6 orders from 4 different phone numbers
    #       within 20 minutes, each cancelled before pickup."
```

This is explicitly **LLM-as-explainer over a model's output, never LLM-as-the-fraud-model itself** — the actual detection stays a auditable, retrainable statistical model (Part 9.4); the LLM's only job is translating numbers into a sentence a human can act on quickly. Worth stating clearly in an interview: this is a deliberate separation of concerns, not a missed opportunity to "just ask an LLM if this is fraud" (which would be unauditable and a worse fraud model).

## 9.4 Applied ML — The Prep-Time Prediction Model (the part that proves you can train, not just call an API)

This is the artifact that demonstrates classic applied-ML skill, separate from LLM work — worth having an actual notebook/script in the repo for this, since "I called an LLM" and "I trained and evaluated a model" are different (complementary) signals to a hiring manager.

### 9.4.1 Feature engineering (concrete, not just named)

```python
import pandas as pd
from sklearn.model_selection import train_test_split
import lightgbm as lgb

def build_feature_frame(raw_orders: pd.DataFrame) -> pd.DataFrame:
    df = raw_orders.copy()
    df["hour_of_day"] = df["created_at"].dt.hour
    df["day_of_week"] = df["created_at"].dt.dayofweek
    df["is_weekend"] = df["day_of_week"].isin([5, 6]).astype(int)
    df["item_count"] = df["order_items"].apply(len)
    df["distinct_customizations"] = df["order_items"].apply(
        lambda items: sum(len(i.get("selected_options", [])) for i in items)
    )
    df["queue_depth_at_placement"] = df["queue_depth_at_placement"]  # already captured at order time
    df["cart_rolling_bias_7d"] = df.groupby("cart_id")["prep_error_seconds"] \
        .transform(lambda s: s.rolling(7, min_periods=1).mean().shift(1).fillna(0))
    return df[[
        "hour_of_day", "day_of_week", "is_weekend", "item_count",
        "distinct_customizations", "queue_depth_at_placement",
        "cart_rolling_bias_7d", "weather_is_rain", "cart_volume_tier",
    ]]

X = build_feature_frame(orders_df)
y = orders_df["actual_prep_seconds"]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = lgb.LGBMRegressor(
    objective="regression",
    n_estimators=300,
    learning_rate=0.05,
    max_depth=6,
    num_leaves=31,
)
model.fit(
    X_train, y_train,
    eval_set=[(X_test, y_test)],
    eval_metric="mae",
    callbacks=[lgb.early_stopping(stopping_rounds=20)],
)
```

### 9.4.2 Why LightGBM, stated as a real tradeoff (interview gold — shows you didn't reach for deep learning by default)

- Tabular, structured, low-dimensional feature set (~10 features) — this is precisely the regime where gradient-boosted trees consistently beat neural nets in published benchmarks (and in practice), while being far cheaper to train, retrain nightly, and serve at sub-50ms latency on CPU with no GPU dependency.
- Naturally handles the mixed feature types here (categorical `cart_volume_tier`, boolean `is_weekend`, continuous `queue_depth`) without manual embedding layers.
- Feature importance is directly inspectable (`model.feature_importances_`) — meaning when a vendor asks "why is my estimate often wrong," there's a real, explainable answer, not a black box. This explainability requirement is itself a legitimate design constraint worth naming explicitly, since the whole product's trust hinges on the countdown being explainable, not just accurate.

### 9.4.3 Cold-start clustering (the part that makes this *engineering*, not just a Kaggle notebook)

```python
def assign_cart_cluster(cart: Cart, all_carts: pd.DataFrame) -> str:
    """New carts with <20 historical orders borrow a cluster model trained on
    similar carts (by cuisine_type + order_volume_tier) instead of having no
    model at all — the cold-start solution referenced in Part 6.2, made concrete."""
    if cart.order_count >= 20:
        return f"individual:{cart.id}"
    similar = all_carts[
        (all_carts.cuisine_type == cart.cuisine_type) &
        (all_carts.order_volume_tier == cart.order_volume_tier)
    ]
    return f"cluster:{cart.cuisine_type}:{cart.order_volume_tier}"
```

### 9.4.4 Serving

```python
# AI Inference Service endpoint
@router.post("/internal/predict-prep-time")
async def predict_prep_time(req: PrepTimeRequest) -> PrepTimeResponse:
    model = model_registry.get(req.cart_id)  # loaded from cluster or individual, cached in memory
    if model is None or model.training_sample_count < MIN_SAMPLES:
        return PrepTimeResponse(
            predicted_seconds=heuristic_fallback(req),  # Part 6.2's deterministic formula
            source="heuristic_fallback",
        )
    features = build_feature_frame_single(req)
    prediction = model.predict([features])[0]
    return PrepTimeResponse(predicted_seconds=int(prediction), source="lightgbm_v" + model.version)
```

## 9.5 Evaluation Harness (proving the model works — the part most toy projects skip entirely)

```python
def evaluate_model(model, X_test, y_test) -> dict:
    preds = model.predict(X_test)
    mae = mean_absolute_error(y_test, preds)
    mape = mean_absolute_percentage_error(y_test, preds)
    # Compare against the naive fallback heuristic on the SAME test set —
    # if the learned model can't beat the simple formula, it doesn't ship.
    baseline_preds = X_test.apply(heuristic_fallback_from_features, axis=1)
    baseline_mae = mean_absolute_error(y_test, baseline_preds)
    return {
        "model_mae_seconds": mae,
        "model_mape": mape,
        "baseline_mae_seconds": baseline_mae,
        "improvement_over_baseline_pct": (baseline_mae - mae) / baseline_mae * 100,
        "ships": mae < baseline_mae * 0.85,  # require a real, meaningful improvement, not noise
    }
```

For the voice-ordering NLU (Part 9.1), the equivalent harness is a **hand-curated golden set**, not a generic benchmark:

```python
GOLDEN_SET = [
    {"input_bn": "ek plate fuchka dao, jhal kom", "expected_item": "fuchka",
     "expected_options": ["spice_mild"], "expected_quantity": 1},
    {"input_bn": "dui glass cola ar ek plate chotpoti", "expected_items": [
        {"item": "cola", "qty": 2}, {"item": "chotpoti", "qty": 1}]},
    # ... 40-60 real, hand-written code-mixed phrasings, covering ambiguous cases,
    # corrections mid-sentence ("na fuchka na, chotpoti dao"), and out-of-menu requests
]

def run_nlu_eval(golden_set) -> dict:
    correct = 0
    for case in golden_set:
        result = process_voice_order_turn_sync(case["input_bn"])
        if matches_expected(result, case):
            correct += 1
    return {"accuracy": correct / len(golden_set), "n": len(golden_set)}
```

**Why a golden set instead of just "vibes-checking it in a demo":** this is the single most interview-relevant artifact in the whole AI section — a hiring manager asking "how do you know your AI feature actually works" wants to hear "here's a labeled eval set and a pass-rate I track across prompt/model changes," not "I tried a few examples and it seemed fine." This eval set should be re-run on every prompt change or model swap (e.g. evaluating Claude Sonnet 4.6 vs. an earlier model version, or testing a prompt rewrite) and the result tracked over time (a simple CSV log of `date, model_version, accuracy` is enough to show real before/after rigor).

## 9.6 MLOps & Monitoring (operationalizing the model, not just training it once)

- **Model versioning:** every trained LightGBM model artifact saved with a version string (`lgbm_v{date}_{cart_cluster}`), stored in S3-compatible storage, loaded into the AI Inference Service's in-memory registry on a rolling basis — `demand_forecasts.model_version` and the prep-time response's `source` field (9.4.4) both record which version produced a given prediction, so a regression can be traced to an exact model build.
- **Drift monitoring:** the nightly retraining job (Part 6.2) doesn't just retrain blindly — it computes `actual_prep_seconds - predicted_prep_seconds` (the live prediction error) on the *previous* day's completed orders before retraining, and logs this to the same metrics pipeline as Part 7.2's observability stack. A sustained rise in mean absolute error per cart is a drift signal (e.g. a cart changed its menu significantly, or got a new, slower worker) that should trigger a forced retrain outside the normal nightly cadence, not wait for the schedule.
- **Shadow evaluation before promoting a new model version:** a newly retrained model runs in "shadow mode" for 24 hours — predictions logged but not served to customers — compared against the currently-live model's predictions on the same incoming orders, promoted only if it's measurably better (ties to the `ships` gate in 9.5), never auto-promoted on training-time metrics alone, since training-time and live-traffic performance can diverge.
- **LLM-specific monitoring:** every voice-ordering session logs (Part 2.7's `ai_conversation_logs`) the `status` field outcome distribution (`confirmed` vs. `needs_clarification` vs. abandoned sessions) — a rising abandonment rate or a rising clarification-loop rate (the same session needing 4+ clarifying turns) is the production-traffic equivalent of an eval regression and should alert the same way a dropping prep-time accuracy would.

## 9.7 Systems Judgment — What This Project Demonstrates About AI Engineering Maturity

Worth saying explicitly, because this is often the actual differentiator in an interview versus someone who only knows how to call an LLM API:

| Decision in this project | What it signals |
|---|---|
| LightGBM for prep-time, not a neural net | Knowing tabular ML doesn't need deep learning |
| Function calling + server-side re-validation for voice ordering | Understanding LLM output is never trusted blindly in a transactional system |
| pgvector instead of a dedicated vector DB | Right-sizing infrastructure to actual data volume |
| LLM-as-explainer, not LLM-as-fraud-decider | Knowing where an LLM adds value vs. where it removes auditability |
| Every AI feature has a non-AI fallback (Part 6 throughout) | Designing for model/service failure as a first-class case, not an edge case |
| Golden-set eval + shadow deployment before promotion | Knowing "it works in the demo" and "it works in production" are different bars |
| Explicit "what we don't automate" list (Part 6.7) | Restraint and risk-awareness, not just capability-stacking |

This table is also, frankly, close to the literal answer to "walk me through the AI work in your portfolio project" — each row is a 30-second talking point backed by a real artifact elsewhere in this document.
# Part 10: Inventory Management

## 10.0 Why this is a separate Part, not just extra columns

The existing schema has one inventory-adjacent concept: `menu_items.is_available` — a manual on/off toggle a worker flips when something sells out. That is not inventory management. It is a symptom-acknowledgement system: the item already ran out, and someone noticed.

A real inventory system works in the opposite direction: it knows how much of each ingredient exists *before* anything runs out, deducts automatically as orders are placed, surfaces low-stock warnings in advance, projects when a restock is needed given current demand rate, and — for a food cart context — accounts for wastage and prep-based consumption (not just sale-based). It also closes the loop with the existing `is_available` toggle: instead of a worker manually flipping the toggle after physically noticing they're out of something, **the system flips it automatically when stock hits zero**, and flips it back when the owner logs a restock.

This Part covers:

- The ingredient and recipe layer (what each menu item costs in raw ingredients)
- Stock-level tracking with full movement ledger (append-only, never update-in-place)
- Integration with order placement (automatic deduction)
- Restock management and supplier contacts
- The AI layer: low-stock alerts, auto-reorder recommendations, wastage pattern detection
- Inventory-specific dashboard panels per role
- Changes to existing Parts (schema additions, new endpoints, updated API contracts)

## 10.1 Scope decision: ingredient-level vs. item-level inventory

Two design options exist and the choice matters:

| Approach | What it tracks | Suitable for |
|---|---|---|
| **Item-level** | Stock a fixed quantity of a finished menu item (e.g. "50 portions of Chotpoti prepped today") | Simple use case: vendor batch-preps items in the morning, wants to know when they'll run out |
| **Ingredient-level** | Stock raw ingredients (tamarind water, chickpeas, spice mix), define a recipe per item, deduct ingredients from inventory on each order | Full visibility: know *why* an item is running out, share ingredients across multiple items, detect wastage vs. sale variance |

**CartCloud supports both simultaneously**, per vendor tier:
- `free` tier vendors: **item-level only** — simple, requires no recipe setup, works out of the box.
- `growth`/`pro` tier vendors: **ingredient-level** (with item-level fallback for items that haven't had a recipe defined yet).

This is not a gating-for-gating's-sake decision — ingredient-level tracking requires vendor setup effort (entering a recipe), and a free-tier small cart with 3 menu items may not want or need that. But a growth-tier vendor with shared ingredients across 10 items (e.g. same chickpeas in both Chotpoti and Fuchka) gets genuinely actionable information from ingredient-level that item-level can't provide: "you have enough chickpeas for 40 more portions of Chotpoti OR 60 more Fuchka, not both at current demand rates."

## 10.2 Database Schema

### 10.2.1 Ingredients & Units

```sql
CREATE TABLE ingredients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id         UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    name_bn         VARCHAR(150),
    unit            VARCHAR(20) NOT NULL,
    -- unit is free-form but must be consistent per ingredient:
    -- 'g' | 'kg' | 'ml' | 'l' | 'piece' | 'packet' | 'bunch'
    -- stored as entered; conversion is the vendor's responsibility
    -- (a future unit-conversion layer is a possible Pro-tier addition)
    cost_per_unit   NUMERIC(10,4),          -- optional: for COGS tracking
    reorder_threshold NUMERIC(10,3) NOT NULL DEFAULT 0,
    -- when current_stock <= reorder_threshold → low-stock alert fires
    reorder_quantity NUMERIC(10,3),          -- suggested restock amount (vendor-set)
    preferred_supplier_id UUID REFERENCES suppliers(id),
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ingredients_cart ON ingredients(cart_id);

-- RLS (same pattern as every tenant-scoped table)
ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_ingredients ON ingredients
    USING (cart_id IN (
        SELECT id FROM carts WHERE vendor_id = current_setting('app.current_vendor_id')::UUID
    ));
```

### 10.2.2 Recipes (the ingredient-level bridge between menu items and inventory)

```sql
CREATE TABLE recipes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_item_id    UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    version         INTEGER NOT NULL DEFAULT 1,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recipe_ingredients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id       UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    ingredient_id   UUID NOT NULL REFERENCES ingredients(id),
    quantity_per_unit NUMERIC(10,4) NOT NULL,
    -- "per unit" = per 1 quantity of the menu item ordered
    -- e.g. Fuchka recipe: tamarind_water=50ml, chickpeas=30g, fuchka_shells=6pieces
    -- if customer orders quantity=2, deduction = quantity_per_unit * 2
    notes           TEXT
);
```

**Recipe versioning rationale:** when a recipe is updated (e.g. a vendor adjusts portion sizes), historical order deductions should remain tied to the recipe version that was active at order-time, not retroactively re-calculated. The `recipes.is_active` flag means there's always at most one active recipe per `menu_item_id`, but old versions remain intact for the audit trail and for the ML training data (if portion size changed, the prep-time/wastage patterns before and after the change are structurally different and should be treated as a changepoint in the forecasting model).

### 10.2.3 Item-level stock (for free-tier and for items without a recipe)

```sql
CREATE TABLE item_stock_levels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_item_id    UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    cart_id         UUID NOT NULL REFERENCES carts(id),
    current_stock   NUMERIC(10,2) NOT NULL DEFAULT 0,
    -- in "portions" — vendor pre-declares how many they prepared today
    reorder_threshold NUMERIC(10,2) NOT NULL DEFAULT 0,
    last_reset_at   TIMESTAMPTZ,        -- when stock was last manually set (e.g. start of shift)
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 10.2.4 Ingredient stock levels

```sql
CREATE TABLE ingredient_stock_levels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_id   UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    cart_id         UUID NOT NULL REFERENCES carts(id),
    current_quantity NUMERIC(12,4) NOT NULL DEFAULT 0,
    last_counted_at  TIMESTAMPTZ,       -- when a worker last manually verified physical stock
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(ingredient_id, cart_id)
);
```

### 10.2.5 Stock Movement Ledger — the most important table in this Part

**Never update `current_quantity` directly. Every change to stock goes through a ledger entry first; `current_quantity` is always derived or updated atomically as a side-effect of a ledger insert.** This is the same principle as a bank account ledger — the running balance is a derived view of the transaction history, and the history is immutable.

```sql
CREATE TYPE stock_movement_type AS ENUM (
    'order_deduction',      -- stock consumed when an order is placed
    'order_reversal',       -- stock returned when an order is cancelled before prep
    'manual_restock',       -- owner/worker logs a delivery/top-up
    'manual_adjustment',    -- correction after a physical count (positive or negative)
    'wastage',              -- item spoiled, spilled, discarded — tracked separately from sales
    'opening_count',        -- start-of-shift physical count sets a baseline
    'transfer_in',          -- future: stock moved between two carts of the same vendor
    'transfer_out'
);

CREATE TABLE stock_movements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id         UUID NOT NULL REFERENCES carts(id),
    ingredient_id   UUID REFERENCES ingredients(id),           -- null if item-level movement
    menu_item_id    UUID REFERENCES menu_items(id),            -- null if ingredient-level movement
    movement_type   stock_movement_type NOT NULL,
    quantity_delta  NUMERIC(12,4) NOT NULL,
    -- negative for deductions/wastage, positive for restocks/adjustments
    quantity_before NUMERIC(12,4) NOT NULL,     -- snapshot at time of movement
    quantity_after  NUMERIC(12,4) NOT NULL,
    order_id        UUID REFERENCES orders(id),  -- set for order_deduction and order_reversal
    triggered_by    UUID REFERENCES staff_users(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_movements_ingredient ON stock_movements(ingredient_id, created_at);
CREATE INDEX idx_movements_cart ON stock_movements(cart_id, created_at);
CREATE INDEX idx_movements_order ON stock_movements(order_id) WHERE order_id IS NOT NULL;
```

### 10.2.6 Suppliers

```sql
CREATE TABLE suppliers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id       UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    contact_phone   VARCHAR(20),
    contact_name    VARCHAR(100),
    address_text    VARCHAR(255),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id         UUID NOT NULL REFERENCES carts(id),
    supplier_id     UUID REFERENCES suppliers(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft'|'sent'|'partially_received'|'received'|'cancelled'
    expected_delivery_date DATE,
    notes           TEXT,
    created_by      UUID REFERENCES staff_users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    received_at     TIMESTAMPTZ
);

CREATE TABLE purchase_order_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    ingredient_id   UUID NOT NULL REFERENCES ingredients(id),
    quantity_ordered NUMERIC(12,4) NOT NULL,
    quantity_received NUMERIC(12,4) NOT NULL DEFAULT 0,
    unit_cost       NUMERIC(10,4),
    is_received     BOOLEAN NOT NULL DEFAULT FALSE
);
```

Receiving a purchase order triggers `stock_movements` inserts for each line (`movement_type='manual_restock'`, `quantity_delta = quantity_received`), which atomically update `ingredient_stock_levels.current_quantity`. The purchase order history also feeds the AI reorder-timing model (10.4.2).

## 10.3 Stock Deduction on Order Placement — integration with the existing order pipeline

This is the critical integration point: when `POST /carts/{slug}/orders` is called (Part 3.1), stock deduction must happen **atomically within the same database transaction** as order creation — not in a background Celery task, not as a subsequent call, but inside the same DB transaction, so an order can never be confirmed if stock is simultaneously exhausted by a concurrent order.

```python
async def create_order(db: AsyncSession, cart_id: UUID, items: list[OrderItemRequest],
                       customer_id: UUID, ...) -> Order:
    async with db.begin():                        # one transaction wrapping everything below
        # Step 1: standard order + order_items creation (existing logic from Part 3.1)
        order = await _insert_order(db, cart_id, customer_id, ...)
        order_items = await _insert_order_items(db, order.id, items)

        # Step 2: determine inventory mode for this cart (item-level vs. ingredient-level)
        mode = await get_inventory_mode(db, cart_id)

        if mode == "ingredient_level":
            deductions = await _resolve_ingredient_deductions(db, order_items)
            # deductions: [{ingredient_id, quantity_delta (negative)}, ...]

        elif mode == "item_level":
            deductions = await _resolve_item_deductions(db, order_items)
            # deductions: [{menu_item_id, quantity_delta (negative)}, ...]

        # Step 3: acquire row-level locks on the specific stock rows being deducted
        # (SELECT FOR UPDATE) — prevents two concurrent orders from both thinking
        # there is sufficient stock for the last portion of an item.
        await _lock_stock_rows(db, deductions)

        # Step 4: check sufficiency for each deduction
        for d in deductions:
            current = await _get_current_quantity(db, d)
            if current + d.quantity_delta < 0:   # would go negative
                raise InsufficientStockError(
                    item_name=d.display_name,
                    available=current,
                    requested=abs(d.quantity_delta)
                )

        # Step 5: insert stock_movements + update current quantities atomically
        for d in deductions:
            before = await _get_current_quantity(db, d)
            after  = before + d.quantity_delta
            await _insert_movement(db, d, before, after, order.id, 'order_deduction')
            await _update_current_quantity(db, d, after)

            # Step 6: if after <= reorder_threshold, enqueue low-stock alert
            # (Celery task, fired AFTER transaction commits — not inside it)
            if after <= d.reorder_threshold:
                await enqueue_low_stock_alert.schedule_after_commit(d, cart_id)

            # Step 7: if after == 0, auto-set menu_item.is_available = false
            # closing the loop with the existing manual toggle (Part 8.2.1)
            if after <= 0 and mode == "item_level":
                await _set_item_unavailable(db, d.menu_item_id)
                await publish_menu_availability_change(cart_id, d.menu_item_id, False)
                # ↑ broadcasts via the cart's WS channel so open customer browsers
                #   immediately see the item greyed out without a page refresh

        return order
```

**`InsufficientStockError` handling (the UX consequence):** this should never surface as a raw 500 — the customer-facing response for this is a `422 Unprocessable Entity` with a clear `error.code = "ITEM_INSUFFICIENT_STOCK"` and `error.message = "Sorry, {item_name} just sold out. Please remove it from your order."` This is the same error code used whether deduction failed due to simultaneous orders exhausting a stock or due to the vendor not having set up inventory at all with sufficient opening count — the distinction matters in logs and admin tools, but the customer just needs to know what to remove from their order.

**Cancellation reversal:** when an order is cancelled while still in `placed` or `accepted` status (before kitchen prep has started — defined as: before the worker taps "preparing"), stock is **returned** via a symmetric `order_reversal` movement. Once the order is `preparing`, stock is not returned on cancellation — the ingredients have been used regardless of whether the order is picked up.

## 10.4 AI Integration — Inventory Intelligence

### 10.4.1 AI Low-Stock Alerts with Demand-Aware Timing

A naive low-stock alert fires when `current_quantity <= reorder_threshold` — but this treats threshold as a static number, which breaks down as soon as demand fluctuates. If a cart normally sells 30 Fuchka per day, a threshold of 20 portions makes sense. On a Friday night with a cricket match showing at the nearby tea stall, they might sell 80 — and an alert at 20 portions at 7pm means they're already out before they can do anything about it.

The AI improvement: **threshold becomes dynamic**, computed nightly per ingredient per cart based on the next period's demand forecast (Part 6.6's demand forecasting model) and a configurable `lead_time_hours` (how long it takes to get a restock — typically 30 min for a local supplier, set by the vendor):

```python
def compute_dynamic_reorder_point(
    ingredient_id: UUID,
    cart_id: UUID,
    demand_forecast_next_24h: float,   # predicted units of items containing this ingredient
    recipe_quantity_per_unit: float,   # from recipe_ingredients
    lead_time_hours: float,
    safety_stock_multiplier: float = 1.3,   # a configurable buffer (AI-suggested default, vendor-adjustable)
) -> float:
    consumption_per_hour = (demand_forecast_next_24h * recipe_quantity_per_unit) / 24
    lead_time_consumption = consumption_per_hour * lead_time_hours
    dynamic_reorder_point = lead_time_consumption * safety_stock_multiplier
    return dynamic_reorder_point

# Fallback if demand_forecast unavailable (new cart, AI service down):
# static reorder_threshold from ingredients table — always safe, never blocks operation
```

This dynamic reorder point is recomputed nightly by a Celery beat task and written back to `ingredients.reorder_threshold` (or a separate `dynamic_reorder_point` column if you want to preserve the vendor-set static value separately — the latter is the safer design, since overwriting the vendor's own setting without explanation is bad UX even when the AI is right).

### 10.4.2 AI Reorder Quantity & Timing Recommendation

When a low-stock alert fires (or proactively surfaced in the owner dashboard), the AI layer suggests not just *that* a restock is needed but *how much* to order and *when*:

```python
async def generate_reorder_recommendation(
    ingredient_id: UUID,
    cart_id: UUID,
    current_stock: float,
    forecaster: DemandForecaster,
    purchase_history: list[PurchasedOrder],
) -> ReorderRecommendation:
    # Project consumption over the next N days using demand forecast
    predicted_daily_consumption = await forecaster.predict_ingredient_consumption(
        ingredient_id, cart_id, horizon_days=7
    )
    # How many days of stock remain at current consumption rate
    days_remaining = current_stock / predicted_daily_consumption if predicted_daily_consumption > 0 else 999

    # Suggested order quantity: cover N days of forecasted demand + safety buffer
    suggested_quantity = predicted_daily_consumption * 5 * 1.2   # 5-day cover + 20% buffer

    # Use purchase history to check what the vendor typically buys (anchors on reality,
    # not just the model — if a vendor always orders in "1 bag = 5kg" units, don't suggest 3.7kg)
    typical_order_unit = derive_typical_order_unit(purchase_history, ingredient_id)
    suggested_quantity_rounded = round_to_typical_unit(suggested_quantity, typical_order_unit)

    return ReorderRecommendation(
        ingredient_id=ingredient_id,
        days_of_stock_remaining=round(days_remaining, 1),
        suggested_reorder_quantity=suggested_quantity_rounded,
        suggested_reorder_by=datetime.now() + timedelta(hours=max(0, days_remaining*24 - lead_time_hours)),
        preferred_supplier=ingredient.preferred_supplier,
        estimated_cost=suggested_quantity_rounded * ingredient.cost_per_unit,
        confidence="high" if forecaster.has_sufficient_history(cart_id) else "low",
    )
```

**The output of this function surfaces in the owner dashboard (10.6.2) and — for pro-tier vendors who opt in — can be sent as a proactive push/SMS notification:** *"You have ~4 hours of tamarind water left at current demand. Suggested restock: 2 litres from Karim Supplier. Tap to notify supplier."* That last "tap to notify supplier" is a simple pre-filled SMS deep-link to the supplier's phone, not an automated PO — the AI recommends, the human confirms, which is consistent with the restraint principle from Part 6.7 (no unilateral automated purchasing on the vendor's behalf).

### 10.4.3 Wastage Pattern Detection

Wastage is logged as `movement_type='wastage'` in `stock_movements`. Over time, wastage entries accumulate a pattern: which ingredients are wasted most, at what time of day, on which days of the week. The AI layer runs a lightweight anomaly detection pass over this history weekly:

```python
def analyze_wastage_patterns(cart_id: UUID, lookback_days: int = 30) -> WastageReport:
    movements = get_wastage_movements(cart_id, lookback_days)
    df = pd.DataFrame(movements)
    report = {}
    for ingredient_id, group in df.groupby("ingredient_id"):
        avg_daily_wastage = group["quantity_delta"].abs().sum() / lookback_days
        avg_daily_sales_consumption = get_sales_consumption(ingredient_id, cart_id, lookback_days)
        wastage_rate = avg_daily_wastage / (avg_daily_wastage + avg_daily_sales_consumption)
        if wastage_rate > 0.15:   # >15% wastage rate is flagged
            report[ingredient_id] = {
                "wastage_rate_pct": round(wastage_rate * 100, 1),
                "likely_cause": detect_pattern(group),
                # detect_pattern checks: is wastage concentrated at end-of-day? (over-prep)
                # is it concentrated on certain weekdays? (over-ordering for slow days)
                # is it a recent spike vs. historical average? (may be a new supplier quality issue)
            }
    return report
```

The output surfaces in the owner AI copilot digest (Part 6.6, now enriched with inventory data): *"Tamarind water has a 22% wastage rate this month — most of it thrown away at closing time on Sundays. Consider ordering 30% less on Saturdays."* This is a genuine food-business insight, not a generic dashboard number — it directly reduces a small vendor's costs.

### 10.4.4 Auto-disable / re-enable menu items (closing the loop with Part 8.2.1)

Already described in the deduction flow (10.3, Step 7): when item stock hits zero, `menu_items.is_available` is set `false` and broadcast via WS — no human needed. The reverse: when a `manual_restock` or `purchase_order` receipt pushes stock above zero, the system automatically re-enables the item and broadcasts the re-availability. This connects the inventory system to the existing `menu_item_availability_log` (Part 8.2.4), which now has two sources of entries: manual worker toggles (the old path) and system-triggered availability changes (the new path from inventory), distinguished by a new column:

```sql
ALTER TABLE menu_item_availability_log
    ADD COLUMN triggered_by_system BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN trigger_source VARCHAR(30);   -- 'inventory_depletion'|'inventory_restock'|'manual'
```


## 10.5 New REST API Endpoints

```
# Ingredients
GET    /v1/carts/{cart_id}/ingredients
POST   /v1/carts/{cart_id}/ingredients
         body: { name, name_bn, unit, cost_per_unit, reorder_threshold, reorder_quantity, preferred_supplier_id }
GET    /v1/ingredients/{ingredient_id}
PATCH  /v1/ingredients/{ingredient_id}
DELETE /v1/ingredients/{ingredient_id}    -- soft delete (is_active=false), only if no stock movements exist

# Recipes
GET    /v1/menu-items/{item_id}/recipe
POST   /v1/menu-items/{item_id}/recipe
         body: { ingredients: [{ ingredient_id, quantity_per_unit }] }
PATCH  /v1/menu-items/{item_id}/recipe    -- creates new version, marks old inactive

# Stock management
GET    /v1/carts/{cart_id}/stock
         → all ingredients with current_quantity, dynamic_reorder_point, status (ok/low/critical/out)
POST   /v1/carts/{cart_id}/stock/opening-count
         → bulk set opening quantities at shift start
         body: { counts: [{ ingredient_id, quantity }] }
         → creates 'opening_count' movement for each, establishes baseline for the day

POST   /v1/stock/movements                   [worker/owner/manager auth]
         body: { ingredient_id, movement_type, quantity_delta, notes }
         → used for manual adjustments and wastage logging from KDS/owner dashboard

GET    /v1/carts/{cart_id}/stock/movements?ingredient_id=&from=&to=&type=
         → paginated ledger — full audit trail, not just current level

POST   /v1/carts/{cart_id}/stock/count
         body: { counts: [{ ingredient_id, physical_count }] }
         → spot-count: compares physical_count to system current_quantity,
           auto-generates 'manual_adjustment' movements for any discrepancy,
           returns a discrepancy report showing variance amounts

# Purchase orders
GET    /v1/carts/{cart_id}/purchase-orders
POST   /v1/carts/{cart_id}/purchase-orders
PATCH  /v1/purchase-orders/{po_id}
POST   /v1/purchase-orders/{po_id}/receive
         body: { lines: [{ purchase_order_line_id, quantity_received }] }
         → triggers stock_movements of type 'manual_restock' for each received line
         → triggers auto-enable of any menu items that were out-of-stock on these ingredients

# Suppliers
GET    /v1/vendors/me/suppliers
POST   /v1/vendors/me/suppliers
PATCH  /v1/suppliers/{supplier_id}
DELETE /v1/suppliers/{supplier_id}

# AI inventory endpoints
GET    /v1/carts/{cart_id}/ai/inventory-alerts
         → current low-stock alerts enriched with AI reorder recommendations
GET    /v1/carts/{cart_id}/ai/wastage-report
         → 30-day wastage pattern analysis per ingredient
GET    /v1/carts/{cart_id}/ai/reorder-recommendations
         → AI-generated reorder quantity + timing suggestions for all ingredients currently flagged
```

## 10.6 Dashboard Additions

### 10.6.1 KDS (Cart Worker) additions

Add a persistent **stock-status strip** at the top of the KDS queue board (Part 8.1) — always visible without navigating away, since a worker needs to know what's low *while* processing the queue:

| Element | Data source | Behavior |
|---|---|---|
| `🟢 Stock OK` or `🟡 3 items low` or `🔴 2 items out` | aggregate of `ingredient_stock_levels` | taps open a compact list — which items are low/out, with a one-tap "log wastage" and "request restock from owner" button |
| Real-time auto-disable notification banner | WS message when a menu item is auto-disabled by the inventory system | e.g. *"Borhani is now out of stock and has been hidden from the customer menu"* — worker awareness, not action required |

New KDS endpoint:
```
GET /v1/kds/stock-status   → { ok_count, low_count, out_count, alerts: [...] }
```

Workers can also log wastage directly from the KDS without navigating to a separate screen: a long-press on any order item in the queue board opens a context menu with "Mark as wasted" (fires `POST /v1/stock/movements` with `movement_type='wastage'`). This is where most wastage data actually comes from in practice — a worker who has to open a separate inventory screen to log a dropped plate will never do it; a worker who long-presses and taps one button while standing at the cart will.

### 10.6.2 Cart Owner Dashboard additions (extends Part 8.2)

**New panel: Inventory Health** — placed between the "Today at a glance" (8.2.1) and the "Trends" (8.2.2) panels, since inventory issues are same-day-actionable just like revenue:

```
GET /v1/carts/{cart_id}/analytics/inventory-health?date=today
```

| Stat | Computation |
|---|---|
| Items currently out of stock | `COUNT(*) FROM ingredient_stock_levels JOIN ingredients WHERE current_quantity <= 0 AND cart_id=X` |
| Items at low stock (below threshold) | `current_quantity <= reorder_threshold AND current_quantity > 0` |
| Estimated hours of service remaining (lowest-stock bottleneck) | `MIN(current_quantity / predicted_hourly_consumption)` across ingredients with a recipe — the single most useful inventory number on the screen, i.e. "your lowest-stock item will run out in approximately 2.5 hours at current demand" |
| Total estimated wastage cost today | `SUM(ABS(quantity_delta) * cost_per_unit) FROM stock_movements WHERE type='wastage' AND DATE(created_at)=today` |
| Wastage as % of total consumption | `wastage / (wastage + order_deductions)` |

**New panel: Stock Ledger** (owner-only tab, not on KDS):
- Timeline chart: `current_quantity` over the past 7 days per ingredient, selectable, showing the saw-tooth pattern of deductions and restocks — good for a vendor to visually see if they're reordering at the right frequency.
- Discrepancy log: spot-counts where the physical count diverged from system quantity by >5%, flagged for review.

**New panel: AI Reorder Recommendations** (AI-generated, updates daily):
Cards, one per ingredient flagged by the AI, in order of urgency (`days_of_stock_remaining` ascending):

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️  Tamarind Water                      🔴 3.2 hrs remaining │
│ Current stock: 0.8 L                                         │
│ Predicted consumption rate: 0.25 L/hr (dinner rush tonight) │
│ Suggested order: 3 L from Karim Supplier                     │
│ Estimated cost: ৳ 180                                        │
│ [📞 Call Supplier]  [✅ Create PO]  [Dismiss]                │
└─────────────────────────────────────────────────────────────┘
```

The "Call Supplier" button is a `tel:` deep-link; "Create PO" pre-fills a `purchase_order` draft with the AI's suggested quantity, editable before submission — the human approves, the AI pre-fills.

### 10.6.3 Platform Admin Dashboard additions (extends Part 8.5)

Two additions to the Platform Admin view:

**Inventory usage as a tier-conversion signal:**
```
GET /v1/admin/analytics/inventory-adoption
```
Shows: % of free-tier vendors who have set up any inventory tracking, % who have set up ingredient-level recipes, average ingredients tracked per cart per tier — useful for the platform team to know if this feature is actually being used and whether to invest more in it or simplify the onboarding.

**Vendor COGS visibility (platform-level, pro-tier only):**
For pro-tier vendors who have cost_per_unit filled in for all ingredients, the platform admin can see approximate margin estimates per vendor (GMV − estimated COGS) — useful context when a vendor disputes their commission rate or requests a payout advance. This is opt-in for vendors (explicitly documented as part of the pro-tier data-sharing agreement) and accessed only by platform admins with a specific `analytics:vendor_cogs` permission that doesn't exist in the default admin role, to prevent routine support agents from seeing vendor margin data they don't need.

## 10.7 Changes to Existing Parts (what this Part modifies or extends)

| Existing section | Change |
|---|---|
| Part 2.3 (menu_items) | `avg_prep_time_seconds` column still exists; add `inventory_mode` ENUM ('none'/'item_level') as a per-item override for carts running ingredient-level globally |
| Part 2.4 (orders) | Order creation flow now calls inventory deduction within the same transaction (10.3) — `InsufficientStockError` maps to a new `422` response that the Part 3.1 client contract must handle |
| Part 3.1 (POST /carts/{slug}/orders) | Response may now include `stock_warning: {item_name, remaining_after_order}` when stock is low but not zero — useful for the customer UI to show "almost sold out" softly without refusing the order |
| Part 3.2 (KDS endpoints) | `PATCH /kds/menu-items/{item_id}/availability` still works (manual override always available) but now also logs a `menu_item_availability_log` entry with `trigger_source='manual'` |
| Part 6.2 (prep-time model) | Training features now include `ingredient_stock_level_at_order_time` per key ingredient — low stock is correlated with slower prep in practice (a vendor scrambling to stretch the last portion of an item is slower than one working normally), so this is a genuine predictor, not a forced inclusion |
| Part 6.6 (AI copilot digest) | Digest now includes wastage analysis and reorder recommendations alongside the existing operational insights — no schema changes, new SQL aggregations added to the Celery digest-generation job |
| Part 8.2.4 (menu_item_availability_log) | Schema amended with `triggered_by_system` and `trigger_source` columns (10.4.4) |
| Part 9.5 (eval harness) | Demand forecasting eval now also tracks ingredient consumption prediction accuracy (MAE in predicted vs. actual ingredient consumption per day per cart) as a separate tracked metric, since the reorder recommendation (10.4.2) is only as good as the underlying consumption forecast |
# Part 11: Implementation Architecture — Django DRF Backend + React Frontend

This Part re-architects the *implementation layer* for Django REST Framework + React, replacing the FastAPI stack from Part 1.5. The data model (Part 2), API contract (Part 3), real-time design (Part 4), payment abstraction (Part 5), AI systems (Parts 6, 9), dashboards (Part 8), and inventory system (Part 10) all remain unchanged — this Part specifies *how they are built*, not what they do.

---

## 11.1 Stack Decision Rationale

| Concern | FastAPI (original) | Django DRF (this Part) |
|---|---|---|
| WebSockets | `fastapi.WebSocket` native | Django Channels (ASGI layer on top of Django) |
| ORM | SQLAlchemy async | Django ORM (sync, with async support via `sync_to_async`) |
| Migrations | Alembic | Django migrations (built-in, simpler to operate) |
| Validation | Pydantic v2 | DRF Serializers + `django-pydantic-field` for JSONB fields |
| Admin console | Custom-built (Part 7.1) | Django Admin (extended with `django-unfold` for modern UI) + custom views |
| Auth | Manual JWT | `djangorestframework-simplejwt` + custom OTP flow |
| Background tasks | Celery (unchanged) | Celery (unchanged) |
| Row-Level Security | Postgres RLS via SQLAlchemy `set_session_variable` | Postgres RLS via `connection.set_autocommit` + raw `SET LOCAL` |

**What changes and what does not:**
- Django Channels replaces the separate FastAPI Realtime Gateway — one fewer deployable service.
- Django's built-in admin, extended with `django-unfold`, handles a significant portion of Part 7's platform admin console without building it from scratch.
- The AI Inference Service (Part 6.1, Part 9) stays as a **separate FastAPI service** — Django is not a good host for ML model inference (heavy model loading, GPU resource management, async inference batching). The Core API talks to it over internal HTTP exactly as specified in Part 6.1. This is the one hybrid piece of the stack and is intentional.
- Everything else — Celery workers, Redis, PostgreSQL, payment adapters, S3 storage — is identical.

---

## 11.2 Repository Structure

```
CartCloud/
├── backend/                          ← Django DRF monorepo
│   ├── manage.py
│   ├── config/
│   │   ├── settings/
│   │   │   ├── base.py               ← shared settings
│   │   │   ├── development.py
│   │   │   ├── production.py
│   │   │   └── test.py
│   │   ├── urls.py                   ← root URL conf
│   │   ├── asgi.py                   ← Django Channels entry point
│   │   └── wsgi.py                   ← standard WSGI (used by gunicorn for REST)
│   │
│   ├── apps/
│   │   ├── customers/                ← Customer identity, sessions, OTP
│   │   │   ├── models.py
│   │   │   ├── serializers.py
│   │   │   ├── views.py
│   │   │   ├── urls.py
│   │   │   └── tests/
│   │   ├── vendors/                  ← Vendor + Cart + QR
│   │   ├── menus/                    ← Menu, Category, Item, Options
│   │   ├── orders/                   ← Order lifecycle, status FSM
│   │   ├── payments/                 ← Gateway abstraction + webhooks
│   │   ├── inventory/                ← Part 10 — ingredients, recipes, stock ledger
│   │   ├── notifications/            ← Push subscriptions, SMS, notification log
│   │   ├── kds/                      ← Kitchen Display System endpoints + device pairing
│   │   ├── analytics/                ← Analytics aggregation queries + cache
│   │   ├── ai_client/                ← Internal HTTP client to AI Inference Service
│   │   ├── admin_console/            ← Platform admin extended views + custom DRF endpoints
│   │   └── realtime/                 ← Django Channels consumers (WebSocket handlers)
│   │
│   ├── core/
│   │   ├── permissions.py            ← RBAC permission classes
│   │   ├── authentication.py         ← JWT + device-token authenticators
│   │   ├── middleware.py             ← Tenant context middleware (sets app.current_vendor_id)
│   │   ├── pagination.py             ← Cursor + offset paginators
│   │   ├── exceptions.py             ← Custom exception handlers → consistent error envelope
│   │   ├── throttles.py              ← Per-endpoint rate limiters
│   │   └── utils/
│   │       ├── rls.py                ← Postgres RLS session variable helpers
│   │       └── idempotency.py        ← Redis-backed idempotency key handler
│   │
│   ├── payments/
│   │   └── adapters/
│   │       ├── base.py               ← PaymentGateway ABC (Part 5.2)
│   │       ├── bkash.py
│   │       ├── nagad.py
│   │       ├── sslcommerz.py
│   │       └── stripe_adapter.py
│   │
│   ├── celery_app.py                 ← Celery application instance
│   ├── tasks/
│   │   ├── notifications.py          ← send_order_ready_alert, SMS fallback
│   │   ├── analytics.py              ← nightly aggregation, analytics_cache writes
│   │   ├── ai_batch.py               ← prep-time model retraining triggers, copilot digest
│   │   ├── payouts.py                ← payout batch processing
│   │   └── inventory.py              ← dynamic reorder point recompute, wastage analysis
│   │
│   └── requirements/
│       ├── base.txt
│       ├── development.txt
│       └── production.txt
│
├── ai_service/                       ← Separate FastAPI AI Inference Service (Part 6.1)
│   ├── main.py
│   ├── routers/
│   │   ├── prep_time.py
│   │   ├── queue_optimizer.py
│   │   ├── voice_order.py
│   │   └── fraud.py
│   ├── models/                       ← Trained model artifacts + loaders
│   └── requirements.txt
│
├── frontend/                         ← React monorepo (Vite)
│   ├── apps/
│   │   ├── customer-pwa/             ← Customer ordering PWA
│   │   ├── kds/                      ← Kitchen Display System
│   │   ├── owner-dashboard/          ← Vendor owner + manager
│   │   └── admin-console/            ← Platform admin
│   ├── packages/
│   │   ├── ui/                       ← Shared component library
│   │   ├── api-client/               ← Auto-generated from OpenAPI schema (drf-spectacular)
│   │   ├── hooks/                    ← Shared React Query hooks
│   │   └── ws-client/                ← WebSocket connection manager
│   └── package.json
│
├── nginx/
│   └── nginx.conf
├── docker-compose.yml                ← dev environment
├── docker-compose.prod.yml
└── .github/workflows/ci.yml
```

---

## 11.3 Django Settings & Core Configuration

```python
# config/settings/base.py
from pathlib import Path
import environ

env = environ.Env()
BASE_DIR = Path(__file__).resolve().parent.parent.parent

INSTALLED_APPS = [
    # Django
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.sessions",
    # Third-party
    "unfold",                       # must come before django.contrib.admin
    "django.contrib.admin",
    "rest_framework",
    "rest_framework_simplejwt",
    "channels",                     # Django Channels
    "corsheaders",
    "django_filters",
    "drf_spectacular",              # OpenAPI schema generation
    "django_celery_beat",
    # Apps
    "apps.customers",
    "apps.vendors",
    "apps.menus",
    "apps.orders",
    "apps.payments",
    "apps.inventory",
    "apps.notifications",
    "apps.kds",
    "apps.analytics",
    "apps.ai_client",
    "apps.admin_console",
    "apps.realtime",
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("DB_NAME"),
        "USER": env("DB_USER"),
        "PASSWORD": env("DB_PASSWORD"),
        "HOST": env("DB_HOST"),
        "PORT": env("DB_PORT", default="5432"),
        "OPTIONS": {
            "options": "-c default_transaction_isolation=read committed"
        },
        "CONN_MAX_AGE": 60,
    },
    "replica": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("DB_REPLICA_NAME", default=env("DB_NAME")),
        "HOST": env("DB_REPLICA_HOST", default=env("DB_HOST")),
        # ... same creds
    }
}
DATABASE_ROUTERS = ["core.db_router.AnalyticsReadReplicaRouter"]

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [env("REDIS_URL")]},
    }
}

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "core.authentication.CustomerJWTAuthentication",
        "core.authentication.StaffJWTAuthentication",
        "core.authentication.KDSDeviceTokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "core.pagination.StandardResultsPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "core.exceptions.CartCloud_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"anon": "100/min"},
}

SPECTACULAR_SETTINGS = {
    "TITLE": "CartCloud API",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
}

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": env("REDIS_URL"),
        "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
    }
}

CELERY_BROKER_URL = env("REDIS_URL")
CELERY_RESULT_BACKEND = env("REDIS_URL")
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"

DEFAULT_AUTO_FIELD = "django.db.models.UUIDField"
AUTH_USER_MODEL = "customers.StaffUser"   # staff_users table (Part 2.2)
```

### 11.3.1 ASGI entry point (Django Channels)

```python
# config/asgi.py
import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from apps.realtime.middleware import JWTAuthMiddlewareStack
from apps.realtime.routing import websocket_urlpatterns

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.production")

application = ProtocolTypeRouter({
    "http": get_asgi_application(),       # regular Django for REST
    "websocket": AllowedHostsOriginValidator(
        JWTAuthMiddlewareStack(
            URLRouter(websocket_urlpatterns)
        )
    ),
})
```

---

## 11.4 Core Infrastructure

### 11.4.1 Tenant Middleware (RLS enforcement)

```python
# core/middleware.py
from django.db import connection

class TenantMiddleware:
    """
    Reads vendor_id from the authenticated user's JWT claims (for staff) or
    from the cart's vendor_id (for customer-facing endpoints) and sets the
    Postgres session variable that Row-Level Security policies key off.
    Must run AFTER authentication middleware.
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        return response

    def process_view(self, request, view_func, view_args, view_kwargs):
        vendor_id = self._resolve_vendor_id(request)
        if vendor_id:
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL app.current_vendor_id = %s", [str(vendor_id)])
        return None

    def _resolve_vendor_id(self, request):
        if hasattr(request, "user") and hasattr(request.user, "current_vendor_id"):
            return request.user.current_vendor_id   # set by JWT auth class on login
        if "cart_id" in request.resolver_match.kwargs:
            from apps.vendors.models import Cart
            try:
                return Cart.objects.values_list("vendor_id", flat=True).get(
                    pk=request.resolver_match.kwargs["cart_id"]
                )
            except Cart.DoesNotExist:
                return None
        return None
```

### 11.4.2 RBAC Permission Classes

```python
# core/permissions.py
from rest_framework.permissions import BasePermission

class HasPermission(BasePermission):
    """
    Usage: permission_classes = [HasPermission("order:update_status")]
    Checks: authenticated user → role assignments → permission strings →
            scope match (vendor_id / cart_id in URL matches assignment scope)
    """
    def __init__(self, required_permission: str):
        self.required_permission = required_permission

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.is_platform_admin:
            return True    # admins bypass all permission checks
        return request.user.has_CartCloud_permission(
            self.required_permission,
            vendor_id=view.kwargs.get("vendor_id"),
            cart_id=view.kwargs.get("cart_id"),
        )

def permission_class(perm: str):
    """Factory — creates a permission class instance for a given permission string."""
    return type(f"Has_{perm.replace(':', '_')}", (HasPermission,), {"required_permission": perm})()
```

### 11.4.3 Consistent error envelope

```python
# core/exceptions.py
from rest_framework.views import exception_handler
from rest_framework.response import Response

def CartCloud_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return None
    return Response({
        "data": None,
        "meta": None,
        "error": {
            "code": getattr(exc, "default_code", "error").upper(),
            "message": str(exc.detail) if hasattr(exc, "detail") else str(exc),
            "field_errors": exc.detail if isinstance(exc.detail, dict) else {},
        }
    }, status=response.status_code)
```

### 11.4.4 Database router (analytics → read replica)

```python
# core/db_router.py
ANALYTICS_APPS = {"analytics"}

class AnalyticsReadReplicaRouter:
    def db_for_read(self, model, **hints):
        if model._meta.app_label in ANALYTICS_APPS:
            return "replica"
        return "default"

    def db_for_write(self, model, **hints):
        return "default"

    def allow_migrate(self, db, app_label, **hints):
        return db == "default"
```

---

## 11.5 Django Models (representative, covering all Parts)

Rather than reprinting the full SQL schema from Part 2 as Django models verbatim, this section shows the model structure, important `Meta` options, and Django-specific implementation choices.

```python
# apps/customers/models.py
import uuid
from django.db import models
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin

class Customer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone_number = models.CharField(max_length=20, unique=True, db_index=True)
    display_name = models.CharField(max_length=100)
    phone_verified = models.BooleanField(default=False)
    preferred_language = models.CharField(max_length=8, default="bn")
    marketing_opt_in = models.BooleanField(default=True)
    is_blocked = models.BooleanField(default=False)
    blocked_reason = models.TextField(blank=True)
    risk_score = models.SmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customers"
        indexes = [models.Index(fields=["phone_number"])]


class StaffUser(AbstractBaseUser, PermissionsMixin):
    """Replaces Django's default User — used for Cart Owners, Workers, Admins."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone_number = models.CharField(max_length=20, unique=True, null=True, blank=True)
    email = models.EmailField(unique=True, null=True, blank=True)
    full_name = models.CharField(max_length=150)
    is_platform_admin = models.BooleanField(default=False)
    is_support_agent = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    totp_secret_encrypted = models.CharField(max_length=255, blank=True)
    last_login_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]

    class Meta:
        db_table = "staff_users"

    def has_CartCloud_permission(self, permission: str, vendor_id=None, cart_id=None) -> bool:
        """Checks role assignments scoped to the given vendor/cart."""
        assignments = self.role_assignments.select_related("role").filter(
            models.Q(vendor_id=vendor_id) | models.Q(vendor_id__isnull=True)
        )
        if cart_id:
            assignments = assignments.filter(
                models.Q(cart_id=cart_id) | models.Q(cart_id__isnull=True)
            )
        for assignment in assignments:
            if permission in assignment.role.permissions:
                return True
        return False


# apps/vendors/models.py
class Vendor(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business_name = models.CharField(max_length=150)
    owner = models.ForeignKey(StaffUser, on_delete=models.PROTECT, related_name="owned_vendors")
    registration_status = models.CharField(max_length=20, default="pending")
    kyc_document_url = models.TextField(blank=True)
    tax_id = models.CharField(max_length=50, blank=True)
    settlement_account_json = models.JSONField(default=dict)  # encrypted at app layer
    platform_commission_pct = models.DecimalField(max_digits=5, decimal_places=2, default=5.00)
    default_timezone = models.CharField(max_length=50, default="Asia/Dhaka")
    default_currency = models.CharField(max_length=8, default="BDT")
    subscription_tier = models.CharField(max_length=20, default="free")
    created_at = models.DateTimeField(auto_now_add=True)
    suspended_at = models.DateTimeField(null=True, blank=True)
    suspension_reason = models.TextField(blank=True)

    class Meta:
        db_table = "vendors"


class Cart(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vendor = models.ForeignKey(Vendor, on_delete=models.CASCADE, related_name="carts")
    name = models.CharField(max_length=150)
    public_slug = models.SlugField(max_length=80, unique=True)
    qr_token = models.CharField(max_length=64)
    qr_token_version = models.SmallIntegerField(default=1)
    location_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True)
    location_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True)
    address_text = models.CharField(max_length=255, blank=True)
    is_open = models.BooleanField(default=False)
    is_accepting_online_orders = models.BooleanField(default=True)
    accepts_cash = models.BooleanField(default=True)
    accepts_online_payment = models.BooleanField(default=False)
    avg_prep_time_seconds = models.IntegerField(default=600)
    max_concurrent_orders = models.SmallIntegerField(default=10)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "carts"


# apps/orders/models.py
class OrderStatus(models.TextChoices):
    PENDING_PAYMENT   = "pending_payment"
    PLACED            = "placed"
    ACCEPTED          = "accepted"
    PREPARING         = "preparing"
    READY             = "ready"
    COMPLETED         = "completed"
    CANCELLED_CUSTOMER = "cancelled_by_customer"
    CANCELLED_VENDOR  = "cancelled_by_vendor"
    PAYMENT_FAILED    = "payment_failed"

VALID_TRANSITIONS = {
    OrderStatus.PENDING_PAYMENT:    [OrderStatus.PLACED, OrderStatus.PAYMENT_FAILED],
    OrderStatus.PLACED:             [OrderStatus.ACCEPTED, OrderStatus.CANCELLED_CUSTOMER, OrderStatus.CANCELLED_VENDOR],
    OrderStatus.ACCEPTED:           [OrderStatus.PREPARING, OrderStatus.CANCELLED_VENDOR],
    OrderStatus.PREPARING:          [OrderStatus.READY],
    OrderStatus.READY:              [OrderStatus.COMPLETED],
    OrderStatus.COMPLETED:          [],
    OrderStatus.CANCELLED_CUSTOMER: [],
    OrderStatus.CANCELLED_VENDOR:   [],
    OrderStatus.PAYMENT_FAILED:     [],
}

class Order(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_number = models.CharField(max_length=20)
    cart = models.ForeignKey("vendors.Cart", on_delete=models.PROTECT, related_name="orders")
    vendor = models.ForeignKey("vendors.Vendor", on_delete=models.PROTECT)
    customer = models.ForeignKey("customers.Customer", on_delete=models.PROTECT)
    guest_display_name = models.CharField(max_length=100)
    status = models.CharField(max_length=30, choices=OrderStatus.choices, default=OrderStatus.PLACED)
    payment_method = models.CharField(max_length=20)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    platform_fee = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=8, default="BDT")
    special_instructions = models.TextField(blank=True)
    estimated_ready_at = models.DateTimeField(null=True)
    estimated_ready_at_initial = models.DateTimeField(null=True)
    queue_position = models.SmallIntegerField(null=True)
    placed_via = models.CharField(max_length=20, default="qr_web")
    accepted_at = models.DateTimeField(null=True)
    ready_at = models.DateTimeField(null=True)
    completed_at = models.DateTimeField(null=True)
    cancelled_at = models.DateTimeField(null=True)
    cancellation_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "orders"
        indexes = [
            models.Index(fields=["cart", "status"]),
            models.Index(fields=["customer"]),
        ]

    def transition_to(self, new_status: str, triggered_by=None, system_source: str = ""):
        if new_status not in VALID_TRANSITIONS.get(self.status, []):
            raise ValueError(f"Invalid transition: {self.status} → {new_status}")
        old_status = self.status
        self.status = new_status
        # Timestamp bookkeeping
        from django.utils import timezone
        now = timezone.now()
        if new_status == OrderStatus.ACCEPTED:    self.accepted_at = now
        if new_status == OrderStatus.READY:       self.ready_at = now
        if new_status == OrderStatus.COMPLETED:   self.completed_at = now
        if new_status in (OrderStatus.CANCELLED_CUSTOMER, OrderStatus.CANCELLED_VENDOR):
            self.cancelled_at = now
        self.save(update_fields=["status", "accepted_at", "ready_at", "completed_at",
                                 "cancelled_at", "updated_at"])
        OrderStatusEvent.objects.create(
            order=self, from_status=old_status, to_status=new_status,
            triggered_by_user=triggered_by, triggered_by_system=system_source,
        )
        return self
```

---

## 11.6 DRF Serializers (key patterns)

```python
# apps/orders/serializers.py
from rest_framework import serializers
from .models import Order, OrderItem

class OrderItemRequestSerializer(serializers.Serializer):
    menu_item_id = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1, max_value=20)
    selected_option_choice_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list
    )

class CreateOrderSerializer(serializers.Serializer):
    items = OrderItemRequestSerializer(many=True, min_length=1)
    payment_method = serializers.ChoiceField(choices=["cash", "bkash", "nagad", "sslcommerz", "stripe"])
    special_instructions = serializers.CharField(max_length=500, required=False, allow_blank=True)

    def validate_items(self, items):
        if not items:
            raise serializers.ValidationError("At least one item is required.")
        return items

class OrderStatusSerializer(serializers.ModelSerializer):
    """Read serializer — sent to customer, includes live countdown fields."""
    seconds_until_ready = serializers.SerializerMethodField()
    queue_position = serializers.IntegerField()

    class Meta:
        model = Order
        fields = [
            "id", "order_number", "status", "total", "currency",
            "payment_method", "estimated_ready_at", "seconds_until_ready",
            "queue_position", "guest_display_name", "placed_via", "created_at",
        ]

    def get_seconds_until_ready(self, obj):
        if obj.estimated_ready_at is None:
            return None
        from django.utils import timezone
        delta = (obj.estimated_ready_at - timezone.now()).total_seconds()
        return max(0, int(delta))


# apps/menus/serializers.py
class MenuItemOptionChoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = MenuItemOptionChoice
        fields = ["id", "label", "price_delta", "is_default"]

class MenuItemOptionSerializer(serializers.ModelSerializer):
    choices = MenuItemOptionChoiceSerializer(many=True, read_only=True)
    class Meta:
        model = MenuItemOption
        fields = ["id", "option_group_name", "is_required", "allows_multiple", "sort_order", "choices"]

class MenuItemSerializer(serializers.ModelSerializer):
    options = MenuItemOptionSerializer(many=True, read_only=True)
    class Meta:
        model = MenuItem
        fields = [
            "id", "name", "name_bn", "description", "price", "image_url",
            "is_available", "dietary_tags", "sort_order", "options",
        ]

class MenuCategorySerializer(serializers.ModelSerializer):
    items = MenuItemSerializer(many=True, read_only=True)
    class Meta:
        model = MenuCategory
        fields = ["id", "name", "sort_order", "items"]

class PublicMenuSerializer(serializers.Serializer):
    """The full menu tree returned to the customer on cart page load."""
    cart_name = serializers.CharField()
    is_open = serializers.BooleanField()
    accepts_cash = serializers.BooleanField()
    accepts_online_payment = serializers.BooleanField()
    estimated_wait_seconds = serializers.IntegerField()
    categories = MenuCategorySerializer(many=True)
```

---

## 11.7 DRF Views — key patterns for each surface

### 11.7.1 Customer-facing views

```python
# apps/customers/views.py
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework import status

class CustomerIdentifyView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [OTPThrottle]    # custom: 5/min per IP, 3/min per phone

    def post(self, request):
        phone = request.data.get("phone_number")
        name = request.data.get("display_name")
        device_id = request.data.get("device_id")

        customer, created = Customer.objects.get_or_create(
            phone_number=normalize_phone(phone),
            defaults={"display_name": name}
        )
        session = CustomerSession.objects.filter(
            customer=customer,
            device_fingerprint_hash=hash_device(device_id),
            expires_at__gt=timezone.now(),
            revoked_at__isnull=True,
        ).first()

        if session:   # known device — skip OTP
            tokens = issue_customer_tokens(customer, session)
            return Response({"data": {"otp_required": False, **tokens}})

        otp_session_id = send_otp(phone)
        cache.set(f"otp:{otp_session_id}:customer_id", str(customer.id), timeout=300)
        return Response({"data": {"otp_required": True, "otp_session_id": otp_session_id}})


# apps/orders/views.py
class CreateOrderView(APIView):
    permission_classes = [IsCustomerAuthenticated]

    def post(self, request, public_slug):
        cart = get_object_or_404(Cart, public_slug=public_slug, is_open=True)
        serializer = CreateOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Idempotency (Part 3.6)
        idempotency_key = request.headers.get("Idempotency-Key")
        if idempotency_key:
            cached_order_id = cache.get(f"idem:{idempotency_key}")
            if cached_order_id:
                order = Order.objects.get(id=cached_order_id)
                return Response({"data": OrderStatusSerializer(order).data})

        with transaction.atomic():
            order = OrderService.create(
                cart=cart,
                customer=request.user,
                validated_data=serializer.validated_data,
            )    # ← handles pricing, inventory deduction (Part 10.3), AI ETA call

        if idempotency_key:
            cache.set(f"idem:{idempotency_key}", str(order.id), timeout=600)

        # Async: publish to WS channel, enqueue push subscription registration prompt
        async_to_sync(channel_layer.group_send)(
            f"cart_{cart.id}_queue",
            {"type": "new_order", "order_id": str(order.id)}
        )

        payment_data = {}
        if order.payment_method != "cash":
            gw = get_gateway(order.payment_method)
            result = gw.initiate(order, float(order.total), order.currency,
                                 return_url=f"{settings.FRONTEND_URL}/orders/{order.id}/payment-return")
            payment_data = {"redirect_url": result.redirect_url, "client_secret": result.client_secret}

        return Response({
            "data": {**OrderStatusSerializer(order).data, "payment": payment_data}
        }, status=status.HTTP_201_CREATED)
```

### 11.7.2 KDS views

```python
# apps/kds/views.py
class KDSQueueView(APIView):
    permission_classes = [IsKDSDeviceOrWorker]

    def get(self, request):
        cart_id = request.auth_context["cart_id"]
        # Active orders, AI-sequenced (from Redis-cached score, Part 6.3)
        orders = Order.objects.filter(
            cart_id=cart_id,
            status__in=["placed", "accepted", "preparing"]
        ).select_related("customer").prefetch_related("items__menu_item")
        # Fetch AI sequence from cache; fall back to FIFO if unavailable
        sequence = cache.get(f"queue_sequence:{cart_id}") or {}
        orders_sorted = sorted(orders, key=lambda o: sequence.get(str(o.id), 0), reverse=True)
        return Response({"data": KDSOrderSerializer(orders_sorted, many=True).data})


class KDSOrderStatusView(APIView):
    permission_classes = [IsKDSDeviceOrWorker]

    def patch(self, request, order_id):
        order = get_object_or_404(Order, id=order_id, cart__id=request.auth_context["cart_id"])
        new_status = request.data.get("status")
        try:
            order.transition_to(new_status, triggered_by=request.user)
        except ValueError as e:
            return Response({"error": {"code": "INVALID_TRANSITION", "message": str(e)}}, status=400)

        # Broadcast to WS (Part 4.3 step 5b)
        async_to_sync(channel_layer.group_send)(
            f"order_{order_id}_updates",
            {"type": "order_status_update", "status": new_status,
             "estimated_ready_at": order.estimated_ready_at.isoformat() if order.estimated_ready_at else None}
        )

        # If ready → fire push notification (Part 4.3 step 5c)
        if new_status == OrderStatus.READY:
            send_order_ready_alert.delay(str(order_id))

        return Response({"data": OrderStatusSerializer(order).data})
```

### 11.7.3 Owner dashboard views (ViewSets)

```python
# apps/vendors/views.py
from rest_framework import viewsets, mixins

class CartViewSet(viewsets.ModelViewSet):
    permission_classes = [permission_class("menu:edit")]

    def get_queryset(self):
        return Cart.objects.filter(vendor__owner=self.request.user)

    def perform_create(self, serializer):
        vendor = self.request.user.owned_vendors.first()
        serializer.save(vendor=vendor, public_slug=generate_slug(serializer.validated_data["name"]),
                        qr_token=secrets.token_urlsafe(32))


class MenuItemViewSet(viewsets.ModelViewSet):
    permission_classes = [permission_class("menu:edit")]
    serializer_class = MenuItemSerializer

    def get_queryset(self):
        return MenuItem.objects.filter(
            category__menu__cart__vendor__owner=self.request.user
        )

    def update(self, request, *args, **kwargs):
        # Optimistic concurrency (Part 3.6)
        if_match = request.headers.get("If-Match")
        instance = self.get_object()
        if if_match and if_match != instance.updated_at.isoformat():
            return Response({"error": {"code": "CONFLICT", "message": "Item modified since last fetch"}}, status=409)
        return super().update(request, *args, **kwargs)


# apps/analytics/views.py
class CartAnalyticsSummaryView(APIView):
    permission_classes = [permission_class("analytics:view")]

    def get(self, request, cart_id):
        # Hit read replica (via DB router)
        range_param = request.query_params.get("range", "today")
        # Try analytics_cache first (Part 8.6)
        cache_key = f"analytics:summary:{cart_id}:{range_param}"
        cached = cache.get(cache_key)
        if cached:
            return Response({"data": cached})
        data = AnalyticsService.get_summary(cart_id=cart_id, range_param=range_param)
        cache.set(cache_key, data, timeout=300)   # 5-min TTL for "today"; longer for historical
        return Response({"data": data})
```

---

## 11.8 Django Channels — WebSocket Consumers

```python
# apps/realtime/consumers.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer

class OrderStatusConsumer(AsyncWebsocketConsumer):
    """
    Customer-facing: live order status + countdown.
    URL: wss://api.CartCloud.app/ws/orders/{order_id}/
    """
    async def connect(self):
        self.order_id = self.scope["url_route"]["kwargs"]["order_id"]
        # Verify the customer owns this order (from JWT in scope, set by JWTAuthMiddleware)
        customer = self.scope.get("customer")
        if not customer:
            await self.close(code=4001)
            return
        from apps.orders.models import Order
        from channels.db import database_sync_to_async
        try:
            order = await database_sync_to_async(
                Order.objects.select_related("customer").get
            )(id=self.order_id, customer=customer)
        except Order.DoesNotExist:
            await self.close(code=4003)
            return

        self.group_name = f"order_{self.order_id}_updates"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # Send current state immediately on connect (resync after disconnect, Part 4.4)
        await self.send(json.dumps({
            "type": "order_state_sync",
            "status": order.status,
            "estimated_ready_at": order.estimated_ready_at.isoformat() if order.estimated_ready_at else None,
            "queue_position": order.queue_position,
        }))

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    # Handler called by channel_layer.group_send() from REST views / Celery tasks
    async def order_status_update(self, event):
        await self.send(json.dumps({
            "type": "order_status_update",
            "status": event["status"],
            "estimated_ready_at": event.get("estimated_ready_at"),
        }))

    async def order_eta_update(self, event):
        await self.send(json.dumps({
            "type": "order_eta_update",
            "estimated_ready_at": event["estimated_ready_at"],
            "reason": event.get("reason", ""),
        }))


class CartCloudueueConsumer(AsyncWebsocketConsumer):
    """
    KDS-facing: live queue board for a specific cart.
    URL: wss://api.CartCloud.app/ws/kds/{cart_id}/queue/
    Auth: KDS device token (set by JWTAuthMiddleware from X-Device-Token header)
    """
    async def connect(self):
        self.cart_id = self.scope["url_route"]["kwargs"]["cart_id"]
        if not self.scope.get("kds_device"):
            await self.close(code=4001)
            return
        self.group_name = f"cart_{self.cart_id}_queue"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def new_order(self, event):
        await self.send(json.dumps({"type": "new_order", "order_id": event["order_id"]}))

    async def queue_resequenced(self, event):
        await self.send(json.dumps({"type": "queue_resequenced", "sequence": event["sequence"]}))

    async def menu_availability_change(self, event):
        await self.send(json.dumps({
            "type": "menu_availability_change",
            "menu_item_id": event["menu_item_id"],
            "is_available": event["is_available"],
        }))


# apps/realtime/routing.py
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r"ws/orders/(?P<order_id>[0-9a-f-]+)/$", consumers.OrderStatusConsumer.as_asgi()),
    re_path(r"ws/kds/(?P<cart_id>[0-9a-f-]+)/queue/$", consumers.CartCloudueueConsumer.as_asgi()),
    re_path(r"ws/vendor/(?P<vendor_id>[0-9a-f-]+)/dashboard/$", consumers.VendorDashboardConsumer.as_asgi()),
]
```

---

## 11.9 URL Configuration

```python
# config/urls.py
from django.contrib import admin
from django.urls import path, include
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView, SpectacularRedocView

urlpatterns = [
    # Django admin (platform admin — extends unfold, Part 11.10)
    path("django-admin/", admin.site.urls),

    # API v1
    path("v1/", include([
        path("", include("apps.customers.urls")),
        path("", include("apps.vendors.urls")),
        path("", include("apps.menus.urls")),
        path("", include("apps.orders.urls")),
        path("", include("apps.payments.urls")),
        path("", include("apps.kds.urls")),
        path("", include("apps.inventory.urls")),
        path("", include("apps.notifications.urls")),
        path("analytics/", include("apps.analytics.urls")),
        path("ai/", include("apps.ai_client.urls")),
        path("admin/", include("apps.admin_console.urls")),
    ])),

    # OpenAPI
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path("docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]
```

---

## 11.10 Django Admin Extension (Platform Admin Console — Part 7.1)

```python
# apps/admin_console/admin.py
from unfold.admin import ModelAdmin
from unfold.decorators import action
from django.contrib import admin
from apps.vendors.models import Vendor, Cart
from apps.orders.models import Order

@admin.register(Vendor)
class VendorAdmin(ModelAdmin):
    list_display = ["business_name", "registration_status", "subscription_tier",
                    "created_at", "gmv_badge"]
    list_filter = ["registration_status", "subscription_tier"]
    search_fields = ["business_name", "owner__email", "owner__phone_number"]
    readonly_fields = ["created_at", "suspended_at"]

    @action(description="Suspend vendor", url_path="suspend")
    def suspend_vendor(self, request, queryset):
        reason = request.POST.get("reason", "Policy violation")
        from django.utils import timezone
        queryset.update(registration_status="suspended", suspended_at=timezone.now(),
                        suspension_reason=reason)
        self.message_user(request, f"Suspended {queryset.count()} vendors.")

    def gmv_badge(self, obj):
        from apps.analytics.services import get_vendor_gmv
        return f"৳{get_vendor_gmv(obj.id, '30d'):,.0f}"
    gmv_badge.short_description = "GMV (30d)"


@admin.register(Order)
class OrderAdmin(ModelAdmin):
    list_display = ["order_number", "cart", "status", "total", "payment_method", "created_at"]
    list_filter = ["status", "payment_method"]
    search_fields = ["order_number", "customer__phone_number", "cart__name"]
    raw_id_fields = ["cart", "customer", "vendor"]
    # Platform admins can view cross-tenant; RLS bypassed via BYPASSRLS Postgres role
    # (Django admin uses a separate DB connection with the admin role — set in settings)
```

The `unfold` package provides a modern Tailwind-based skin over Django admin, which handles 80% of the platform admin console functionality (vendor CRUD, order browse, user management) without writing a separate frontend. The remaining 20% (live ops map, fraud queue with AI narratives, batch payout controls, platform analytics charts) are custom React pages in `frontend/apps/admin-console/` that call the `/v1/admin/*` DRF endpoints.

---

## 11.11 React Frontend Architecture

Four separate React apps under one monorepo, built with **Vite**, sharing a component library and API client.

### 11.11.1 Shared packages

```
frontend/packages/
├── ui/                    ← shadcn/ui base + CartCloud design tokens
│   ├── components/
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── StatusBadge.tsx   ← order status → color + label mapping
│   │   ├── CountdownTimer.tsx ← the live ETA display (accepts estimatedReadyAt ISO string, ticks client-side)
│   │   └── ...
│   └── tokens.css
│
├── api-client/            ← auto-generated from drf-spectacular OpenAPI output
│   ├── generated/         ← `openapi-typescript-codegen` output — never hand-edited
│   └── index.ts           ← re-exports with sensible defaults (base URL, auth header injection)
│
├── hooks/
│   ├── useOrder.ts        ← React Query hook: GET /orders/{id} with WS overlay
│   ├── useCart.ts
│   ├── useMenu.ts
│   └── useAuth.ts
│
└── ws-client/
    ├── WSManager.ts       ← singleton WS connection per URL, auto-reconnect with
    │                         exponential backoff, heartbeat, fallback-to-polling trigger
    └── useWebSocket.ts    ← React hook wrapping WSManager
```

### 11.11.2 App 1: Customer PWA (`frontend/apps/customer-pwa`)

**Tech:** React + Vite + React Query + `wouter` (lightweight router) + Tailwind. Registered as a PWA with a Service Worker (Part 4.2).

```
customer-pwa/
├── public/
│   ├── manifest.json      ← PWA manifest: name, icons, display:standalone
│   └── sw.js              ← Service Worker (Part 4.3.1 — push notification handler)
├── src/
│   ├── pages/
│   │   ├── CartPage.tsx           ← /c/:slug  — menu browse (loads on QR scan)
│   │   ├── CheckoutPage.tsx       ← order form: items review + phone+name + payment method
│   │   ├── IdentifyPage.tsx       ← phone entry + OTP verify (shown only when needed)
│   │   ├── OrderTrackingPage.tsx  ← /orders/:id — live countdown + status
│   │   ├── OrderHistoryPage.tsx   ← /orders/me
│   │   └── PaymentReturnPage.tsx  ← gateway callback landing page
│   ├── components/
│   │   ├── MenuCategory.tsx
│   │   ├── MenuItem.tsx
│   │   ├── CartDrawer.tsx         ← sticky bottom sheet: current order items
│   │   ├── LiveCountdown.tsx      ← uses CountdownTimer from shared UI
│   │   ├── OrderReadyBanner.tsx   ← full-screen green banner on status=ready
│   │   ├── VoiceOrderButton.tsx   ← mic icon → opens VoiceOrderModal
│   │   └── VoiceOrderModal.tsx    ← conversational ordering UI (Part 9.1)
│   ├── hooks/
│   │   ├── usePushPermission.ts   ← requests Push API permission after first order placed
│   │   └── useVoiceOrder.ts       ← manages voice order session state + audio capture
│   └── main.tsx
```

**Key page: `OrderTrackingPage.tsx`**

```tsx
// The centrepiece of the customer experience
import { useOrder } from "@CartCloud/hooks";
import { CountdownTimer, StatusBadge } from "@CartCloud/ui";

export function OrderTrackingPage({ orderId }: { orderId: string }) {
  const { order, isLoading } = useOrder(orderId);
  // useOrder: React Query for initial fetch + subscribes to WS updates + falls back to polling

  if (isLoading) return <OrderTrackingSkeleton />;

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
      {order.status === "ready" ? (
        <OrderReadyBanner cartName={order.cart_name} orderNumber={order.order_number} />
      ) : (
        <>
          <StatusBadge status={order.status} />
          <p className="text-5xl font-bold mt-4">#{order.order_number}</p>
          <p className="text-gray-500 mt-2">from {order.cart_name}</p>

          {order.estimated_ready_at && order.status !== "completed" && (
            <div className="mt-8 text-center">
              <p className="text-sm text-gray-400 uppercase tracking-wide">
                Estimated ready in
              </p>
              <CountdownTimer targetIso={order.estimated_ready_at} className="text-6xl font-mono" />
            </div>
          )}

          <div className="mt-6 text-sm text-gray-400">
            Queue position: {order.queue_position ?? "—"}
          </div>
        </>
      )}
    </div>
  );
}
```

**`useOrder` hook (WS + React Query fusion pattern):**

```typescript
// packages/hooks/useOrder.ts
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWebSocket } from "@CartCloud/ws-client";
import { api } from "@CartCloud/api-client";

export function useOrder(orderId: string) {
  const queryClient = useQueryClient();
  const queryKey = ["order", orderId];

  const query = useQuery({
    queryKey,
    queryFn: () => api.orders.getOrder(orderId),
    staleTime: 30_000,   // don't refetch if WS is keeping it fresh
  });

  // WS overlay — updates React Query cache when WS pushes a status change
  useWebSocket(`/ws/orders/${orderId}/`, {
    onMessage: (msg) => {
      if (msg.type === "order_status_update" || msg.type === "order_eta_update") {
        queryClient.setQueryData(queryKey, (old: any) => ({
          ...old,
          ...msg,   // merge WS patch onto cached order object
        }));
      }
    },
    onFallbackToPolling: () => {
      // WS failed — React Query refetch interval kicks in
      queryClient.setQueryDefaults(queryKey, { refetchInterval: 8000 });
    },
  });

  return { order: query.data, isLoading: query.isLoading };
}
```

### 11.11.3 App 2: KDS (`frontend/apps/kds`)

Tablet-optimized, landscape-first, no scrolling on the main board.

```
kds/
├── src/
│   ├── pages/
│   │   ├── PairDevicePage.tsx     ← PIN entry to pair this tablet to a cart
│   │   └── QueueBoardPage.tsx     ← the main KDS screen (three-column kanban)
│   └── components/
│       ├── QueueColumn.tsx
│       ├── OrderCard.tsx          ← shows order number, items, elapsed timer, status action button
│       ├── StockStatusStrip.tsx   ← persistent top strip (Part 10.6.1)
│       └── ShiftSummaryStrip.tsx  ← collapsible bottom strip (Part 8.1)
```

**`QueueBoardPage.tsx` — the live queue:**

```tsx
import { useKDSQueue } from "./hooks/useKDSQueue";

const STATUS_COLUMNS = [
  { label: "New",       statuses: ["placed"],     color: "blue" },
  { label: "Preparing", statuses: ["accepted", "preparing"], color: "amber" },
  { label: "Ready",     statuses: ["ready"],      color: "green" },
];

export function QueueBoardPage() {
  const { orders, updateStatus } = useKDSQueue();  // WS-backed, same pattern as useOrder

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      <StockStatusStrip />
      <div className="flex flex-1 gap-3 p-3 overflow-hidden">
        {STATUS_COLUMNS.map((col) => (
          <QueueColumn
            key={col.label}
            label={col.label}
            color={col.color}
            orders={orders.filter((o) => col.statuses.includes(o.status))}
            onAdvance={(orderId, nextStatus) => updateStatus(orderId, nextStatus)}
          />
        ))}
      </div>
      <ShiftSummaryStrip />
    </div>
  );
}
```

**`OrderCard` urgency coloring (the most important visual on the KDS):**

```tsx
function getUrgencyClass(order: Order): string {
  if (!order.estimated_ready_at) return "border-gray-600";
  const remaining = (new Date(order.estimated_ready_at).getTime() - Date.now()) / 1000;
  const total = new Date(order.estimated_ready_at).getTime() -
                new Date(order.created_at).getTime()) / 1000;
  const pct = remaining / total;
  if (remaining <= 0)     return "border-red-500 bg-red-950 animate-pulse";   // breached
  if (pct < 0.15)         return "border-orange-400 bg-orange-950";           // critical
  if (pct < 0.35)         return "border-amber-400 bg-amber-950";             // warning
  return "border-gray-700";                                                    // ok
}
```

### 11.11.4 App 3: Owner Dashboard (`frontend/apps/owner-dashboard`)

```
owner-dashboard/
├── src/
│   ├── pages/
│   │   ├── DashboardPage.tsx      ← today-at-a-glance + AI digest card (Part 8.2.1, 8.2.6)
│   │   ├── TrendsPage.tsx         ← revenue/volume charts + hourly heatmap (Part 8.2.2)
│   │   ├── MenuEditorPage.tsx     ← drag-and-drop category + item manager
│   │   ├── MenuItemForm.tsx       ← create/edit item with options builder
│   │   ├── InventoryPage.tsx      ← stock levels, movements, reorder recommendations
│   │   ├── IngredientsPage.tsx    ← ingredient CRUD + recipe builder
│   │   ├── SuppliersPage.tsx
│   │   ├── PurchaseOrdersPage.tsx
│   │   ├── OrdersPage.tsx         ← searchable/filterable order history table
│   │   ├── StaffPage.tsx          ← invite + manage workers/managers
│   │   ├── CartSettingsPage.tsx   ← is_open toggle, payment methods, QR management
│   │   ├── PayoutsPage.tsx
│   │   ├── AnalyticsPage.tsx      ← menu performance, customer insights
│   │   └── AIInsightsPage.tsx     ← full AI copilot digest + reorder AI cards
│   ├── components/
│   │   ├── RevenueChart.tsx       ← recharts LineChart
│   │   ├── HourlyHeatmap.tsx      ← recharts custom heatmap grid (day×hour)
│   │   ├── MenuPerformanceTable.tsx
│   │   ├── InventoryHealthCard.tsx
│   │   ├── ReorderRecommendationCard.tsx  ← Part 10.6.2 UI card
│   │   ├── StockLedgerTable.tsx
│   │   ├── CopilotDigestCard.tsx
│   │   └── CartOpenToggle.tsx     ← prominent is_open switch on the dashboard
│   └── layouts/
│       └── DashboardLayout.tsx    ← sidebar nav + permission-filtered menu items
```

**`DashboardLayout.tsx` permission-filtered sidebar:**

```tsx
import { usePermissions } from "../hooks/usePermissions";

const NAV_ITEMS = [
  { label: "Dashboard",   path: "/",           icon: HomeIcon,     permission: null },
  { label: "Orders",      path: "/orders",      icon: ClipboardIcon, permission: null },
  { label: "Menu",        path: "/menu",        icon: MenuIcon,     permission: "menu:edit" },
  { label: "Inventory",   path: "/inventory",   icon: BoxIcon,      permission: "menu:edit" },
  { label: "Staff",       path: "/staff",       icon: UsersIcon,    permission: "staff:manage" },
  { label: "Payouts",     path: "/payouts",     icon: BanknoteIcon, permission: "payout:view" },
  { label: "Analytics",   path: "/analytics",   icon: BarChartIcon, permission: null },
  { label: "AI Insights", path: "/ai-insights", icon: SparklesIcon, permission: "ai:configure" },
];

export function DashboardLayout({ children }) {
  const { hasPermission } = usePermissions();
  const visibleNav = NAV_ITEMS.filter(
    (item) => !item.permission || hasPermission(item.permission)
  );
  // ...
}
```

### 11.11.5 App 4: Admin Console (`frontend/apps/admin-console`)

```
admin-console/
├── src/
│   ├── pages/
│   │   ├── PlatformHealthPage.tsx  ← GMV, vendor counts, push delivery rate (Part 8.5.1)
│   │   ├── VendorDirectoryPage.tsx ← searchable table + suspend/verify/reinstate actions
│   │   ├── VendorDetailPage.tsx    ← full drill-down with same owner-dashboard stats
│   │   ├── LiveOpsMapPage.tsx      ← Leaflet.js map with cart status markers (Part 8.5.4)
│   │   ├── FraudQueuePage.tsx      ← fraud events + AI narrative per flag (Part 9.3)
│   │   ├── PayoutControlPage.tsx   ← batch payout processing
│   │   ├── SupportCustomerPage.tsx ← customer lookup + order history (support agent scope)
│   │   └── VendorHealthPage.tsx    ← churn-risk table (Part 8.5.2)
│   └── components/
│       ├── PlatformMetricCard.tsx
│       ├── FraudEventCard.tsx      ← shows risk_type, risk_score, AI narrative, action buttons
│       ├── CartMapMarker.tsx
│       └── VendorStatusBadge.tsx
```

---

## 11.12 State Management Strategy

| Concern | Tool | Rationale |
|---|---|---|
| Server state (API data) | **React Query (TanStack Query)** | Caching, background refetch, optimistic updates, WS cache invalidation all compose cleanly |
| Real-time overlay (WS) | Direct `queryClient.setQueryData()` from WS message handler | WS patches React Query cache in place — no separate WS state store needed |
| UI state (modals, drawers, form steps) | `useState` / `useReducer` locally | Colocate with the component; no global store for transient UI state |
| Auth state (tokens, current user/role) | `zustand` store (persisted to localStorage) | Needs to survive page refresh; small enough that Redux is overkill |
| Cart/basket state (customer-pwa) | `zustand` store (persisted to sessionStorage) | Survives a page refresh mid-ordering without needing a server round-trip |

---

## 11.13 Deployment with Django Channels

Django Channels requires ASGI, not WSGI. The two are run separately in production:

```
# nginx.conf (simplified)
upstream django_rest {
    server django-core:8000;       # gunicorn + WSGI for REST — no Channels
}
upstream django_ws {
    server django-channels:9000;   # uvicorn + ASGI for WebSocket only
}

location /v1/ {
    proxy_pass http://django_rest;
}
location /ws/ {
    proxy_pass http://django_ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_read_timeout 86400;      # keep WS connections open
}
```

Both the REST workers and the WS workers use the same Django codebase and the same `DJANGO_SETTINGS_MODULE` — the only difference is the entry point (`wsgi.py` vs `asgi.py`). This also means a single migration command migrates the schema for both.

```yaml
# docker-compose.prod.yml (key services)
services:
  django-rest:
    build: ./backend
    command: gunicorn config.wsgi:application --workers 4 --bind 0.0.0.0:8000
    env_file: .env.production

  django-channels:
    build: ./backend
    command: uvicorn config.asgi:application --host 0.0.0.0 --port 9000 --workers 4
    env_file: .env.production

  ai-service:
    build: ./ai_service
    command: uvicorn main:app --host 0.0.0.0 --port 8001 --workers 2

  celery-worker:
    build: ./backend
    command: celery -A celery_app worker -Q notifications,reports,ai_batch --concurrency 4

  celery-beat:
    build: ./backend
    command: celery -A celery_app beat -l info

  postgres:
    image: pgvector/pgvector:pg16   # includes pgvector extension (Part 9.2)
    volumes: [postgres_data:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
```

---

## 11.14 Frontend Build & Deployment

```yaml
# frontend CI (GitHub Actions excerpt)
- name: Generate API client from OpenAPI schema
  run: |
    cd backend && python manage.py spectacular --file ../frontend/packages/api-client/schema.json
    cd frontend && npx openapi-typescript-codegen \
      --input packages/api-client/schema.json \
      --output packages/api-client/generated \
      --client axios
  # This runs on every backend merge — frontend types never drift from backend contract

- name: Build customer PWA
  run: cd frontend/apps/customer-pwa && vite build
  # Output: dist/ → deployed to CDN (CloudFront/Cloudflare Pages)
  # Service Worker included in build output → enables push notifications (Part 4.2)

- name: Build KDS app
  run: cd frontend/apps/kds && vite build

- name: Build Owner Dashboard
  run: cd frontend/apps/owner-dashboard && vite build

- name: Build Admin Console
  run: cd frontend/apps/admin-console && vite build
```

Each React app is a static build deployed to a CDN — zero server rendering needed, since all data is fetched client-side via the DRF API. The customer PWA gets the most aggressive CDN caching (static assets have 1-year cache headers; the API calls are dynamic), since it's the highest-traffic surface and benefits most from edge caching of the JS bundle.

---

## 11.15 Summary — What Changed from FastAPI to Django DRF

| Aspect | FastAPI (Parts 1–10) | Django DRF (this Part) |
|---|---|---|
| REST framework | FastAPI + Pydantic | Django REST Framework + drf-spectacular |
| WebSockets | Separate FastAPI Realtime Gateway service | Django Channels consumer (same codebase as REST) |
| ORM | SQLAlchemy async | Django ORM (sync, read replica via router) |
| Auth | Manual JWT classes | `djangorestframework-simplejwt` + custom authenticators |
| Admin console | Custom React app (Part 7.1) | Django Admin extended with `django-unfold` + custom pages for complex views |
| Schema migrations | Alembic | Django migrations |
| OpenAPI | FastAPI auto-generates | `drf-spectacular` generates |
| Frontend client codegen | Same (`openapi-typescript-codegen`) | Same |
| Celery, Redis, PostgreSQL, Payments, AI Service, S3 | Unchanged | Unchanged |

The data model (Part 2), all 60+ API endpoints (Part 3), real-time sequence (Part 4), payment abstraction (Part 5), all AI systems (Parts 6, 9), all dashboards (Part 8), and the full inventory system (Part 10) are **fully preserved** — this Part only specifies how those designs are implemented in Django DRF + React, not a redesign of the product.
