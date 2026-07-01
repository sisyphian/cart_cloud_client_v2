import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@cart-cloud/api-client';

// Placeholder types
interface CartItem {
  menuItemId: string;
  quantity: number;
}

interface Cart {
  id: string;
  vendorId: string;
  items: CartItem[];
  total: number;
}

interface AddToCartInput {
  vendorId: string;
  menuItemId: string;
  quantity: number;
}

export const cartKeys = {
  all: ['cart'] as const,
  current: (vendorId: string) => [...cartKeys.all, vendorId] as const,
};

// Get current cart for a vendor
export const useCart = (vendorId: string) => {
  return useQuery({
    queryKey: cartKeys.current(vendorId),
    queryFn: async () => {
      const response = await apiClient.get(`/cart`, { params: { vendorId } });
      return response.data as Cart;
    },
    enabled: !!vendorId,
  });
};

// Add item to cart
export const useAddToCart = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AddToCartInput) => {
      const response = await apiClient.post('/cart/items', input);
      return response.data as Cart;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(cartKeys.current(data.vendorId), data);
    },
  });
};

// Remove item from cart
export const useRemoveFromCart = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ vendorId, menuItemId }: { vendorId: string; menuItemId: string }) => {
      const response = await apiClient.delete(`/cart/items`, { data: { vendorId, menuItemId } });
      return response.data as Cart;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(cartKeys.current(data.vendorId), data);
    },
  });
};

// Clear cart
export const useClearCart = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vendorId: string) => {
      const response = await apiClient.delete(`/cart`, { params: { vendorId } });
      return response.data;
    },
    onSuccess: (_, vendorId) => {
      queryClient.setQueryData(cartKeys.current(vendorId), null);
    },
  });
};
