import { vi } from 'vitest';

export const mockSupabaseQuery = (data: any, error: any = null) => ({
  data,
  error,
});

export const mockSupabaseAuthUser = (user: any) => ({
  data: { user },
  error: null,
});

export const mockEmailSend = () => {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: 'mock-email-id' }),
  });
};

export const waitFor = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const mockFetch = (response: any, status = 200) => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
};

export const resetAllMocks = () => {
  vi.clearAllMocks();
  vi.resetAllMocks();
};

