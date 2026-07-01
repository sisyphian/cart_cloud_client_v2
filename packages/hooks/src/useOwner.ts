import { useQuery } from '@tanstack/react-query';
import { mockApi } from '@cart-cloud/api-client';

export const ownerKeys = {
  all: ['owner'] as const,
  vendor: () => [...ownerKeys.all, 'vendor'] as const,
  carts: (vendorId: string) => [...ownerKeys.all, 'carts', vendorId] as const,
  analytics: (cartId: string) => [...ownerKeys.all, 'analytics', cartId] as const,
  orders: (cartId: string) => [...ownerKeys.all, 'orders', cartId] as const,
};

// Get current vendor
export const useVendorMe = () => {
  return useQuery({
    queryKey: ownerKeys.vendor(),
    queryFn: async () => {
      const response = await mockApi.getVendorMe();
      return response.data;
    },
  });
};

// Get vendor carts
export const useVendorCarts = (vendorId: string) => {
  return useQuery({
    queryKey: ownerKeys.carts(vendorId),
    queryFn: async () => {
      const response = await mockApi.getVendorCarts(vendorId);
      return response.data;
    },
    enabled: !!vendorId,
  });
};

// Get cart analytics
export const useCartAnalytics = (cartId: string) => {
  return useQuery({
    queryKey: ownerKeys.analytics(cartId),
    queryFn: async () => {
      const response = await mockApi.getCartAnalytics(cartId);
      return response.data;
    },
    enabled: !!cartId,
  });
};

// Get cart orders
export const useCartOrders = (cartId: string, filters?: { status?: string; date_from?: string; date_to?: string }) => {
  return useQuery({
    queryKey: [...ownerKeys.orders(cartId), filters],
    queryFn: async () => {
      const response = await mockApi.getCartOrders(cartId, filters);
      return response.data;
    },
    enabled: !!cartId,
  });
};
