import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from '@cart-cloud/ws-client';
import { apiClient } from '@cart-cloud/api-client';

// Placeholder types - will be replaced with generated types
interface Order {
  id: string;
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';
  estimatedReadyAt: string;
  items: OrderItem[];
  total: number;
}

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
}

interface CreateOrderInput {
  vendorId: string;
  items: Array<{ menuItemId: string; quantity: number }>;
  customerPhone: string;
  customerName: string;
}

// Query keys
export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: (filters: string) => [...orderKeys.lists(), { filters }] as const,
  details: () => [...orderKeys.all, 'detail'] as const,
  detail: (id: string) => [...orderKeys.details(), id] as const,
};

// Fetch order by ID
export const useOrder = (id: string) => {
  const queryClient = useQueryClient();

  // REST fetch
  const query = useQuery({
    queryKey: orderKeys.detail(id),
    queryFn: async () => {
      const response = await apiClient.get(`/orders/${id}`);
      return response.data as Order;
    },
    enabled: !!id,
  });

  // WebSocket overlay for real-time updates
  useWebSocket({
    url: import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws/orders/',
    enabled: !!id,
    onMessage: (message) => {
      if (message.type === 'order_update' && message.data.id === id) {
        // Update the query cache with the new data
        queryClient.setQueryData(orderKeys.detail(id), message.data);
      }
    },
  });

  return query;
};

// Fetch orders list (for dashboard, KDS, etc.)
export const useOrders = (filters?: Record<string, any>) => {
  return useQuery({
    queryKey: orderKeys.list(JSON.stringify(filters)),
    queryFn: async () => {
      const response = await apiClient.get('/orders', { params: filters });
      return response.data as Order[];
    },
  });
};

// Create order mutation
export const useCreateOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateOrderInput) => {
      const response = await apiClient.post('/orders', input);
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
    mutationFn: async ({ id, status }: { id: string; status: Order['status'] }) => {
      const response = await apiClient.patch(`/orders/${id}`, { status });
      return response.data as Order;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(orderKeys.detail(data.id), data);
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
    },
  });
};
