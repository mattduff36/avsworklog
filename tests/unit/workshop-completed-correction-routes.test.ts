import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AppSessionValidationResult } from '@/lib/server/app-auth/session';

const {
  requireWorkshopTasksManagerAccess,
  applyValidationCookieIfNeeded,
  correctCompletedWorkshopTask,
  correctCompletedAttachmentResponses,
} = vi.hoisted(() => ({
  requireWorkshopTasksManagerAccess: vi.fn(),
  applyValidationCookieIfNeeded: vi.fn(),
  correctCompletedWorkshopTask: vi.fn(),
  correctCompletedAttachmentResponses: vi.fn(),
}));

vi.mock('@/lib/server/workshop-tasks/auth', () => ({
  requireWorkshopTasksManagerAccess,
}));

vi.mock('@/lib/server/app-auth/response', () => ({
  applyValidationCookieIfNeeded,
}));

vi.mock('@/lib/server/workshop-completed-task-correction', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/workshop-completed-task-correction')>(
    '@/lib/server/workshop-completed-task-correction'
  );
  return {
    ...actual,
    correctCompletedWorkshopTask,
  };
});

vi.mock('@/lib/server/workshop-attachment-correction', () => ({
  correctCompletedAttachmentResponses,
}));

vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: vi.fn(),
}));

import { PATCH as patchCompleted } from '@/app/api/workshop-tasks/tasks/[taskId]/correct-completed/route';
import { POST as postAttachment } from '@/app/api/workshop-tasks/attachments/[id]/correct-responses/route';
import { WorkshopCorrectionError } from '@/lib/server/workshop-completed-task-correction';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const ATTACHMENT_ID = '22222222-2222-4222-8222-222222222222';

function sessionResult(
  overrides: Partial<AppSessionValidationResult> = {}
): AppSessionValidationResult {
  return {
    status: 'missing',
    session: null,
    profileId: null,
    email: null,
    cookieValue: null,
    cookieExpiresAt: null,
    secretRotated: false,
    failureReason: 'missing_cookie',
    kioskDeviceIdHint: null,
    ...overrides,
  };
}

function rotatedSession(): AppSessionValidationResult {
  return sessionResult({
    status: 'active',
    profileId: 'actor',
    email: 'actor@example.com',
    cookieValue: 'rotated-cookie',
    cookieExpiresAt: new Date('2026-09-07T12:00:00.000Z'),
    secretRotated: true,
    failureReason: null,
  });
}

function patchRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/workshop-tasks/tasks/${TASK_ID}/correct-completed`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function attachmentRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/workshop-tasks/attachments/${ATTACHMENT_ID}/correct-responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validTaskBody = {
  reason: 'Fix the recorded comments',
  expectedUpdatedAt: '2026-09-07T10:00:00.000Z',
  workshop_comments: 'Updated workshop notes',
};

const validAttachmentBody = {
  reason: 'Correct the recorded odometer',
  expectedPreimageHash: 'abcdef12',
  responses: [
    {
      section_key: 'details',
      field_key: 'odometer_reading',
      response_value: '650153',
    },
  ],
};

describe('completed workshop correction routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('WT-CORR-AUTH-001 returns 401 before privileged writes', async () => {
    const missing = sessionResult({ status: 'missing' });
    requireWorkshopTasksManagerAccess.mockResolvedValue({
      ok: false,
      status: 401,
      validation: missing,
    });

    const taskResponse = await patchCompleted(patchRequest(validTaskBody), {
      params: Promise.resolve({ taskId: TASK_ID }),
    });
    const attachmentResponse = await postAttachment(attachmentRequest(validAttachmentBody), {
      params: Promise.resolve({ id: ATTACHMENT_ID }),
    });

    expect(taskResponse.status).toBe(401);
    expect(attachmentResponse.status).toBe(401);
    expect(correctCompletedWorkshopTask).not.toHaveBeenCalled();
    expect(correctCompletedAttachmentResponses).not.toHaveBeenCalled();
    expect(applyValidationCookieIfNeeded).toHaveBeenCalled();
  });

  it('WT-CORR-AUTH-002 returns 403 for authenticated non-managers', async () => {
    const active = sessionResult({
      status: 'active',
      profileId: 'actor',
      failureReason: null,
    });
    requireWorkshopTasksManagerAccess.mockResolvedValue({
      ok: false,
      status: 403,
      validation: active,
    });

    const taskResponse = await patchCompleted(patchRequest(validTaskBody), {
      params: Promise.resolve({ taskId: TASK_ID }),
    });
    const attachmentResponse = await postAttachment(attachmentRequest(validAttachmentBody), {
      params: Promise.resolve({ id: ATTACHMENT_ID }),
    });

    expect(taskResponse.status).toBe(403);
    expect(attachmentResponse.status).toBe(403);
    expect(correctCompletedWorkshopTask).not.toHaveBeenCalled();
    expect(correctCompletedAttachmentResponses).not.toHaveBeenCalled();
  });

  it('WT-CORR-COOKIE-001 applies a rotated session cookie on success and error', async () => {
    const rotated = rotatedSession();
    requireWorkshopTasksManagerAccess.mockResolvedValue({
      ok: true,
      userId: 'actor',
      validation: rotated,
    });
    correctCompletedWorkshopTask.mockResolvedValue({ updatedAt: '2026-09-07T11:00:00.000Z' });

    const success = await patchCompleted(patchRequest(validTaskBody), {
      params: Promise.resolve({ taskId: TASK_ID }),
    });
    expect(success.status).toBe(200);
    expect(applyValidationCookieIfNeeded).toHaveBeenCalledWith(expect.anything(), rotated);

    applyValidationCookieIfNeeded.mockClear();
    correctCompletedWorkshopTask.mockRejectedValue(new WorkshopCorrectionError('No changes to save', 409));
    const conflict = await patchCompleted(patchRequest(validTaskBody), {
      params: Promise.resolve({ taskId: TASK_ID }),
    });
    expect(conflict.status).toBe(409);
    expect(applyValidationCookieIfNeeded).toHaveBeenCalledWith(expect.anything(), rotated);
  });

  it('returns 409 for stale attachment preimages', async () => {
    requireWorkshopTasksManagerAccess.mockResolvedValue({
      ok: true,
      userId: 'actor',
      validation: rotatedSession(),
    });
    correctCompletedAttachmentResponses.mockRejectedValue(
      new WorkshopCorrectionError('This attachment changed since you opened it. Refresh and try again.', 409)
    );

    const response = await postAttachment(attachmentRequest(validAttachmentBody), {
      params: Promise.resolve({ id: ATTACHMENT_ID }),
    });
    expect(response.status).toBe(409);
    expect(applyValidationCookieIfNeeded).toHaveBeenCalled();
  });
});
