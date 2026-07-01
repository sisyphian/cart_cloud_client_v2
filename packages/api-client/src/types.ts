// Type definitions matching the database schema from architecture document

export type OrderStatus =
  | 'pending_payment'
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled_by_customer'
  | 'cancelled_by_vendor'
  | 'payment_failed';

export type PaymentMethod = 'cash' | 'bkash' | 'nagad' | 'sslcommerz' | 'stripe';

export type SubscriptionTier = 'free' | 'growth' | 'pro';

export type RegistrationStatus = 'pending' | 'verified' | 'suspended' | 'terminated';

export interface Customer {
  id: string;
  phone_number: string;
  display_name: string;
  phone_verified: boolean;
  preferred_language: 'bn' | 'en';
  marketing_opt_in: boolean;
  created_at: string;
  updated_at: string;
  is_blocked: boolean;
  blocked_reason?: string;
  risk_score: number;
}

export interface Vendor {
  id: string;
  business_name: string;
  owner_user_id: string;
  registration_status: RegistrationStatus;
  kyc_document_url?: string;
  tax_id?: string;
  settlement_account_json: Record<string, unknown>;
  platform_commission_pct: number;
  default_timezone: string;
  default_currency: string;
  subscription_tier: SubscriptionTier;
  created_at: string;
  suspended_at?: string;
  suspension_reason?: string;
}

export interface Cart {
  id: string;
  vendor_id: string;
  name: string;
  public_slug: string;
  qr_token: string;
  qr_token_version: number;
  location_lat?: number;
  location_lng?: number;
  address_text?: string;
  is_open: boolean;
  is_accepting_online_orders: boolean;
  accepts_cash: boolean;
  accepts_online_payment: boolean;
  avg_prep_time_seconds: number;
  max_concurrent_orders: number;
  created_at: string;
  updated_at: string;
}

export interface MenuItemOptionChoice {
  id: string;
  label: string;
  price_delta: number;
  is_default: boolean;
}

export interface MenuItemOption {
  id: string;
  option_group_name: string;
  is_required: boolean;
  allows_multiple: boolean;
  sort_order: number;
  choices: MenuItemOptionChoice[];
}

export interface MenuItem {
  id: string;
  category_id: string;
  cart_id: string;
  name: string;
  name_bn?: string;
  description?: string;
  price: number;
  image_url?: string;
  is_available: boolean;
  avg_prep_time_seconds?: number;
  dietary_tags: string[];
  sort_order: number;
  created_at: string;
  updated_at: string;
  options?: MenuItemOption[];
}

export interface MenuCategory {
  id: string;
  menu_id: string;
  name: string;
  sort_order: number;
  items: MenuItem[];
}

export interface Menu {
  id: string;
  cart_id: string;
  version: number;
  is_active: boolean;
  created_at: string;
  categories: MenuCategory[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  item_name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  selected_options: MenuItemOptionChoice[];
  line_total: number;
}

export interface Order {
  id: string;
  order_number: string;
  cart_id: string;
  vendor_id: string;
  customer_id: string;
  guest_display_name: string;
  status: OrderStatus;
  payment_method: PaymentMethod;
  subtotal: number;
  platform_fee: number;
  total: number;
  currency: string;
  special_instructions?: string;
  estimated_ready_at?: string;
  estimated_ready_at_initial?: string;
  accepted_at?: string;
  ready_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  cancellation_reason?: string;
  queue_position?: number;
  placed_via: string;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
  cart?: Cart;
}

export interface PaymentTransaction {
  id: string;
  order_id: string;
  gateway: string;
  gateway_transaction_id?: string;
  amount: number;
  currency: string;
  status: 'initiated' | 'success' | 'failed' | 'refunded';
  raw_gateway_payload: Record<string, unknown>;
  initiated_at: string;
  completed_at?: string;
}

export interface VendorPayout {
  id: string;
  vendor_id: string;
  period_start: string;
  period_end: string;
  gross_amount: number;
  platform_commission: number;
  net_payout: number;
  status: 'pending' | 'processing' | 'paid' | 'failed';
  payout_method?: string;
  payout_reference?: string;
  processed_by?: string;
  created_at: string;
  paid_at?: string;
}

export interface StaffUser {
  id: string;
  phone_number?: string;
  email?: string;
  full_name: string;
  is_platform_admin: boolean;
  is_support_agent: boolean;
  is_active: boolean;
  last_login_at?: string;
  created_at: string;
}

export interface Role {
  id: string;
  name: string;
  permissions: string[];
  is_system_role: boolean;
  vendor_id?: string;
}

export interface UserRoleAssignment {
  id: string;
  user_id: string;
  role_id: string;
  vendor_id?: string;
  cart_id?: string;
  granted_by: string;
  created_at: string;
}

// Inventory types
export interface Ingredient {
  id: string;
  cart_id: string;
  name: string;
  name_bn?: string;
  unit: string;
  cost_per_unit?: number;
  reorder_threshold: number;
  reorder_quantity: number;
  preferred_supplier_id?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface IngredientStockLevel {
  id: string;
  ingredient_id: string;
  cart_id: string;
  current_quantity: number;
  last_counted_at?: string;
  updated_at: string;
}

export type StockMovementType =
  | 'order_deduction'
  | 'order_reversal'
  | 'manual_restock'
  | 'manual_adjustment'
  | 'wastage'
  | 'opening_count'
  | 'transfer_in'
  | 'transfer_out';

export interface StockMovement {
  id: string;
  cart_id: string;
  ingredient_id?: string;
  menu_item_id?: string;
  movement_type: StockMovementType;
  quantity_delta: number;
  quantity_before: number;
  quantity_after: number;
  order_id?: string;
  triggered_by?: string;
  notes?: string;
  created_at: string;
}

export interface Supplier {
  id: string;
  vendor_id: string;
  name: string;
  contact_phone?: string;
  contact_name?: string;
  address_text?: string;
  notes?: string;
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  cart_id: string;
  supplier_id?: string;
  status: 'draft' | 'sent' | 'partially_received' | 'received' | 'cancelled';
  expected_delivery_date?: string;
  notes?: string;
  created_by: string;
  created_at: string;
  received_at?: string;
}

export interface PurchaseOrderLine {
  id: string;
  purchase_order_id: string;
  ingredient_id: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost?: number;
  is_received: boolean;
}

// API Response envelope
export interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    page_size?: number;
    total?: number;
  };
  error?: {
    code: string;
    message: string;
    field_errors?: Record<string, string>;
  };
}

// Public menu response
export interface PublicMenuResponse {
  cart_name: string;
  is_open: boolean;
  accepts_cash: boolean;
  accepts_online_payment: boolean;
  estimated_wait_seconds: number;
  categories: MenuCategory[];
}
