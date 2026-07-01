import type {
  Order,
  StockMovement,
  Supplier,
  PurchaseOrder,
} from './types';
import {
  mockCarts,
  mockCustomers,
  mockOrders,
  mockMenuCategories,
  mockPublicMenuResponse,
  mockStockMovements,
  mockSuppliers,
  mockPurchaseOrders,
  mockVendors,
  mockVendorPayouts,
  mockStaffUsers,
  getCartBySlug,
  getOrdersByCartId,
  getOrdersByCustomerId,
  getOrderById,
  getIngredientsByCartId,
  getStockLevelsByCartId,
  getStockMovementsByCartId,
} from './mock-data';

// Simulate network delay
const delay = (ms: number = 300) => new Promise(resolve => setTimeout(resolve, ms));

// Mock API Service
export const mockApi = {
  // Customer endpoints
  async identifyCustomer(phoneNumber: string, _displayName: string, _deviceId: string) {
    await delay();
    const existingCustomer = mockCustomers.find(c => c.phone_number === phoneNumber);
    if (existingCustomer) {
      return {
        data: {
          otp_required: false,
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          customer: existingCustomer,
        },
      };
    }
    return {
      data: {
        otp_required: true,
        otp_session_id: 'mock-otp-session',
      },
    };
  },

  async verifyOtp(_otpSessionId: string, _otpCode: string) {
    await delay();
    return {
      data: {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        customer: mockCustomers[0],
      },
    };
  },

  // Public cart endpoints
  async getCartBySlug(slug: string, _qrToken?: string) {
    await delay();
    const cart = getCartBySlug(slug);
    if (!cart) {
      return {
        data: null,
        error: { code: 'CART_NOT_FOUND', message: 'Cart not found' },
      };
    }
    return { data: cart };
  },

  async getCartMenu(slug: string, _qrToken?: string) {
    await delay();
    const cart = getCartBySlug(slug);
    if (!cart) {
      return {
        data: null,
        error: { code: 'CART_NOT_FOUND', message: 'Cart not found' },
      };
    }
    return { data: mockPublicMenuResponse };
  },

  // Order endpoints
  async createOrder(slug: string, orderData: {
    items: Array<{ menu_item_id: string; quantity: number; selected_option_choice_ids?: string[] }>;
    payment_method: string;
    special_instructions?: string;
  }) {
    await delay();
    const cart = getCartBySlug(slug);
    if (!cart) {
      return {
        data: null,
        error: { code: 'CART_NOT_FOUND', message: 'Cart not found' },
      };
    }

    const newOrder: Order = {
      id: crypto.randomUUID(),
      order_number: `A-${String(mockOrders.length + 1).padStart(3, '0')}`,
      cart_id: cart.id,
      vendor_id: cart.vendor_id,
      customer_id: mockCustomers[0].id,
      guest_display_name: mockCustomers[0].display_name,
      status: 'placed',
      payment_method: orderData.payment_method as any,
      subtotal: orderData.items.reduce((sum, item) => sum + (item.quantity * 30), 0), // Simplified calculation
      platform_fee: 0,
      total: orderData.items.reduce((sum, item) => sum + (item.quantity * 30), 0),
      currency: 'BDT',
      special_instructions: orderData.special_instructions,
      estimated_ready_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      queue_position: mockOrders.length + 1,
      placed_via: 'qr_web',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      items: orderData.items.map(item => ({
        id: crypto.randomUUID(),
        order_id: '',
        menu_item_id: item.menu_item_id,
        item_name_snapshot: 'Mock Item',
        unit_price_snapshot: 30,
        quantity: item.quantity,
        selected_options: [],
        line_total: item.quantity * 30,
      })),
      cart,
    };

    newOrder.items.forEach(item => item.order_id = newOrder.id);
    mockOrders.push(newOrder);

    return { data: newOrder };
  },

  async getOrder(orderId: string) {
    await delay();
    const order = getOrderById(orderId);
    if (!order) {
      return {
        data: null,
        error: { code: 'ORDER_NOT_FOUND', message: 'Order not found' },
      };
    }
    return { data: order };
  },

  async getCustomerOrders(customerId: string, page = 1, pageSize = 20) {
    await delay();
    const orders = getOrdersByCustomerId(customerId);
    const start = (page - 1) * pageSize;
    const paginatedOrders = orders.slice(start, start + pageSize);
    return {
      data: paginatedOrders,
      meta: { page, page_size: pageSize, total: orders.length },
    };
  },

  async cancelOrder(orderId: string, reason: string) {
    await delay();
    const order = getOrderById(orderId);
    if (!order) {
      return {
        data: null,
        error: { code: 'ORDER_NOT_FOUND', message: 'Order not found' },
      };
    }
    order.status = 'cancelled_by_customer';
    order.cancellation_reason = reason;
    order.cancelled_at = new Date().toISOString();
    order.updated_at = new Date().toISOString();
    return { data: order };
  },

  // KDS endpoints
  async getKDSQueue(cartId: string) {
    await delay();
    const orders = getOrdersByCartId(cartId).filter(
      o => ['placed', 'accepted', 'preparing'].includes(o.status)
    );
    return { data: orders };
  },

  async updateOrderStatus(orderId: string, status: string) {
    await delay();
    const order = getOrderById(orderId);
    if (!order) {
      return {
        data: null,
        error: { code: 'ORDER_NOT_FOUND', message: 'Order not found' },
      };
    }

    const validTransitions: Record<string, string[]> = {
      placed: ['accepted', 'cancelled_by_vendor'],
      accepted: ['preparing', 'cancelled_by_vendor'],
      preparing: ['ready'],
      ready: ['completed'],
    };

    if (!validTransitions[order.status]?.includes(status)) {
      return {
        data: null,
        error: { code: 'INVALID_TRANSITION', message: 'Invalid status transition' },
      };
    }

    order.status = status as any;
    order.updated_at = new Date().toISOString();

    if (status === 'accepted') {
      order.accepted_at = new Date().toISOString();
    } else if (status === 'ready') {
      order.ready_at = new Date().toISOString();
    } else if (status === 'completed') {
      order.completed_at = new Date().toISOString();
    }

    return { data: order };
  },

  async updateMenuItemAvailability(itemId: string, isAvailable: boolean) {
    await delay();
    // Find item across all categories
    for (const category of mockMenuCategories) {
      const item = category.items.find(i => i.id === itemId);
      if (item) {
        item.is_available = isAvailable;
        item.updated_at = new Date().toISOString();
        return { data: item };
      }
    }
    return {
      data: null,
      error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' },
    };
  },

  // Owner dashboard endpoints
  async getVendorMe() {
    await delay();
    return { data: mockVendors[0] };
  },

  async getVendorCarts(vendorId: string) {
    await delay();
    return { data: mockCarts.filter(c => c.vendor_id === vendorId) };
  },

  async getCartOrders(cartId: string, filters?: { status?: string; date_from?: string; date_to?: string }) {
    await delay();
    let orders = getOrdersByCartId(cartId);
    if (filters?.status) {
      orders = orders.filter(o => o.status === filters.status);
    }
    return { data: orders };
  },

  async getCartAnalytics(cartId: string) {
    await delay();
    const orders = getOrdersByCartId(cartId);
    const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
    const avgPrepTime = 600; // Mock value

    return {
      data: {
        total_orders: orders.length,
        total_revenue: totalRevenue,
        avg_prep_time_seconds: avgPrepTime,
        top_items: [
          { name: 'Special Fuchka', count: 45, revenue: 1350 },
          { name: 'Jhal Fuchka', count: 32, revenue: 1120 },
          { name: 'Lemonade', count: 28, revenue: 1120 },
        ],
      },
    };
  },

  async getVendorStaff(_vendorId: string) {
    await delay();
    return { data: mockStaffUsers.filter(s => !s.is_platform_admin) };
  },

  async getVendorPayouts(vendorId: string) {
    await delay();
    return { data: mockVendorPayouts.filter(p => p.vendor_id === vendorId) };
  },

  // Inventory endpoints
  async getIngredients(cartId: string) {
    await delay();
    return { data: getIngredientsByCartId(cartId) };
  },

  async getIngredientStockLevels(cartId: string) {
    await delay();
    const levels = getStockLevelsByCartId(cartId);
    const ingredients = getIngredientsByCartId(cartId);
    
    return {
      data: levels.map(level => ({
        ...level,
        ingredient: ingredients.find(i => i.id === level.ingredient_id),
      })),
    };
  },

  async getStockMovements(cartId: string, filters?: {
    ingredient_id?: string;
    from?: string;
    to?: string;
    type?: string;
  }) {
    await delay();
    let movements = getStockMovementsByCartId(cartId);
    if (filters?.ingredient_id) {
      movements = movements.filter(m => m.ingredient_id === filters.ingredient_id);
    }
    if (filters?.type) {
      movements = movements.filter(m => m.movement_type === filters.type);
    }
    return { data: movements };
  },

  async createStockMovement(cartId: string, movement: {
    ingredient_id?: string;
    menu_item_id?: string;
    movement_type: string;
    quantity_delta: number;
    notes?: string;
  }) {
    await delay();
    const newMovement: StockMovement = {
      id: crypto.randomUUID(),
      cart_id: cartId,
      ingredient_id: movement.ingredient_id,
      menu_item_id: movement.menu_item_id,
      movement_type: movement.movement_type as any,
      quantity_delta: movement.quantity_delta,
      quantity_before: 100, // Mock value
      quantity_after: 100 + movement.quantity_delta,
      notes: movement.notes,
      created_at: new Date().toISOString(),
    };
    mockStockMovements.push(newMovement);
    return { data: newMovement };
  },

  async getSuppliers(vendorId: string) {
    await delay();
    return { data: mockSuppliers.filter(s => s.vendor_id === vendorId) };
  },

  async createSupplier(vendorId: string, supplier: {
    name: string;
    contact_phone?: string;
    contact_name?: string;
    address_text?: string;
    notes?: string;
  }) {
    await delay();
    const newSupplier: Supplier = {
      id: crypto.randomUUID(),
      vendor_id: vendorId,
      ...supplier,
      created_at: new Date().toISOString(),
    };
    mockSuppliers.push(newSupplier);
    return { data: newSupplier };
  },

  async getPurchaseOrders(cartId: string) {
    await delay();
    return { data: mockPurchaseOrders.filter(po => po.cart_id === cartId) };
  },

  async createPurchaseOrder(cartId: string, purchaseOrder: {
    supplier_id?: string;
    expected_delivery_date?: string;
    notes?: string;
    lines: Array<{ ingredient_id: string; quantity_ordered: number; unit_cost?: number }>;
  }) {
    await delay();
    const newPO: PurchaseOrder = {
      id: crypto.randomUUID(),
      cart_id: cartId,
      supplier_id: purchaseOrder.supplier_id,
      status: 'draft',
      expected_delivery_date: purchaseOrder.expected_delivery_date,
      notes: purchaseOrder.notes,
      created_by: mockStaffUsers[0].id,
      created_at: new Date().toISOString(),
    };
    mockPurchaseOrders.push(newPO);
    return { data: newPO };
  },

  // Admin endpoints
  async getAdminVendors(filters?: { status?: string; search?: string }) {
    await delay();
    let vendors = [...mockVendors];
    if (filters?.status) {
      vendors = vendors.filter(v => v.registration_status === filters.status);
    }
    if (filters?.search) {
      vendors = vendors.filter(v => 
        v.business_name.toLowerCase().includes(filters.search!.toLowerCase())
      );
    }
    return { data: vendors };
  },

  async getAdminVendor(vendorId: string) {
    await delay();
    const vendor = mockVendors.find(v => v.id === vendorId);
    if (!vendor) {
      return {
        data: null,
        error: { code: 'VENDOR_NOT_FOUND', message: 'Vendor not found' },
      };
    }
    return { data: vendor };
  },

  async suspendVendor(vendorId: string, reason: string) {
    await delay();
    const vendor = mockVendors.find(v => v.id === vendorId);
    if (!vendor) {
      return {
        data: null,
        error: { code: 'VENDOR_NOT_FOUND', message: 'Vendor not found' },
      };
    }
    vendor.registration_status = 'suspended';
    vendor.suspended_at = new Date().toISOString();
    vendor.suspension_reason = reason;
    return { data: vendor };
  },

  async getAdminPlatformSummary() {
    await delay();
    return {
      data: {
        total_vendors: mockVendors.length,
        active_vendors: mockVendors.filter(v => v.registration_status === 'verified').length,
        total_carts: mockCarts.length,
        active_carts: mockCarts.filter(c => c.is_open).length,
        total_orders: mockOrders.length,
        total_revenue: mockOrders.reduce((sum, o) => sum + o.total, 0),
        orders_today: 45,
        revenue_today: 12500,
      },
    };
  },

  async getAdminOrders(filters?: { cart_id?: string; vendor_id?: string; date_from?: string; date_to?: string }) {
    await delay();
    let orders = [...mockOrders];
    if (filters?.cart_id) {
      orders = orders.filter(o => o.cart_id === filters.cart_id);
    }
    if (filters?.vendor_id) {
      orders = orders.filter(o => o.vendor_id === filters.vendor_id);
    }
    return { data: orders };
  },
};

export default mockApi;
