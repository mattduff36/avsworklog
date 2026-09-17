import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/workshop-tasks/tasks/[taskId]/complete-service/route';
import { AssetServiceError, completeServiceWorkshopTask } from '@/lib/server/asset-service';
import { userHasPermission } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient,
}));

vi.mock('@/lib/utils/permissions', () => ({
  userHasPermission: vi.fn(),
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/server/asset-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/asset-service')>();
  return {
    ...actual,
    completeServiceWorkshopTask: vi.fn(),
  };
});

const TASK_ID = '3975876a-1ed1-42d4-be1d-4045c2201876';
const USER_ID = '2bb10610-3fb2-4dd6-83c0-85e8ab0eab54';

function request(): NextRequest {
  return new NextRequest(
    `http://localhost/api/workshop-tasks/tasks/${TASK_ID}/complete-service`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        completionMeter: 1000,
        confirmedNextTemplateId: 'template-1',
        completedComment: 'done',
      }),
    },
  );
}

async function invoke() {
  return POST(request(), { params: Promise.resolve({ taskId: TASK_ID }) });
}

describe('complete-service expected AssetServiceError logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: USER_ID } },
          error: null,
        })),
      },
    });
    vi.mocked(userHasPermission).mockResolvedValue(true);
    vi.mocked(logServerError).mockResolvedValue(undefined);
  });

  it('FXE-C3-ASSET-SERVICE-EXPECTED-NOT-LOGGED returns expected AssetServiceError without server logging', async () => {
    const message = 'Linked service attachment must be completed before task completion';
    vi.mocked(completeServiceWorkshopTask).mockRejectedValue(new AssetServiceError(message));

    const response = await invoke();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(logServerError).not.toHaveBeenCalled();
  });

  it('FXE-C3-UNEXPECTED-ERROR-LOGGED still logs unexpected failures', async () => {
    vi.mocked(completeServiceWorkshopTask).mockRejectedValue(new Error('database exploded'));

    const unexpected = await invoke();

    expect(unexpected.status).toBe(500);
    await expect(unexpected.json()).resolves.toEqual({ error: 'Failed to complete service task' });
    expect(logServerError).toHaveBeenCalledTimes(1);
    expect(logServerError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'database exploded' }),
        componentName: '/api/workshop-tasks/tasks/[taskId]/complete-service',
        additionalData: {
          endpoint: 'POST /api/workshop-tasks/tasks/[taskId]/complete-service',
        },
      }),
    );

    vi.mocked(logServerError).mockClear();
    vi.mocked(completeServiceWorkshopTask).mockRejectedValue(
      new AssetServiceError('Missing database connection string', 500),
    );

    const serverFailure = await invoke();

    expect(serverFailure.status).toBe(500);
    await expect(serverFailure.json()).resolves.toEqual({
      error: 'Missing database connection string',
    });
    expect(logServerError).toHaveBeenCalledTimes(1);
    expect(logServerError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'Missing database connection string' }),
      }),
    );
  });
});
