# CartCloud Frontend Monorepo

A monorepo containing four React applications and shared packages for the CartCloud street food ordering platform.

## Architecture

### Applications

- **customer-pwa** - Progressive Web App for customers to browse menus and place orders (port 3000)
- **kds** - Kitchen Display System for tablet-based order management (port 3001)
- **owner-dashboard** - Dashboard for cart owners to manage their business (port 3002)
- **admin-console** - Admin console for platform-wide management (port 3003)

### Shared Packages

- **@cart-cloud/ui** - Design system with shadcn/ui components and CartCloud-specific design tokens
- **@cart-cloud/api-client** - Axios-based API client with auth headers and OpenAPI generation support
- **@cart-cloud/ws-client** - WebSocket manager with auto-reconnect and heartbeat
- **@cart-cloud/hooks** - React Query hooks combining REST and WebSocket data

## Tech Stack

- **React 18** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **pnpm** - Package manager with workspace support
- **Tailwind CSS** - Utility-first CSS
- **shadcn/ui** - Component library
- **TanStack Query** - Data fetching and caching
- **Zustand** - State management
- **React Router** - Client-side routing

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+

### Installation

```bash
# Install dependencies
pnpm install
```

### Development

Run all applications in development mode:

```bash
# Start all apps
pnpm dev

# Or start individual apps
cd apps/customer-pwa && pnpm dev
cd apps/kds && pnpm dev
cd apps/owner-dashboard && pnpm dev
cd apps/admin-console && pnpm dev
```

### Building

```bash
# Build all apps
pnpm build

# Build individual apps
cd apps/customer-pwa && pnpm build
```

### Type Checking

```bash
# Type check all packages and apps
pnpm type-check

# Type check individual package
cd packages/ui && pnpm type-check
```

### Linting

```bash
# Lint all packages and apps
pnpm lint
```

## Environment Variables

Each application requires the following environment variables:

```bash
VITE_API_URL=http://localhost:8000/api
VITE_WS_URL=ws://localhost:8000/ws
```

Create `.env` files in each app directory:

```bash
# apps/customer-pwa/.env
VITE_API_URL=http://localhost:8000/api
VITE_WS_URL=ws://localhost:8000/ws
```

## Project Structure

```
cart_cloud_client_v2/
├── apps/
│   ├── customer-pwa/       # Customer PWA
│   ├── kds/                # Kitchen Display System
│   ├── owner-dashboard/    # Owner Dashboard
│   └── admin-console/      # Admin Console
├── packages/
│   ├── ui/                 # Shared UI components
│   ├── api-client/         # API client
│   ├── ws-client/          # WebSocket client
│   └── hooks/              # React Query hooks
├── package.json            # Root package.json
├── pnpm-workspace.yaml     # Workspace configuration
└── tsconfig.json           # Base TypeScript config
```

## API Client Generation

The API client is generated from an OpenAPI schema:

```bash
# Generate API client (requires schema.json in packages/api-client/)
cd packages/api-client
pnpm generate:client
```

## Design Tokens

The UI package uses CSS custom properties for theming. Design tokens are defined in `packages/ui/src/tokens.css` and include:

- Base shadcn/ui colors (border, background, foreground, primary, etc.)
- CartCloud-specific order status colors (pending, confirmed, preparing, ready, completed, cancelled)

## Key Features

### Shared Components

- **StatusBadge** - Displays order status with consistent colors
- **CountdownTimer** - Live countdown for order ready times
- **Button, Card** - Reusable UI components from shadcn/ui

### WebSocket Integration

The `ws-client` package provides:
- Singleton WebSocket manager
- Auto-reconnect with exponential backoff
- Heartbeat/ping-pong for connection health
- React hook (`useWebSocket`) for easy integration

### React Query Hooks

The `hooks` package provides:
- `useOrder` - Fetch and manage orders with real-time updates
- `useCart` - Cart management (add, remove, clear items)
- `useMenu` - Vendor and menu data fetching
- `useAuth` - Authentication (phone-based login)

## License

Private - All rights reserved
