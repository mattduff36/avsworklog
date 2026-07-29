import { describe, expect, it } from 'vitest';
import {
  buildAssignmentPayload,
  shouldPromptClearAssignment,
} from '@/lib/fleet/nickname-assignment';
import { parseFleetNicknameAssignmentIntent } from '@/lib/server/fleet-nickname-assignment';

describe('fleet nickname assignment helpers', () => {
  const currentAssignment = {
    assignmentId: 'assign-1',
    userId: 'user-1',
    fullName: 'Conway Evans',
  };

  it('does not prompt when nickname is unchanged and no selection was cleared', () => {
    expect(
      shouldPromptClearAssignment({
        currentAssignment,
        selectedUserId: null,
        nickname: 'Conway Evans',
        initialNickname: 'Conway Evans',
        selectionWasCleared: false,
      })
    ).toBe(false);
  });

  it('prompts when nickname is cleared while a user is linked', () => {
    expect(
      shouldPromptClearAssignment({
        currentAssignment,
        selectedUserId: null,
        nickname: '',
        initialNickname: 'Conway Evans',
        selectionWasCleared: false,
      })
    ).toBe(true);
  });

  it('prompts when free-text nickname changes without selecting a user', () => {
    expect(
      shouldPromptClearAssignment({
        currentAssignment,
        selectedUserId: null,
        nickname: 'Spare Van',
        initialNickname: 'Conway Evans',
        selectionWasCleared: false,
      })
    ).toBe(true);
  });

  it('does not prompt when a user is selected for assignment', () => {
    expect(
      shouldPromptClearAssignment({
        currentAssignment,
        selectedUserId: 'user-2',
        nickname: 'New Driver',
        initialNickname: 'Conway Evans',
        selectionWasCleared: false,
      })
    ).toBe(false);
  });

  it('builds assign/keep/clear payloads', () => {
    expect(
      buildAssignmentPayload({
        selectedUserId: 'user-2',
        expectedAssignmentId: 'assign-1',
        clearAssignment: false,
      })
    ).toEqual({
      action: 'assign',
      userId: 'user-2',
      expectedAssignmentId: 'assign-1',
    });

    expect(
      buildAssignmentPayload({
        selectedUserId: null,
        expectedAssignmentId: 'assign-1',
        clearAssignment: true,
      })
    ).toEqual({
      action: 'clear',
      expectedAssignmentId: 'assign-1',
    });

    expect(
      buildAssignmentPayload({
        selectedUserId: null,
        expectedAssignmentId: null,
        clearAssignment: false,
      })
    ).toEqual({
      action: 'keep',
      expectedAssignmentId: null,
    });
  });

  it('parses assignment intent from API body', () => {
    expect(
      parseFleetNicknameAssignmentIntent({
        assignment: {
          action: 'assign',
          userId: 'user-9',
          expectedAssignmentId: null,
        },
      })
    ).toEqual({
      action: 'assign',
      userId: 'user-9',
      expectedAssignmentId: null,
    });

    expect(() =>
      parseFleetNicknameAssignmentIntent({
        assignment: { action: 'assign', expectedAssignmentId: null },
      })
    ).toThrow(/userId/);
  });
});
