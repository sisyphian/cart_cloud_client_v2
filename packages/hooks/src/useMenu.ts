import { useQuery } from '@tanstack/react-query';
import { mockApi } from '@cart-cloud/api-client';
import type { Cart, PublicMenuResponse } from '@cart-cloud/api-client';

export const menuKeys = {
  all: ['menu'] as const,
  cart: (slug: string) => [...menuKeys.all, 'cart', slug] as const,
  cartMenu: (slug: string) => [...menuKeys.all, 'cart-menu', slug] as const,
};

// Get cart by slug
export const useCartBySlug = (slug: string, qrToken?: string) => {
  return useQuery({
    queryKey: menuKeys.cart(slug),
    queryFn: async () => {
      const response = await mockApi.getCartBySlug(slug, qrToken);
      return response.data as Cart | null;
    },
    enabled: !!slug,
  });
};

// Get cart menu
export const useCartMenu = (slug: string, qrToken?: string) => {
  return useQuery({
    queryKey: menuKeys.cartMenu(slug),
    queryFn: async () => {
      const response = await mockApi.getCartMenu(slug, qrToken);
      return response.data as PublicMenuResponse | null;
    },
    enabled: !!slug,
  });
};
