import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mockApi } from '@cart-cloud/api-client';

export const inventoryKeys = {
  all: ['inventory'] as const,
  ingredients: (cartId: string) => [...inventoryKeys.all, 'ingredients', cartId] as const,
  stockLevels: (cartId: string) => [...inventoryKeys.all, 'stock-levels', cartId] as const,
  movements: (cartId: string, filters?: any) => [...inventoryKeys.all, 'movements', cartId, filters] as const,
  suppliers: (vendorId: string) => [...inventoryKeys.all, 'suppliers', vendorId] as const,
  purchaseOrders: (cartId: string) => [...inventoryKeys.all, 'purchase-orders', cartId] as const,
};

// Get ingredients
export const useIngredients = (cartId: string) => {
  return useQuery({
    queryKey: inventoryKeys.ingredients(cartId),
    queryFn: async () => {
      const response = await mockApi.getIngredients(cartId);
      return response.data;
    },
    enabled: !!cartId,
  });
};

// Get stock levels
export const useIngredientStockLevels = (cartId: string) => {
  return useQuery({
    queryKey: inventoryKeys.stockLevels(cartId),
    queryFn: async () => {
      const response = await mockApi.getIngredientStockLevels(cartId);
      return response.data;
    },
    enabled: !!cartId,
  });
};

// Get stock movements
export const useStockMovements = (cartId: string, filters?: any) => {
  return useQuery({
    queryKey: inventoryKeys.movements(cartId, filters),
    queryFn: async () => {
      const response = await mockApi.getStockMovements(cartId, filters);
      return response.data;
    },
    enabled: !!cartId,
  });
};

// Create stock movement mutation
export const useCreateStockMovement = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ cartId, movement }: { cartId: string; movement: any }) => {
      const response = await mockApi.createStockMovement(cartId, movement);
      return response.data;
    },
    onSuccess: (_, { cartId }) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.stockLevels(cartId) });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.movements(cartId) });
    },
  });
};

// Get suppliers
export const useSuppliers = (vendorId: string) => {
  return useQuery({
    queryKey: inventoryKeys.suppliers(vendorId),
    queryFn: async () => {
      const response = await mockApi.getSuppliers(vendorId);
      return response.data;
    },
    enabled: !!vendorId,
  });
};

// Create supplier mutation
export const useCreateSupplier = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ vendorId, supplier }: { vendorId: string; supplier: any }) => {
      const response = await mockApi.createSupplier(vendorId, supplier);
      return response.data;
    },
    onSuccess: (_, { vendorId }) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.suppliers(vendorId) });
    },
  });
};

// Get purchase orders
export const usePurchaseOrders = (cartId: string) => {
  return useQuery({
    queryKey: inventoryKeys.purchaseOrders(cartId),
    queryFn: async () => {
      const response = await mockApi.getPurchaseOrders(cartId);
      return response.data;
    },
    enabled: !!cartId,
  });
};

// Create purchase order mutation
export const useCreatePurchaseOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ cartId, purchaseOrder }: { cartId: string; purchaseOrder: any }) => {
      const response = await mockApi.createPurchaseOrder(cartId, purchaseOrder);
      return response.data;
    },
    onSuccess: (_, { cartId }) => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.purchaseOrders(cartId) });
    },
  });
};
