import type {
  Cart,
  Customer,
  MenuItem,
  MenuCategory,
  Order,
  Vendor,
  Ingredient,
  IngredientStockLevel,
  StockMovement,
  Supplier,
  PurchaseOrder,
  StaffUser,
  VendorPayout,
  PublicMenuResponse,
} from './types';

// Helper to generate UUIDs
const uuid = () => crypto.randomUUID();

// Mock Customers
export const mockCustomers: Customer[] = [
  {
    id: uuid(),
    phone_number: '+8801712345678',
    display_name: 'Rahim Ahmed',
    phone_verified: true,
    preferred_language: 'bn',
    marketing_opt_in: true,
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    is_blocked: false,
    risk_score: 5,
  },
  {
    id: uuid(),
    phone_number: '+8801812345678',
    display_name: 'Karim Uddin',
    phone_verified: true,
    preferred_language: 'en',
    marketing_opt_in: false,
    created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    is_blocked: false,
    risk_score: 0,
  },
];

// Mock Vendors
export const mockVendors: Vendor[] = [
  {
    id: uuid(),
    business_name: "Rafiq's Fuchka Cart",
    owner_user_id: uuid(),
    registration_status: 'verified',
    kyc_document_url: 'https://example.com/kyc/rafiq.pdf',
    tax_id: '1234567890123',
    settlement_account_json: { bkash_number: '+8801712345678' },
    platform_commission_pct: 5.0,
    default_timezone: 'Asia/Dhaka',
    default_currency: 'BDT',
    subscription_tier: 'growth',
    created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: uuid(),
    business_name: 'Dhanmondi Borhani Stall',
    owner_user_id: uuid(),
    registration_status: 'verified',
    tax_id: '9876543210987',
    settlement_account_json: { nagad_number: '+8801812345678' },
    platform_commission_pct: 5.0,
    default_timezone: 'Asia/Dhaka',
    default_currency: 'BDT',
    subscription_tier: 'pro',
    created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// Mock Carts
export const mockCarts: Cart[] = [
  {
    id: uuid(),
    vendor_id: mockVendors[0].id,
    name: "Rafiq's Fuchka - Dhanmondi 7",
    public_slug: 'rafiqs-dhanmondi-7',
    qr_token: 'abc123xyz789',
    qr_token_version: 1,
    location_lat: 23.7465,
    location_lng: 90.3760,
    address_text: 'Road 7, Dhanmondi, Dhaka',
    is_open: true,
    is_accepting_online_orders: true,
    accepts_cash: true,
    accepts_online_payment: true,
    avg_prep_time_seconds: 600,
    max_concurrent_orders: 10,
    created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: uuid(),
    vendor_id: mockVendors[0].id,
    name: "Rafiq's Fuchka - Mirpur 10",
    public_slug: 'rafiqs-mirpur-10',
    qr_token: 'def456uvw012',
    qr_token_version: 1,
    location_lat: 23.8223,
    location_lng: 90.3650,
    address_text: 'Section 10, Mirpur, Dhaka',
    is_open: true,
    is_accepting_online_orders: true,
    accepts_cash: true,
    accepts_online_payment: false,
    avg_prep_time_seconds: 480,
    max_concurrent_orders: 8,
    created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: uuid(),
    vendor_id: mockVendors[1].id,
    name: 'Dhanmondi Borhani - Main Stall',
    public_slug: 'dhanmondi-borhani-main',
    qr_token: 'ghi789rst345',
    qr_token_version: 1,
    location_lat: 23.7480,
    location_lng: 90.3780,
    address_text: 'Satmasjid Road, Dhanmondi, Dhaka',
    is_open: true,
    is_accepting_online_orders: true,
    accepts_cash: true,
    accepts_online_payment: true,
    avg_prep_time_seconds: 300,
    max_concurrent_orders: 15,
    created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

// Mock Menu Items
const fuchkaItems: MenuItem[] = [
  {
    id: uuid(),
    category_id: '',
    cart_id: mockCarts[0].id,
    name: 'Special Fuchka',
    name_bn: 'স্পেশাল ফুচকা',
    description: 'Crispy shells filled with spiced tamarind water, chickpeas, and potatoes',
    price: 30,
    image_url: 'https://images.unsplash.com/photo-1626804475297-411dbe86b67b?w=400',
    is_available: true,
    avg_prep_time_seconds: 120,
    dietary_tags: ['spicy', 'vegetarian'],
    sort_order: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    options: [
      {
        id: uuid(),
        option_group_name: 'Spice Level',
        is_required: true,
        allows_multiple: false,
        sort_order: 1,
        choices: [
          { id: uuid(), label: 'Mild', price_delta: 0, is_default: true },
          { id: uuid(), label: 'Medium', price_delta: 0, is_default: false },
          { id: uuid(), label: 'Hot', price_delta: 0, is_default: false },
        ],
      },
    ],
  },
  {
    id: uuid(),
    category_id: '',
    cart_id: mockCarts[0].id,
    name: 'Jhal Fuchka',
    name_bn: 'ঝাল ফুচকা',
    description: 'Extra spicy version with green chili and mustard oil',
    price: 35,
    image_url: 'https://images.unsplash.com/photo-1626804475297-411dbe86b67b?w=400',
    is_available: true,
    avg_prep_time_seconds: 120,
    dietary_tags: ['spicy', 'vegetarian'],
    sort_order: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: uuid(),
    category_id: '',
    cart_id: mockCarts[0].id,
    name: 'Egg Fuchka',
    name_bn: 'ডিম ফুচকা',
    description: 'Topped with boiled egg and special masala',
    price: 45,
    image_url: 'https://images.unsplash.com/photo-1626804475297-411dbe86b67b?w=400',
    is_available: true,
    avg_prep_time_seconds: 150,
    dietary_tags: ['spicy'],
    sort_order: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const drinkItems: MenuItem[] = [
  {
    id: uuid(),
    category_id: '',
    cart_id: mockCarts[0].id,
    name: 'Lemonade',
    name_bn: 'লেবুর শরবত',
    description: 'Fresh lemonade with mint',
    price: 40,
    image_url: 'https://images.unsplash.com/photo-1621263764928-df1444c5e859?w=400',
    is_available: true,
    avg_prep_time_seconds: 60,
    dietary_tags: ['cold', 'vegetarian'],
    sort_order: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: uuid(),
    category_id: '',
    cart_id: mockCarts[0].id,
    name: 'Borhani',
    name_bn: 'বরহানি',
    description: 'Traditional spiced yogurt drink',
    price: 50,
    image_url: 'https://images.unsplash.com/photo-1582562124811-c09040d0a901?w=400',
    is_available: true,
    avg_prep_time_seconds: 60,
    dietary_tags: ['cold', 'vegetarian'],
    sort_order: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

// Assign category IDs
const fuchkaCategoryId = uuid();
const drinksCategoryId = uuid();
fuchkaItems.forEach(item => item.category_id = fuchkaCategoryId);
drinkItems.forEach(item => item.category_id = drinksCategoryId);

// Mock Menu Categories
export const mockMenuCategories: MenuCategory[] = [
  {
    id: fuchkaCategoryId,
    menu_id: uuid(),
    name: 'Fuchka',
    sort_order: 1,
    items: fuchkaItems,
  },
  {
    id: drinksCategoryId,
    menu_id: uuid(),
    name: 'Drinks',
    sort_order: 2,
    items: drinkItems,
  },
];

// Mock Orders
export const mockOrders: Order[] = [
  {
    id: uuid(),
    order_number: 'A-001',
    cart_id: mockCarts[0].id,
    vendor_id: mockVendors[0].id,
    customer_id: mockCustomers[0].id,
    guest_display_name: 'Rahim Ahmed',
    status: 'ready',
    payment_method: 'cash',
    subtotal: 75,
    platform_fee: 3.75,
    total: 78.75,
    currency: 'BDT',
    estimated_ready_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    accepted_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    queue_position: 1,
    placed_via: 'qr_web',
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    items: [
      {
        id: uuid(),
        order_id: '',
        menu_item_id: fuchkaItems[0].id,
        item_name_snapshot: fuchkaItems[0].name,
        unit_price_snapshot: fuchkaItems[0].price,
        quantity: 2,
        selected_options: [],
        line_total: 60,
      },
      {
        id: uuid(),
        order_id: '',
        menu_item_id: drinkItems[0].id,
        item_name_snapshot: drinkItems[0].name,
        unit_price_snapshot: drinkItems[0].price,
        quantity: 1,
        selected_options: [],
        line_total: 40,
      },
    ],
    cart: mockCarts[0],
  },
  {
    id: uuid(),
    order_number: 'A-002',
    cart_id: mockCarts[0].id,
    vendor_id: mockVendors[0].id,
    customer_id: mockCustomers[1].id,
    guest_display_name: 'Karim Uddin',
    status: 'preparing',
    payment_method: 'bkash',
    subtotal: 35,
    platform_fee: 1.75,
    total: 36.75,
    currency: 'BDT',
    estimated_ready_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    accepted_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    queue_position: 2,
    placed_via: 'qr_web',
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    items: [
      {
        id: uuid(),
        order_id: '',
        menu_item_id: fuchkaItems[1].id,
        item_name_snapshot: fuchkaItems[1].name,
        unit_price_snapshot: fuchkaItems[1].price,
        quantity: 1,
        selected_options: [],
        line_total: 35,
      },
    ],
    cart: mockCarts[0],
  },
  {
    id: uuid(),
    order_number: 'A-003',
    cart_id: mockCarts[0].id,
    vendor_id: mockVendors[0].id,
    customer_id: uuid(),
    guest_display_name: 'Guest User',
    status: 'placed',
    payment_method: 'cash',
    subtotal: 45,
    platform_fee: 2.25,
    total: 47.25,
    currency: 'BDT',
    estimated_ready_at: new Date(Date.now() + 12 * 60 * 1000).toISOString(),
    queue_position: 3,
    placed_via: 'qr_web',
    created_at: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    items: [
      {
        id: uuid(),
        order_id: '',
        menu_item_id: fuchkaItems[2].id,
        item_name_snapshot: fuchkaItems[2].name,
        unit_price_snapshot: fuchkaItems[2].price,
        quantity: 1,
        selected_options: [],
        line_total: 45,
      },
    ],
    cart: mockCarts[0],
  },
];

// Fix order_item order_id references
mockOrders.forEach(order => {
  order.items.forEach(item => item.order_id = order.id);
});

// Mock Ingredients
export const mockIngredients: Ingredient[] = [
  {
    id: uuid(),
    cart_id: mockCarts[0].id,
    name: 'Tamarind Water',
    name_bn: 'তেঁতুলের পানি',
    unit: 'ml',
    cost_per_unit: 0.05,
    reorder_threshold: 2000,
    reorder_quantity: 5000,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: uuid(),
    cart_id: mockCarts[0].id,
    name: 'Chickpeas',
    name_bn: 'বুট',
    unit: 'g',
    cost_per_unit: 0.02,
    reorder_threshold: 1000,
    reorder_quantity: 3000,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: uuid(),
    cart_id: mockCarts[0].id,
    name: 'Fuchka Shells',
    name_bn: 'ফুচকার খোল',
    unit: 'piece',
    cost_per_unit: 0.5,
    reorder_threshold: 200,
    reorder_quantity: 500,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: uuid(),
    cart_id: mockCarts[0].id,
    name: 'Potatoes',
    name_bn: 'আলু',
    unit: 'kg',
    cost_per_unit: 40,
    reorder_threshold: 5,
    reorder_quantity: 20,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

// Mock Ingredient Stock Levels
export const mockIngredientStockLevels: IngredientStockLevel[] = mockIngredients.map(ing => ({
  id: uuid(),
  ingredient_id: ing.id,
  cart_id: ing.cart_id,
  current_quantity: Math.floor(Math.random() * 3000) + 500,
  last_counted_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  updated_at: new Date().toISOString(),
}));

// Mock Stock Movements
export const mockStockMovements: StockMovement[] = [
  {
    id: uuid(),
    cart_id: mockCarts[0].id,
    ingredient_id: mockIngredients[0].id,
    movement_type: 'manual_restock',
    quantity_delta: 2000,
    quantity_before: 500,
    quantity_after: 2500,
    triggered_by: uuid(),
    notes: 'Weekly restock',
    created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: uuid(),
    cart_id: mockCarts[0].id,
    ingredient_id: mockIngredients[0].id,
    movement_type: 'order_deduction',
    quantity_delta: -100,
    quantity_before: 2500,
    quantity_after: 2400,
    order_id: mockOrders[0].id,
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  },
  {
    id: uuid(),
    cart_id: mockCarts[0].id,
    ingredient_id: mockIngredients[1].id,
    movement_type: 'wastage',
    quantity_delta: -50,
    quantity_before: 1500,
    quantity_after: 1450,
    triggered_by: uuid(),
    notes: 'Spoiled batch',
    created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },
];

// Mock Suppliers
export const mockSuppliers: Supplier[] = [
  {
    id: uuid(),
    vendor_id: mockVendors[0].id,
    name: 'Karim Traders',
    contact_phone: '+8801711111111',
    contact_name: 'Karim',
    address_text: 'New Market, Dhaka',
    notes: 'Reliable tamarind supplier',
    created_at: new Date().toISOString(),
  },
  {
    id: uuid(),
    vendor_id: mockVendors[0].id,
    name: 'Fresh Veggies Ltd',
    contact_phone: '+8801722222222',
    contact_name: 'Rahim',
    address_text: 'Kawran Bazar, Dhaka',
    created_at: new Date().toISOString(),
  },
];

// Mock Purchase Orders
export const mockPurchaseOrders: PurchaseOrder[] = [
  {
    id: uuid(),
    cart_id: mockCarts[0].id,
    supplier_id: mockSuppliers[0].id,
    status: 'received',
    expected_delivery_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    notes: 'Weekly order',
    created_by: uuid(),
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    received_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: uuid(),
    cart_id: mockCarts[0].id,
    supplier_id: mockSuppliers[1].id,
    status: 'sent',
    expected_delivery_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    created_by: uuid(),
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// Mock Staff Users
export const mockStaffUsers: StaffUser[] = [
  {
    id: uuid(),
    email: 'rafiq@example.com',
    full_name: 'Rafiq Ahmed',
    is_platform_admin: false,
    is_support_agent: false,
    is_active: true,
    last_login_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: uuid(),
    phone_number: '+8801912345678',
    full_name: 'Jamal Hossain',
    is_platform_admin: false,
    is_support_agent: false,
    is_active: true,
    last_login_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: uuid(),
    email: 'admin@cartcloud.app',
    full_name: 'Platform Admin',
    is_platform_admin: true,
    is_support_agent: false,
    is_active: true,
    last_login_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// Mock Vendor Payouts
export const mockVendorPayouts: VendorPayout[] = [
  {
    id: uuid(),
    vendor_id: mockVendors[0].id,
    period_start: '2024-01-01',
    period_end: '2024-01-31',
    gross_amount: 125000,
    platform_commission: 6250,
    net_payout: 118750,
    status: 'paid',
    payout_method: 'bkash',
    payout_reference: 'TXN123456',
    processed_by: uuid(),
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    paid_at: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: uuid(),
    vendor_id: mockVendors[0].id,
    period_start: '2024-02-01',
    period_end: '2024-02-29',
    gross_amount: 145000,
    platform_commission: 7250,
    net_payout: 137750,
    status: 'pending',
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// Public Menu Response
export const mockPublicMenuResponse: PublicMenuResponse = {
  cart_name: mockCarts[0].name,
  is_open: mockCarts[0].is_open,
  accepts_cash: mockCarts[0].accepts_cash,
  accepts_online_payment: mockCarts[0].accepts_online_payment,
  estimated_wait_seconds: 480,
  categories: mockMenuCategories,
};

// Helper functions for mock data operations
export const getCartBySlug = (slug: string): Cart | undefined => {
  return mockCarts.find(c => c.public_slug === slug);
};

export const getOrdersByCartId = (cartId: string): Order[] => {
  return mockOrders.filter(o => o.cart_id === cartId);
};

export const getOrdersByCustomerId = (customerId: string): Order[] => {
  return mockOrders.filter(o => o.customer_id === customerId);
};

export const getOrderById = (orderId: string): Order | undefined => {
  return mockOrders.find(o => o.id === orderId);
};

export const getIngredientsByCartId = (cartId: string): Ingredient[] => {
  return mockIngredients.filter(i => i.cart_id === cartId);
};

export const getStockLevelsByCartId = (cartId: string): IngredientStockLevel[] => {
  return mockIngredientStockLevels.filter(s => s.cart_id === cartId);
};

export const getStockMovementsByCartId = (cartId: string): StockMovement[] => {
  return mockStockMovements.filter(m => m.cart_id === cartId);
};
