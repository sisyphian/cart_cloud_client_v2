import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mockApi, mockCustomers } from '@cart-cloud/api-client';
import type { Customer } from '@cart-cloud/api-client';

interface SendCodeInput {
  phone_number: string;
  display_name: string;
  device_id: string;
}

interface VerifyOtpInput {
  otp_session_id: string;
  otp_code: string;
}

export const authKeys = {
  all: ['auth'] as const,
  user: () => [...authKeys.all, 'user'] as const,
};

// Get current user (mock - returns first customer)
export const useUser = () => {
  return useQuery({
    queryKey: authKeys.user(),
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return null;
      // Mock: return first customer if token exists
      return mockCustomers[0];
    },
    retry: false,
  });
};

// Identify customer (send code)
export const useSendCode = () => {
  return useMutation({
    mutationFn: async (input: SendCodeInput) => {
      const response = await mockApi.identifyCustomer(input.phone_number, input.display_name, input.device_id);
      return response.data;
    },
  });
};

// Verify OTP
export const useVerifyOtp = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: VerifyOtpInput) => {
      const response = await mockApi.verifyOtp(input.otp_session_id, input.otp_code);
      return response.data;
    },
    onSuccess: (data) => {
      // Store token
      localStorage.setItem('auth_token', data.access_token);
      // Set user in cache
      queryClient.setQueryData(authKeys.user(), data.customer);
    },
  });
};

// Logout
export const useLogout = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // Mock logout
    },
    onSuccess: () => {
      localStorage.removeItem('auth_token');
      queryClient.setQueryData(authKeys.user(), null);
      queryClient.clear();
    },
  });
};
