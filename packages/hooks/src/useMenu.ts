import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@cart-cloud/api-client';

// Placeholder types
interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  available: boolean;
  imageUrl?: string;
}

interface Vendor {
  id: string;
  name: string;
  description: string;
  location: string;
}

export const menuKeys = {
  all: ['menu'] as const,
  vendors: () => [...menuKeys.all, 'vendors'] as const,
  vendor: (id: string) => [...menuKeys.all, 'vendor', id] as const,
  items: (vendorId: string) => [...menuKeys.all, 'items', vendorId] as const,
};

// Get all vendors
export const useVendors = () => {
  return useQuery({
    queryKey: menuKeys.vendors(),
    queryFn: async () => {
      const response = await apiClient.get('/vendors');
      return response.data as Vendor[];
    },
  });
};

// Get vendor details
export const useVendor = (id: string) => {
  return useQuery({
    queryKey: menuKeys.vendor(id),
    queryFn: async () => {
      const response = await apiClient.get(`/vendors/${id}`);
      return response.data as Vendor;
    },
    enabled: !!id,
  });
};

// Get menu items for a vendor
export const useMenuItems = (vendorId: string) => {
  return useQuery({
    queryKey: menuKeys.items(vendorId),
    queryFn: async () => {
      const response = await apiClient.get(`/vendors/${vendorId}/menu`);
      return response.data as MenuItem[];
    },
    enabled: !!vendorId,
  });
};
