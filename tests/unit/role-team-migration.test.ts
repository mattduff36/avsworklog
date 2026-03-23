import { describe, expect, it } from 'vitest';
import {
  inferTargetRoleNameFromLegacy,
  inferTargetTeamFromLegacy,
} from '@/lib/utils/role-team-migration';

describe('role/team migration helpers', () => {
  it('maps legacy team ids to canonical team ids', () => {
    expect(inferTargetTeamFromLegacy({ team_id: 'civils_projects' }).teamId).toBe('civils');
    expect(inferTargetTeamFromLegacy({ team_id: 'heavy_plant_earthworks' }).teamId).toBe('plant');
    expect(inferTargetTeamFromLegacy({ team_id: 'finance_payroll' }).teamId).toBe('accounts');
  });

  it('maps legacy role names to canonical team ids when team is missing', () => {
    expect(inferTargetTeamFromLegacy({ role_name: 'employee-transport' }).teamId).toBe('transport');
    expect(inferTargetTeamFromLegacy({ role_name: 'employee-workshop' }).teamId).toBe('workshop');
    expect(inferTargetTeamFromLegacy({ role_name: 'employee-groundworks' }).teamId).toBe('civils');
  });

  it('falls back to civils when no mapping exists', () => {
    const result = inferTargetTeamFromLegacy({ role_name: 'unknown-role' });
    expect(result.teamId).toBe('civils');
    expect(result.reason).toBe('fallback:civils');
  });

  it('maps role targets to admin, manager, employee', () => {
    expect(inferTargetRoleNameFromLegacy({ role_name: 'admin' })).toBe('admin');
    expect(inferTargetRoleNameFromLegacy({ role_class: 'admin' })).toBe('admin');
    expect(inferTargetRoleNameFromLegacy({ is_super_admin: true })).toBe('admin');

    expect(inferTargetRoleNameFromLegacy({ role_class: 'manager' })).toBe('manager');
    expect(inferTargetRoleNameFromLegacy({ is_manager_admin: true })).toBe('manager');
    expect(inferTargetRoleNameFromLegacy({ role_name: 'contractor', role_class: 'employee' })).toBe('contractor');

    expect(inferTargetRoleNameFromLegacy({ role_name: 'employee-civils', role_class: 'employee' })).toBe('employee');
  });
});
