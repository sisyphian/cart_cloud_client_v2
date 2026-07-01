# CartCloud — Frontend Architecture Document

**Version:** 1.0
**Companion to:** *CartCloud — Production Architecture Document* (backend, Django DRF + Channels, Part 11)
**Stack:** React 18 + TypeScript + Vite · TanStack Query · Zustand · Tailwind + shadcn/ui · Django Channels WebSockets · Web Push
**Scope:** Four independently-deployed React apps sharing one design system and one generated API client

---

## 1. Purpose & Scope

The backend architecture document specifies *what* CartCloud does and *how the server enforces it* — multi-tenancy, RBAC, real-time fan-out, payments, AI. This document specifies the other half of the contract: **how four different frontend surfaces consume that backend safely, quickly, and honestly**, for four very different users typing/tapping on four very different devices under very different constraints:

| App | User | Device reality | Design priority |
|---|---|---|---|
| Customer PWA | Anonymous-ish guest, phone+name only | Any phone browser, often 3G/4G street connectivity, no app install | Speed to first order, honesty of the countdown |
| KDS | Cart Worker, cooking with wet/messy hands | Tablet, landscape, mounted at the cart | Glanceability, one-tap actions, zero scrolling |
| Owner Dashboard | Cart Owner / Manager | Desktop or tablet, checked multiple times a day | Permission-aware depth, trend context over raw numbers |
| Admin Console | Platform Admin / Support Agent | Desktop, internal tool | Cross-tenant visibility, operational triage |

Two product constraints from the backend document shape almost every frontend decision in this one and are worth restating up front, because they are not UI afterthoughts:

1. **Zero-friction guest identity** — no password, no signup form, phone + name only, recognized across every vendor on the platform.
2. **A phone alert that works without an installed app** — the countdown must be honest while the tab is open, and the "ready" alert must land even if the tab is backgrounded or closed.

Everything in Sections 8–9 (real-time + push) exists because of constraint #2, and everything in Section 10 (auth) exists because of constraint #1.

---

## 2. Monorepo & Repository Structure

Four apps, one shared foundation, one generated API client, deployed independently as static builds:

```
frontend/
├── apps/
│   ├── customer-pwa/       ← Vite + React, PWA, public internet, highest traffic
│   ├── kds/                ← Vite + React, tablet-only, paired-device auth
│   ├── owner-dashboard/    ← Vite + React, permission-filtered, desktop-first
│   └── admin-console/      ← Vite + React, internal, desktop-only
│
└── packages/
    ├── ui/                 ← shadcn/ui base + CartCloud design tokens
    ├── api-client/         ← auto-generated from the backend's OpenAPI schema
    ├── hooks/               ← shared data-fetching hooks (useOrder, useCart, useMenu, useAuth)
    └── ws-client/            ← WSManager singleton + useWebSocket hook
```

Each app is a **standalone static Vite build**, deployed to CDN independently — no server-side rendering, since all data is fetched client-side against the API. This means:

- A bad deploy of the Owner Dashboard cannot break the Customer PWA's ordering flow.
- Each app can ship on its own release cadence (the Customer PWA, being highest-traffic and most latency-sensitive, is the one most likely to need a hotfix independent of the others).
- The shared packages are the *only* coupling point between apps — a breaking change to `packages/ui` or `packages/api-client` is the one thing that requires coordinated testing across all four.

**Workspace tooling:** pnpm workspaces (or Yarn/Turborepo — any workspace-aware package manager works here; the constraint that matters is that `packages/*` are consumed as internal workspace dependencies, not published npm packages, so a change to a shared hook is live across all four apps without a publish step).

---

## 3. Shared Packages — the frontend's contract with the backend

### 3.1 `packages/api-client` — generated, never hand-edited

```yaml
# Runs on every backend merge, in CI — frontend types never drift from the backend contract
- name: Generate API client from OpenAPI schema
  run: |
    cd backend && python manage.py spectacular --file ../frontend/packages/api-client/schema.json
    cd frontend && npx openapi-typescript-codegen \
      --input packages/api-client/schema.json \
      --output packages/api-client/generated \
      --client axios
```

```
api-client/
├── generated/     ← openapi-typescript-codegen output — never hand-edited
└── index.ts       ← re-exports with sensible defaults (base URL, auth header injection, idempotency keys)
```

This is the single most important architectural guarantee on the frontend side: **the TypeScript types for every request/response shape are derived from the backend's actual serializers, not maintained by hand.** A backend field rename becomes a frontend compile error, not a silent runtime bug discovered in production. `index.ts` is where cross-cutting request behavior lives that shouldn't be regenerated away — attaching the `Authorization` header, attaching `Idempotency-Key` on order-creation POSTs (per the backend's idempotency contract), and attaching `If-Match` on menu-item PATCHes (per the backend's optimistic-concurrency contract).

### 3.2 `packages/ui` — the shared design system

```
ui/
├── components/
│   ├── Button.tsx
│   ├── Card.tsx
│   ├── StatusBadge.tsx        ← order status → color + label mapping (one source of truth across all 4 apps)
│   ├── CountdownTimer.tsx     ← accepts an ISO estimatedReadyAt, ticks client-side, never re-fetches to tick
│   └── ...
└── tokens.css
```

Built on **shadcn/ui** primitives plus CartCloud design tokens (see Section 15). `StatusBadge` and `CountdownTimer` are called out specifically because they encode product logic, not just styling — every app that shows an order status or a countdown must render it identically, or a customer sees one color scheme on the tracking page and the cart worker sees another for the same order, which is a trust bug, not just an inconsistency.

### 3.3 `packages/hooks` — the WS + React Query fusion pattern

```
hooks/
├── useOrder.ts     ← React Query hook: GET /orders/{id} with a WS overlay
├── useCart.ts
├── useMenu.ts
└── useAuth.ts
```

This is the core data-fetching pattern used across the whole frontend and is detailed in Section 8.

### 3.4 `packages/ws-client`

```
ws-client/
├── WSManager.ts       ← singleton WS connection per URL, auto-reconnect with exponential backoff,
│                          heartbeat, fallback-to-polling trigger
└── useWebSocket.ts    ← React hook wrapping WSManager
```

---

## 4. High-Level Frontend Data Flow

```
                         ┌───────────────────────────────────────┐
                         │           Four React Apps               │
                         │  customer-pwa · kds · owner-dashboard ·  │
                         │            admin-console                 │
                         └───────────────┬───────────────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                     │
           REST (generated client)   WSS (ws-client)     Web Push (Service Worker,
           via api-client                                customer-pwa only)
                    │                    │                     │
                    ▼                    ▼                     ▼
              Django DRF Core API   Django Channels        FCM / APNs / Mozilla
              (source of truth)     Realtime Gateway        push services
                                    (Redis pub/sub relay)
```

Two rules govern every data-fetching decision on the frontend:

1. **REST is always the source of truth for current state; WebSocket is an optimization for instant updates.** On reconnect, the client always does a one-shot REST refetch before resubscribing — it never assumes the WS stream alone reflects reality.
2. **Push is the only channel guaranteed to fire while the tab is backgrounded or closed.** The WS-driven countdown is a "feels live while you're looking" layer; the "it's ready" moment is delivered by Web Push, not by the WS message alone (Section 9).

---

## 5. State Management Strategy

| Concern | Tool | Rationale |
|---|---|---|
| Server state (API data) | **React Query (TanStack Query)** | Caching, background refetch, optimistic updates, and WS cache invalidation all compose cleanly on top of it |
| Real-time overlay (WS) | Direct `queryClient.setQueryData()` from the WS message handler | WS patches the React Query cache in place — no separate WS state store needed |
| UI state (modals, drawers, form steps) | `useState` / `useReducer`, colocated with the component | No global store for transient UI state |
| Auth state (tokens, current user/role) | `zustand` store, persisted to `localStorage` | Needs to survive a page refresh; small enough that Redux would be overkill |
| Cart/basket state (customer-pwa) | `zustand` store, persisted to `sessionStorage` | Survives a page refresh mid-ordering without a server round-trip |

The deliberate absence of Redux (or any global store beyond two small Zustand slices) is a scope decision, not an oversight: server state is the overwhelming majority of state in this product, and React Query already owns caching, dedup, and invalidation for it. A second global store for the same data would just be a second source of truth to keep in sync.

---

## 6. Real-Time Architecture — the `useOrder` fusion pattern

Every real-time surface in the product (customer tracking page, KDS queue board, owner's live dashboard) follows the same pattern: **React Query owns the data, WebSocket patches it in place, REST polling is the fallback if WS fails.**

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

  // WS overlay — updates the React Query cache when WS pushes a status change
  useWebSocket(`/ws/orders/${orderId}/`, {
    onMessage: (msg) => {
      if (msg.type === "order_status_update" || msg.type === "order_eta_update") {
        queryClient.setQueryData(queryKey, (old: any) => ({
          ...old,
          ...msg,   // merge WS patch onto the cached order object
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

**Connection lifecycle contract (`WSManager`):**

- Heartbeat ping/pong every 25s.
- Auto-reconnect with exponential backoff, capped at 30s.
- On any reconnect, immediately fire a one-shot REST refetch to resync state (covers events missed while disconnected) *before* resubscribing.
- After 2 failed WS connection attempts, fall back to REST polling every 8 seconds — this is a tested, documented degradation path (not an afterthought), because a countdown that silently freezes is a worse failure mode than one that updates a bit slower. This matters concretely for the product's Bangladesh street/campus-network context, where some embedded WebViews and restrictive proxies can't sustain a WS connection at all.

**WS channels consumed by each app:**

| Channel | Consumed by |
|---|---|
| `order:{order_id}:updates` | Customer PWA (`OrderTrackingPage`) |
| `cart:{cart_id}:queue` | KDS (`QueueBoardPage`) — full queue view, reorders live as the backend's AI re-sequences it |
| `vendor:{vendor_id}:dashboard` | Owner Dashboard (`DashboardPage`) — new-order arrivals, live revenue ticking, live queue depth |

The countdown itself never re-renders from a server tick — `CountdownTimer` receives a target ISO timestamp once and ticks client-side with `setInterval`, so the WS channel only needs to push on *actual* changes (status transition, ETA revision), not once a second. This keeps the Realtime Gateway's message volume proportional to real events, not to wall-clock time.

---

## 7. Authentication — Frontend Flows

The backend enforces three separate identity models (Part 3 of the backend doc); the frontend implements three matching flows.

### 7.1 Customer identity — phone + name, no password (Customer PWA only)

```
1. Customer scans QR → lands directly on CartPage.tsx (/c/:slug). No login wall —
   full menu browse with zero identity provided.
2. At checkout (CheckoutPage.tsx), phone + name are collected.
3. POST /v1/customers/identify:
     - known device+phone with a valid session → tokens returned directly, no OTP screen shown
     - otherwise → { otp_required: true } → IdentifyPage.tsx shows the OTP entry step
4. On verify (or skip), the access + refresh tokens are stored:
     - HttpOnly cookie (primary)
     - also returned in the response body and mirrored into local storage,
       specifically to work around Safari iOS PWA cookie-persistence quirks
5. Session persists 30 days, access token refreshed silently via /v1/auth/refresh
   on a 15-minute cadence (customer) — the customer never sees this happen.
```

- **Device fingerprint**: a privacy-respecting, non-invasive identifier — no canvas/audio fingerprinting. It's a UUID (`device_id`) generated client-side on first visit and persisted in `localStorage`; if the customer clears storage, the worst case is one extra OTP prompt, which is an acceptable degradation.
- **Why this matters for frontend UX specifically**: because OTP is only shown once per device+phone pairing in a rolling 30-day window, `IdentifyPage.tsx` is a screen most returning customers across the *entire platform* — not just one vendor — will never see again after their first order anywhere. The frontend should treat "skip straight to checkout" as the expected path, not the OTP screen.

### 7.2 Staff & Owner identity — real accounts (Owner Dashboard, Admin Console)

Standard OAuth2-style password + JWT login (`POST /v1/auth/login` with `phone_or_email`, `password`, and `totp_code`), with mandatory TOTP 2FA for Owners and all Admin/Support roles. Frontend responsibilities:

- Login form collects the TOTP code inline (not a separate step) once a password is accepted, since 2FA is mandatory rather than optional for these roles.
- `useAuth.ts` (shared hook) exposes `{ user, roles, permissions, hasPermission(perm) }`, backed by the Zustand auth store.
- Access tokens (30 min for staff) refresh silently in the background; on a hard 401 the app redirects to login and preserves the current route to return to post-login.

### 7.3 Cart Worker / KDS pairing — PIN, not password

```
1. Owner generates a 6-digit PIN per worker from Owner Dashboard's StaffPage.tsx.
2. Worker enters the PIN once on PairDevicePage.tsx (KDS app).
3. POST /v1/kds/pair { cart_id, pin } → { device_token }
4. device_token is stored on the tablet (localStorage) and used for all subsequent
   KDS requests — the tablet itself is the "logged in" unit, not the individual worker.
5. The tablet stays paired until the owner unpairs it from the dashboard.
```

This is a deliberate frontend simplification matching a deliberate backend tradeoff: the KDS app has effectively **no per-worker login screen after initial pairing** — the auth boundary is physical access to the tablet, matching the real-world trust model of a small food cart. `QueueBoardPage.tsx` should assume `device_token` is present on every load after pairing and never prompt for re-authentication mid-shift.

---

## 8. Push Notifications & PWA — the frontend half of the "phone beeps" requirement

This is the single hardest constraint on the frontend and gets a dedicated section because it determines the Customer PWA's entire notification architecture.

### 8.1 Why WebSocket alone can't do this

Mobile browsers suspend/throttle JS and close WS connections when a tab is backgrounded or the screen locks — exactly the moment a customer waiting on an order has put their phone in their pocket. The frontend therefore implements **two parallel channels**, not one:

| Channel | Purpose | Works tab-backgrounded/closed? |
|---|---|---|
| WebSocket | Live countdown, queue position, instant on-screen refresh | ❌ No |
| Web Push (Push API + Service Worker) | The actual "order ready" alert — vibration, sound, lock-screen banner | ✅ Yes |
| SMS (server-side fallback) | Last resort if push permission was denied/unsupported | ✅ Yes, always |

### 8.2 PWA setup (Customer PWA only)

```
customer-pwa/
├── public/
│   ├── manifest.json   ← PWA manifest: name, icons, display:standalone
│   └── sw.js            ← Service Worker — push notification handler
```

- On first visit (or immediately after the first order is placed), the browser shows a single native permission prompt — not an app install, not an app-store interaction. Supported on iOS Safari 16.4+ and all modern Android browsers.
- The push subscription is stored against the platform-wide `Customer` record, not per-vendor — so granting permission once means **every future order from any vendor on the platform** can alert the customer.
- If permission is declined or the browser is unsupported, the frontend does nothing further — the fallback to SMS for the "ready" event is entirely a backend responsibility, invisible to the frontend. The one thing the frontend must get right is *not blocking the ordering flow* on push permission — it's requested opportunistically, never required to complete checkout.

### 8.3 Service Worker contract

```javascript
// sw.js — registered once on first page load
self.addEventListener('push', function(event) {
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/order-ready.png',
      vibrate: [200, 100, 200, 100, 400],   // distinct pattern, not a generic single buzz
      tag: data.order_id,                    // collapses duplicate notifications for the same order
      requireInteraction: true,               // stays on screen until dismissed
      data: { order_id: data.order_id, url: `/orders/${data.order_id}` }
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
```

`requireInteraction: true` is not incidental — a notification that auto-dismisses after a few seconds defeats the entire feature when the customer is mid-conversation 10 meters from the cart and doesn't glance at their phone instantly.

The Service Worker also fires a lightweight "delivery confirmed" beacon from its `notificationclick`/`show` handler, which the backend uses to decide whether an unseen push needs an SMS follow-up — the frontend's only job here is to make sure that beacon call actually fires, since it's the signal that closes the loop on delivery confidence.

### 8.4 `usePushPermission` hook

```
customer-pwa/src/hooks/usePushPermission.ts
```

Requests Push API permission *after* the first order is placed, not on page load — asking for a browser permission before the customer has any reason to trust the site is a well-known conversion killer, and it's also simply premature: there's nothing to notify them about yet.

---

## 9. App-by-App Breakdown

### 9.1 App 1 — Customer PWA (`frontend/apps/customer-pwa`)

**Tech:** React + Vite + React Query + `wouter` (lightweight router) + Tailwind, registered as a PWA.

```
customer-pwa/
├── public/
│   ├── manifest.json
│   └── sw.js
├── src/
│   ├── pages/
│   │   ├── CartPage.tsx           ← /c/:slug — menu browse (loads on QR scan)
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
│   │   ├── OrderReadyBanner.tsx   ← full-screen banner on status=ready
│   │   ├── VoiceOrderButton.tsx   ← mic icon → opens VoiceOrderModal
│   │   └── VoiceOrderModal.tsx    ← conversational ordering UI (Section 11)
│   ├── hooks/
│   │   ├── usePushPermission.ts
│   │   └── useVoiceOrder.ts       ← manages voice-order session state + audio capture
│   └── main.tsx
```

**`OrderTrackingPage.tsx` is the centerpiece of the entire customer experience** — the payoff of both the real-time and the identity architecture:

```tsx
import { useOrder } from "@CartCloud/hooks";
import { CountdownTimer, StatusBadge } from "@CartCloud/ui";

export function OrderTrackingPage({ orderId }: { orderId: string }) {
  const { order, isLoading } = useOrder(orderId);

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
              <p className="text-sm text-gray-400 uppercase tracking-wide">Estimated ready in</p>
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

**Idempotency on the frontend:** every `POST /carts/{slug}/orders` call from `CheckoutPage.tsx` must attach an `Idempotency-Key` header (a client-generated UUID, stable across retries of the *same* checkout attempt). This is a hard requirement given BD street-connectivity conditions — a flaky connection retrying a checkout POST must never double-create an order or double-charge the customer.

### 9.2 App 2 — KDS (`frontend/apps/kds`)

Tablet-optimized, landscape-first, **no scrolling** on the main board — the design constraint here is glanceability, not depth, because the worker is often looking at this screen with wet/messy hands between orders.

```
kds/
├── src/
│   ├── pages/
│   │   ├── PairDevicePage.tsx     ← PIN entry to pair this tablet to a cart
│   │   └── QueueBoardPage.tsx     ← the main KDS screen (three-column kanban)
│   └── components/
│       ├── QueueColumn.tsx
│       ├── OrderCard.tsx          ← order number, item list, elapsed timer, one-tap status action
│       ├── StockStatusStrip.tsx   ← persistent top strip
│       └── ShiftSummaryStrip.tsx  ← collapsible bottom strip, not a separate page
```

```tsx
import { useKDSQueue } from "./hooks/useKDSQueue";

const STATUS_COLUMNS = [
  { label: "New",       statuses: ["placed"],                 color: "blue" },
  { label: "Preparing", statuses: ["accepted", "preparing"],  color: "amber" },
  { label: "Ready",     statuses: ["ready"],                  color: "green" },
];

export function QueueBoardPage() {
  const { orders, updateStatus } = useKDSQueue();  // WS-backed, same fusion pattern as useOrder

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

**`OrderCard` urgency coloring is the single most important visual on the entire screen** — it's the one cue that turns into a customer complaint if ignored:

```tsx
function getUrgencyClass(order: Order): string {
  if (!order.estimated_ready_at) return "border-gray-600";
  const remaining = (new Date(order.estimated_ready_at).getTime() - Date.now()) / 1000;
  const total = (new Date(order.estimated_ready_at).getTime() -
                 new Date(order.created_at).getTime()) / 1000;
  const pct = remaining / total;
  if (remaining <= 0)  return "border-red-500 bg-red-950 animate-pulse";  // breached
  if (pct < 0.15)      return "border-orange-400 bg-orange-950";          // critical
  if (pct < 0.35)      return "border-amber-400 bg-amber-950";            // warning
  return "border-gray-700";                                                // ok
}
```

**What's deliberately absent from KDS:** revenue figures. A worker can't change pricing or commission, so showing money is noise relative to the job (throughput and order accuracy), not a missing feature.

### 9.3 App 3 — Owner Dashboard (`frontend/apps/owner-dashboard`)

```
owner-dashboard/
├── src/
│   ├── pages/
│   │   ├── DashboardPage.tsx      ← today-at-a-glance + AI digest card
│   │   ├── TrendsPage.tsx         ← revenue/volume charts + hourly heatmap
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
│   │   ├── RevenueChart.tsx              ← recharts LineChart
│   │   ├── HourlyHeatmap.tsx             ← recharts custom heatmap grid (day × hour)
│   │   ├── MenuPerformanceTable.tsx
│   │   ├── InventoryHealthCard.tsx
│   │   ├── ReorderRecommendationCard.tsx
│   │   ├── StockLedgerTable.tsx
│   │   ├── CopilotDigestCard.tsx
│   │   └── CartOpenToggle.tsx            ← prominent is_open switch on the dashboard
│   └── layouts/
│       └── DashboardLayout.tsx           ← sidebar nav + permission-filtered menu items
```

**Design principle: numbers need trend context to be actionable.** Every stat on `DashboardPage.tsx` (revenue, orders, AOV, wait time, cancellation rate) is rendered with a same-weekday-last-week delta badge (`↑12%` / `↓4%`) — a raw number without that context is close to meaningless to a busy owner glancing at the screen between customers, so the delta is treated as part of the stat, not an optional enhancement.

**Permission-filtered navigation — one dashboard, not two:**

```tsx
import { usePermissions } from "../hooks/usePermissions";

const NAV_ITEMS = [
  { label: "Dashboard",   path: "/",           icon: HomeIcon,      permission: null },
  { label: "Orders",      path: "/orders",      icon: ClipboardIcon, permission: null },
  { label: "Menu",        path: "/menu",        icon: MenuIcon,      permission: "menu:edit" },
  { label: "Inventory",   path: "/inventory",   icon: BoxIcon,       permission: "menu:edit" },
  { label: "Staff",       path: "/staff",       icon: UsersIcon,     permission: "staff:manage" },
  { label: "Payouts",     path: "/payouts",     icon: BanknoteIcon,  permission: "payout:view" },
  { label: "Analytics",   path: "/analytics",   icon: BarChartIcon,  permission: null },
  { label: "AI Insights", path: "/ai-insights", icon: SparklesIcon,  permission: "ai:configure" },
];

export function DashboardLayout({ children }) {
  const { hasPermission } = usePermissions();
  const visibleNav = NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission));
  // ...
}
```

The Manager Dashboard is **not a separate app or codebase** — it's the same Owner Dashboard, permission-filtered at render time using the same RBAC permission strings already enforced server-side on each endpoint. A Manager without `payout:view` sees every panel except payout figures, and those panels are **hidden entirely, not shown-and-grayed-out** — a deliberate choice, since a grayed-out number a manager can't act on and can't ask about is worse UX noise than its absence. This also means the frontend never maintains its own separate notion of "what can a manager see" — it's a pure function of the permission strings the backend already returns on login.

**Multi-cart owners** default to a rollup view across all owned carts before drilling into any single cart — same endpoints, a `?cart_id=all` query mode, not a separate page or codepath.

### 9.4 App 4 — Admin Console (`frontend/apps/admin-console`)

```
admin-console/
├── src/
│   ├── pages/
│   │   ├── PlatformHealthPage.tsx  ← GMV, vendor counts, push delivery rate
│   │   ├── VendorDirectoryPage.tsx ← searchable table + suspend/verify/reinstate actions
│   │   ├── VendorDetailPage.tsx    ← full drill-down, same stat components as owner-dashboard
│   │   ├── LiveOpsMapPage.tsx      ← Leaflet.js map with cart status markers
│   │   ├── FraudQueuePage.tsx      ← fraud events + AI narrative per flag
│   │   ├── PayoutControlPage.tsx   ← batch payout processing
│   │   ├── SupportCustomerPage.tsx ← customer lookup + order history (support-agent scope)
│   │   └── VendorHealthPage.tsx    ← churn-risk table
│   └── components/
│       ├── PlatformMetricCard.tsx
│       ├── FraudEventCard.tsx      ← risk_type, risk_score, AI narrative, action buttons
│       ├── CartMapMarker.tsx
│       └── VendorStatusBadge.tsx
```

`PlatformMetricCard` for **push notification delivery rate** deserves specific mention: the backend document flags this as the single most important reliability metric in the whole product, and it's placed on the landing screen (`PlatformHealthPage.tsx`) rather than buried in an ops-only panel, for exactly that reason — it's the number that tells the platform team whether the "phone beeps" promise is actually being kept at scale.

`VendorDetailPage.tsx` deliberately **reuses the same stat components as the Owner Dashboard** (`RevenueChart`, `MenuPerformanceTable`, etc., imported from shared or duplicated with identical props) rather than building parallel admin-only components — an admin drilling into one vendor should see exactly the numbers that vendor's own owner sees, which is both less code and the correct trust model for support interactions ("I'm looking at what you're looking at").

---

## 10. Voice Ordering UI (frontend half)

The backend's conversational-ordering feature (function-calling LLM, validated server-side against the live menu) has a frontend half that needs its own contract, since a voice UI has failure modes a text form doesn't:

- `VoiceOrderButton.tsx` opens `VoiceOrderModal.tsx`, which manages a turn-based session (`useVoiceOrder.ts`): capture audio → `POST /v1/ai/voice-order/session/{id}/turn` → render `assistant_text` as a chat bubble → render the current `draft_order` as a live-updating mini cart preview inside the modal.
- **The draft order preview must render every turn**, not just at confirmation — since the backend validates `menu_item_id` server-side on every turn and can reject a hallucinated item, the frontend needs to show the *actual* validated draft state, not an optimistic guess at what the model said.
- `requires_confirmation` from the API response gates a visible "Confirm order" button — the frontend never auto-submits an order from a voice turn; the explicit confirmation tap re-uses the exact same order-creation call path as manual checkout, so voice ordering never bypasses payment/stock validation on the client either.
- Audio capture uses the browser's `MediaRecorder` API; the modal shows a simple recording-state indicator (idle / listening / processing) rather than a live waveform, since the STT/LLM round-trip latency (Whisper → LLM function call) means a waveform would imply more real-time responsiveness than the pipeline actually delivers — better to be honest about "thinking" than to fake immediacy.

---

## 11. Design System

Built on **shadcn/ui** primitives (Tailwind-based, no separate component-library runtime) plus a shared `tokens.css` in `packages/ui`. Key conventions:

- **One source of truth for status color mapping** (`StatusBadge`) — the same order status renders with the same color and label whether a customer, a worker, an owner, or an admin is looking at it.
- **Dark mode is a KDS-specific default**, not a platform-wide toggle — the KDS board defaults to a dark, high-contrast palette (`bg-gray-950`) because it's mounted equipment viewed under variable kitchen lighting, while the other three apps default to light mode as standard business-application surfaces.
- Iconography via a single icon set (e.g. lucide-react) shared across all four apps through `packages/ui`, so the same "Menu," "Staff," "Payouts" concepts look identical whether an owner or an admin is looking at them.

---

## 12. Routing

| App | Router | Notes |
|---|---|---|
| Customer PWA | `wouter` (lightweight) | Small bundle matters most here — this is the highest-traffic, most latency-sensitive surface, and it only needs ~6 routes |
| KDS | Minimal/none | Effectively two screens (pair, queue board); a full router is arguably unnecessary overhead |
| Owner Dashboard | Standard React Router | Deep, permission-filtered nav tree across a dozen+ pages |
| Admin Console | Standard React Router | Similar depth to Owner Dashboard, plus map/table-heavy routes |

Route-level code splitting (`React.lazy` + `Suspense`) is used on Owner Dashboard and Admin Console, where page count is high and any individual owner/admin session only touches a handful of pages per visit. The Customer PWA is small enough end-to-end that a single bundle (or minimal splitting around the voice-ordering modal, which pulls in `MediaRecorder`-adjacent code) is preferable to the complexity of route-splitting a ~6-page app.

---

## 13. Internationalization

The product is Bangla-first (Bangladesh street-food vendors and their customers), with the voice-ordering assistant explicitly handling Bangla, English, and Banglish code-mixing server-side. On the frontend:

- Menu item names carry both `name` and `name_bn` fields (per the backend's menu schema referenced in the voice-ordering system prompt) — `MenuItem.tsx` renders both, not just the English name, since the primary customer base reads Bangla first.
- UI chrome (buttons, labels, status text) uses a standard i18n library (e.g. `react-i18next`) with English and Bangla locale bundles; the Customer PWA is the priority surface for full bilingual coverage, since it's the guest-facing, zero-training surface — KDS/Owner/Admin users are onboarded staff who can be assumed comfortable with whichever single language the vendor's business is run in, so full bilingual parity is lower priority there.
- Numbers, currency (BDT), and dates are formatted via `Intl` APIs with the vendor's locale, not hardcoded — the backend stores timestamps in UTC and expects presentation-layer conversion to the vendor's local timezone, which is a frontend formatting responsibility, not a backend one.

---

## 14. Performance

- **Customer PWA is the CDN-priority surface**: static assets get 1-year cache headers; only the API calls are dynamic. It's the highest-traffic app and benefits most from aggressive edge caching of the JS bundle, since a customer scanning a QR code on variable street connectivity is the least forgiving audience for a slow first paint.
- **The countdown never triggers a network request to tick** — `CountdownTimer` computes remaining time from a stored ISO timestamp and a local `setInterval`; only actual state changes (status transition, ETA revision) arrive over WS. This keeps both perceived performance (always smooth, never janky waiting on network) and actual server load (no per-second polling) under control.
- **Menu images and photos** are served from S3-compatible object storage (backend-owned) behind the CDN — the frontend should always request appropriately sized/optimized variants for `MenuItem.tsx` thumbnails rather than full-resolution vendor uploads, to keep the QR-scan-to-first-paint path fast on mobile data.
- React Query's `staleTime` is tuned per query to avoid redundant refetching where WS is already keeping data fresh (see `useOrder` in Section 6) — the goal is that WS presence *reduces* REST traffic on a screen, not adds a second parallel data source competing with polling.

---

## 15. Accessibility

- **KDS**: large tap targets and high-contrast status colors are treated as a hard requirement, not a nice-to-have — this is equipment operated with wet/messy hands under kitchen conditions, so the accessibility bar here doubles as an operational-reliability bar.
- **Customer PWA**: form fields (phone entry, OTP entry) use correct `inputmode`/`autocomplete` attributes for mobile keyboards (numeric keypad for phone/OTP), and the OTP flow supports SMS autofill (`autocomplete="one-time-code"`) to minimize friction for a flow that already has a hard "under 60 seconds" product constraint.
- **Owner Dashboard / Admin Console**: standard WCAG AA conventions for data-heavy business applications — keyboard navigable tables, sufficient contrast on status badges and chart colors (colorblind-safe palettes on urgency/status indicators, not color-alone signaling), and screen-reader labels on icon-only nav items.

---

## 16. Frontend Security Considerations

These mirror the backend's security checklist (Part 7.3 of the backend document) from the frontend's side of the boundary:

- **Token storage**: customer session tokens are HttpOnly-cookie-first, with a local-storage mirror strictly to work around Safari iOS PWA cookie quirks — never store tokens in a way that's readable by injected third-party scripts if avoidable. Staff/admin tokens (higher-privilege) follow the same pattern with shorter TTLs.
- **No PII beyond what's needed on screen**: the Customer Insight panel and Support Customer views render masked phone numbers (`+8801XXXXX678`) by default, matching the backend's PII-minimization rule — the frontend must not "unmask" client-side for convenience; if a full number is ever needed, it comes from a specific, audited backend endpoint, not by concatenating cached fragments.
- **RBAC is enforced server-side; the frontend's permission filtering is a UX convenience, not a security boundary.** Hiding a nav item or a panel for a Manager without a given permission prevents *confusion*, not *access* — every underlying endpoint independently enforces the same permission check, so a hidden panel is never the only thing standing between a role and data it shouldn't see.
- **Idempotency keys** on order creation and **`If-Match` optimistic-concurrency headers** on menu edits are frontend responsibilities to attach correctly (Section 9.1) — getting these wrong doesn't just cause a UI bug, it can cause a real double-order or a silently clobbered concurrent menu edit.
- **Webhook/payment redirect pages** (`PaymentReturnPage.tsx`) never trust query-string payment status as ground truth for UI state — they trigger a REST refetch of the order to get the backend's verified status (which itself only updates on a signature-verified webhook), rather than rendering "success" off a redirect parameter a user could tamper with.

---

## 17. Testing Strategy (Frontend)

| Layer | Approach |
|---|---|
| Component/unit | Component tests for shared `packages/ui` primitives (especially `StatusBadge`, `CountdownTimer`, urgency-coloring logic) — these are the components with actual product logic embedded, not just styling |
| Hook logic | Isolated tests for `useOrder`'s WS-overlay/fallback-to-polling behavior, since this is the riskiest piece of custom logic in the shared layer |
| Integration | Per-app flow tests: Customer PWA's scan→browse→checkout→track happy path; KDS's queue-advance flow; Owner Dashboard's permission-filtered nav rendering for each role |
| E2E | Full order lifecycle across apps in a staging environment — place an order in Customer PWA, advance it through KDS, verify the countdown/status updates propagate live to both the customer tracking page and the owner dashboard's live queue depth |
| Push/notification | Manual + scripted verification of the Service Worker's `push`/`notificationclick` handlers against a test push payload, since this path can't be meaningfully unit-tested in isolation (it depends on real browser push service behavior) |
| Load | The frontend's role in the backend's "dinner rush" load test (Part 7.5 of the backend doc) is generating realistic WS connection-storm and reconnect-storm behavior via the same `WSManager` reconnect logic real clients use, not a synthetic mock |

---

## 18. Build & Deployment

```yaml
# frontend CI (GitHub Actions excerpt)
- name: Generate API client from OpenAPI schema
  run: |
    cd backend && python manage.py spectacular --file ../frontend/packages/api-client/schema.json
    cd frontend && npx openapi-typescript-codegen \
      --input packages/api-client/schema.json \
      --output packages/api-client/generated \
      --client axios

- name: Build customer PWA
  run: cd frontend/apps/customer-pwa && vite build
  # Output: dist/ → deployed to CDN (CloudFront/Cloudflare Pages)
  # Service Worker included in build output → enables push notifications

- name: Build KDS app
  run: cd frontend/apps/kds && vite build

- name: Build Owner Dashboard
  run: cd frontend/apps/owner-dashboard && vite build

- name: Build Admin Console
  run: cd frontend/apps/admin-console && vite build
```

Each app is a static build deployed to a CDN — zero server-side rendering, since all data is fetched client-side against the REST/WS API. The Customer PWA gets the most aggressive CDN caching policy of the four, for the reasons in Section 14.

**Environments** mirror the backend's `dev` / `staging` / `prod` split, with each frontend build pointed at the matching API base URL via environment-specific `.env` files consumed at build time (Vite's `import.meta.env`) — no runtime environment switching, to keep each deployed bundle a fully static, cacheable artifact.

---

## 19. Frontend Build Roadmap (mirrors backend phasing)

| Phase | Frontend scope |
|---|---|
| **Phase 1 — Core ordering** | Customer PWA: menu browse, checkout, phone+OTP identify, basic order tracking via plain WS (no push yet, REST polling acceptable interim). KDS: pairing + basic status board. Owner Dashboard: read-only order list. Admin Console: read-only vendor list. |
| **Phase 2 — Real-time + Notifications** | Service Worker + Web Push integration end to end, `usePushPermission` flow, queue-position display, `WSManager` reconnect/fallback hardening. |
| **Phase 3 — Payments** | `CheckoutPage.tsx` payment-method selection, gateway redirect + `PaymentReturnPage.tsx`, Owner Dashboard payouts pages. |
| **Phase 4 — AI Wave 1** | KDS queue re-sequencing reflected live (AI reorders the board, not just the worker), prep-time-driven countdown honesty improves automatically as the backend model comes online — no frontend change required beyond consuming the same `estimated_ready_at` field more accurately. |
| **Phase 5 — AI Wave 2** | `VoiceOrderModal.tsx` end to end, Owner Dashboard's `AIInsightsPage.tsx` / `CopilotDigestCard.tsx`, Admin Console's `VendorHealthPage.tsx` churn-risk table and `FraudQueuePage.tsx`. |
| **Phase 6 — Scale & polish** | Full bilingual (Bangla/English) coverage across all four apps, accessibility audit pass, performance budget enforcement in CI (bundle-size checks on the Customer PWA specifically). |

---

## 20. Open Assumptions Flagged for Confirmation

A few conventional choices were made here to fill gaps the backend document didn't specify at the frontend-tooling level — worth confirming rather than treating as settled:

- **Workspace manager**: pnpm workspaces assumed; Yarn/Turborepo are equally valid and don't change anything else in this document.
- **i18n library**: `react-i18next` assumed as a standard choice; not specified in the source architecture.
- **Icon set**: `lucide-react` assumed for consistency with the shadcn/ui ecosystem already in use.
- **E2E tooling**: not specified in the source document; Playwright is the natural fit given Vite + React and is assumed here without further detail.

Everything else in this document — the four-app split, shared packages, state management table, real-time fusion pattern, PWA/push contract, auth flows, and per-app page/component structure — is drawn directly from the CartCloud backend architecture document's Part 11 (React Frontend Architecture) and the cross-referenced product/UX detail in Parts 3, 4, 8, and 9.