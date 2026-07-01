import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mockApi } from '@cart-cloud/api-client';

export const adminKeys = {
  all: ['admin'] as const,
  summary: () => [...adminKeys.all, 'summary'] as const,
  vendors: (filters?: { status?: string; search?: string }) => [...adminKeys.all, 'vendors', filters] as const,
  vendor: (vendorId: string) => [...adminKeys.all, 'vendor', vendorId] as const,
};

// Get platform summary
export const useAdminPlatformSummary = () => {
  return useQuery({
    queryKey: adminKeys.summary(),
    queryFn: async () => {
      const response = await mockApi.getAdminPlatformSummary();
      return response.data;
    },
  });
};

// Get all vendors
export const useAdminVendors = (filters?: { status?: string; search?: string }) => {
  return useQuery({
    queryKey: adminKeys.vendors(filters),
    queryFn: async () => {
      const response = await mockApi.getAdminVendors(filters);
      return response.data;
    },
  });
};

// Get single vendor
export const useAdminVendor = (vendorId: string) => {
  return useQuery({
    queryKey: adminKeys.vendor(vendorId),
    queryFn: async () => {
      const response = await mockApi.getAdminVendor(vendorId);
      return response.data;
    },
    enabled: !!vendorId,
  });
};

// Suspend vendor mutation
export const useSuspendVendor = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ vendorId, reason }: { vendorId: string; reason: string }) => {
      const response = await mockApi.suspendVendor(vendorId, reason);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.vendors() });
    },
  });
};
