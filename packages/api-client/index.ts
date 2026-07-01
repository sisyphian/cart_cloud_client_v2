// API Client - Generated from OpenAPI schema
// This file re-exports the generated client with sensible defaults
// Run: pnpm generate (after schema.json is placed in this directory)

import axios, { AxiosInstance } from 'axios';

// Placeholder for generated types - will be populated after generation
// import * as Generated from './generated';

// Create axios instance with base configuration
const createApiClient = (baseURL: string = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'): AxiosInstance => {
  const client = axios.create({
    baseURL,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor - add auth header
  client.interceptors.request.use((config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  // Response interceptor - handle errors
  client.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401) {
        // Unauthorized - clear token and redirect to login
        localStorage.removeItem('auth_token');
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }
  );

  return client;
};

// Export the configured axios instance
export const apiClient = createApiClient();

// Export generated types (placeholder - will be populated after generation)
// export * from './generated';

// Helper: Add idempotency key for order creation
export const withIdempotencyKey = (config: any) => {
  return {
    ...config,
    headers: {
      ...config.headers,
      'Idempotency-Key': crypto.randomUUID(),
    },
  };
};

// Helper: Add If-Match header for optimistic concurrency
export const withIfMatch = (config: any, etag: string) => {
  return {
    ...config,
    headers: {
      ...config.headers,
      'If-Match': etag,
    },
  };
};
