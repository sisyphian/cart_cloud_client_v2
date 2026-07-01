import { useMutation, useQueryClient } from '@tanstack/react-query';

// Local cart state for customer PWA
interface LocalCartItem {
  menu_item_id: string;
  quantity: number;
  selected_option_choice_ids?: string[];
  item_name: string;
  unit_price: number;
}

interface LocalCart {
  cart_id: string;
  items: LocalCartItem[];
  subtotal: number;
}

export const cartKeys = {
  all: ['cart'] as const,
  current: (cartId: string) => [...cartKeys.all, cartId] as const,
};

// Get local cart from localStorage
export const getLocalCart = (cartId: string): LocalCart | null => {
  const stored = localStorage.getItem(`cart_${cartId}`);
  return stored ? JSON.parse(stored) : null;
};

// Save local cart to localStorage
export const saveLocalCart = (cartId: string, cart: LocalCart) => {
  localStorage.setItem(`cart_${cartId}`, JSON.stringify(cart));
};

// Clear local cart
export const clearLocalCart = (cartId: string) => {
  localStorage.removeItem(`cart_${cartId}`);
};

// Add item to local cart
export const useAddToCart = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ cartId, item }: { cartId: string; item: LocalCartItem }) => {
      const cart = getLocalCart(cartId) || { cart_id: cartId, items: [], subtotal: 0 };
      
      const existingIndex = cart.items.findIndex(i => i.menu_item_id === item.menu_item_id);
      if (existingIndex >= 0) {
        cart.items[existingIndex].quantity += item.quantity;
      } else {
        cart.items.push(item);
      }
      
      cart.subtotal = cart.items.reduce((sum, i) => sum + (i.unit_price * i.quantity), 0);
      saveLocalCart(cartId, cart);
      
      return cart;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(cartKeys.current(data.cart_id), data);
    },
  });
};

// Remove item from local cart
export const useRemoveFromCart = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ cartId, menuItemId }: { cartId: string; menuItemId: string }) => {
      const cart = getLocalCart(cartId);
      if (!cart) return null;
      
      cart.items = cart.items.filter(i => i.menu_item_id !== menuItemId);
      cart.subtotal = cart.items.reduce((sum, i) => sum + (i.unit_price * i.quantity), 0);
      saveLocalCart(cartId, cart);
      
      return cart;
    },
    onSuccess: (data) => {
      if (data) {
        queryClient.setQueryData(cartKeys.current(data.cart_id), data);
      }
    },
  });
};

// Update item quantity in local cart
export const useUpdateCartItemQuantity = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ cartId, menuItemId, quantity }: { cartId: string; menuItemId: string; quantity: number }) => {
      const cart = getLocalCart(cartId);
      if (!cart) return null;
      
      const item = cart.items.find(i => i.menu_item_id === menuItemId);
      if (item) {
        item.quantity = quantity;
        cart.subtotal = cart.items.reduce((sum, i) => sum + (i.unit_price * i.quantity), 0);
        saveLocalCart(cartId, cart);
      }
      
      return cart;
    },
    onSuccess: (data) => {
      if (data) {
        queryClient.setQueryData(cartKeys.current(data.cart_id), data);
      }
    },
  });
};

// Clear local cart
export const useClearCart = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (cartId: string) => {
      clearLocalCart(cartId);
      return cartId;
    },
    onSuccess: (cartId) => {
      queryClient.setQueryData(cartKeys.current(cartId), null);
    },
  });
};
