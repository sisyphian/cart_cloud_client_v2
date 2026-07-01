import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@cart-cloud/api-client';

// Placeholder types
interface User {
  id: string;
  phone: string;
  name: string;
  role: 'customer' | 'owner' | 'worker' | 'admin';
}

interface LoginInput {
  phone: string;
  name?: string;
  code: string;
}

interface SendCodeInput {
  phone: string;
}

export const authKeys = {
  all: ['auth'] as const,
  user: () => [...authKeys.all, 'user'] as const,
};

// Get current user
export const useUser = () => {
  return useQuery({
    queryKey: authKeys.user(),
    queryFn: async () => {
      const response = await apiClient.get('/auth/me');
      return response.data as User;
    },
    retry: false,
  });
};

// Send verification code (phone-only auth)
export const useSendCode = () => {
  return useMutation({
    mutationFn: async (input: SendCodeInput) => {
      const response = await apiClient.post('/auth/send-code', input);
      return response.data;
    },
  });
};

// Login with phone + code
export const useLogin = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: LoginInput) => {
      const response = await apiClient.post('/auth/login', input);
      return response.data as { token: string; user: User };
    },
    onSuccess: (data) => {
      // Store token
      localStorage.setItem('auth_token', data.token);
      // Set user in cache
      queryClient.setQueryData(authKeys.user(), data.user);
    },
  });
};

// Logout
export const useLogout = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await apiClient.post('/auth/logout');
    },
    onSuccess: () => {
      localStorage.removeItem('auth_token');
      queryClient.setQueryData(authKeys.user(), null);
      queryClient.clear();
    },
  });
};
