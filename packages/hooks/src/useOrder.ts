import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mockApi } from '@cart-cloud/api-client';
import type { Order } from '@cart-cloud/api-client';

interface CreateOrderInput {
  slug: string;
  items: Array<{ menu_item_id: string; quantity: number; selected_option_choice_ids?: string[] }>;
  payment_method: string;
  special_instructions?: string;
}

// Query keys
export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: (filters: string) => [...orderKeys.lists(), { filters }] as const,
  details: () => [...orderKeys.all, 'detail'] as const,
  detail: (id: string) => [...orderKeys.details(), id] as const,
  customer: (customerId: string) => [...orderKeys.all, 'customer', customerId] as const,
  kds: (cartId: string) => [...orderKeys.all, 'kds', cartId] as const,
};

// Fetch order by ID
export const useOrder = (id: string) => {
  return useQuery({
    queryKey: orderKeys.detail(id),
    queryFn: async () => {
      const response = await mockApi.getOrder(id);
      return response.data as Order | null;
    },
    enabled: !!id,
  });
};

// Fetch customer orders
export const useCustomerOrders = (customerId: string, page = 1, pageSize = 20) => {
  return useQuery({
    queryKey: [...orderKeys.customer(customerId), page, pageSize],
    queryFn: async () => {
      const response = await mockApi.getCustomerOrders(customerId, page, pageSize);
      return response.data;
    },
    enabled: !!customerId,
  });
};

// Fetch KDS queue for a cart
export const useKDSQueue = (cartId: string) => {
  return useQuery({
    queryKey: orderKeys.kds(cartId),
    queryFn: async () => {
      const response = await mockApi.getKDSQueue(cartId);
      return response.data as Order[];
    },
    enabled: !!cartId,
    refetchInterval: 5000, // Poll every 5 seconds for KDS
  });
};

// Create order mutation
export const useCreateOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateOrderInput) => {
      const response = await mockApi.createOrder(input.slug, input);
      return response.data as Order;
    },
    onSuccess: (data) => {
      // Invalidate and refetch orders list
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
      // Set the new order in cache
      queryClient.setQueryData(orderKeys.detail(data.id), data);
    },
  });
};

// Update order status mutation
export const useUpdateOrderStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const response = await mockApi.updateOrderStatus(id, status);
      return response.data as Order;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(orderKeys.detail(data.id), data);
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
      queryClient.invalidateQueries({ queryKey: orderKeys.kds(data.cart_id) });
    },
  });
};

// Cancel order mutation
export const useCancelOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const response = await mockApi.cancelOrder(id, reason);
      return response.data as Order;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(orderKeys.detail(data.id), data);
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
    },
  });
};
