import { vi } from 'vitest';

export const mockSupabaseQuery = (data: unknown, error: unknown = null) => ({
  data,
  error,
});

export const mockSupabaseAuthUser = (user: unknown) => ({
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

export const mockFetch = (response: unknown, status = 200) => {
  const mockFn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
  vi.stubGlobal('fetch', mockFn);
};

export const resetAllMocks = () => {
  vi.clearAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
};

