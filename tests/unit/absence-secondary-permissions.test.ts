import { describe, expect, it } from 'vitest';
import {
  ABSENCE_SECONDARY_PERMISSION_KEYS,
  applyAbsenceSecondaryOverrides,
  getAbsenceSecondaryDefaultMap,
} from '@/types/absence-permissions';
import { canActorUseScopedAbsencePermission } from '@/lib/server/absence-secondary-permissions';

describe('absence secondary permissions', () => {
  it('encodes manager defaults from the configured matrix', () => {
    const defaults = getAbsenceSecondaryDefaultMap('manager');

    expect(defaults.see_bookings_all).toBe(false);
    expect(defaults.see_bookings_team).toBe(true);
    expect(defaults.see_bookings_own).toBe(false);

    expect(defaults.add_edit_bookings_all).toBe(false);
    expect(defaults.add_edit_bookings_team).toBe(true);
    expect(defaults.add_edit_bookings_own).toBe(false);

    expect(defaults.see_allowances_all).toBe(false);
    expect(defaults.see_allowances_team).toBe(true);

    expect(defaults.add_edit_allowances_all).toBe(false);
    expect(defaults.add_edit_allowances_team).toBe(false);

    expect(defaults.see_manage_overview).toBe(false);
    expect(defaults.see_manage_reasons).toBe(false);
    expect(defaults.see_manage_work_shifts).toBe(true);
    expect(defaults.edit_manage_work_shifts).toBe(true);

    expect(defaults.authorise_bookings_all).toBe(false);
    expect(defaults.authorise_bookings_team).toBe(true);
    expect(defaults.authorise_bookings_own).toBe(false);
  });

  it('encodes supervisor defaults from the configured matrix', () => {
    const defaults = getAbsenceSecondaryDefaultMap('supervisor');

    expect(defaults.see_bookings_all).toBe(false);
    expect(defaults.see_bookings_team).toBe(true);
    expect(defaults.see_bookings_own).toBe(false);

    expect(defaults.add_edit_bookings_all).toBe(false);
    expect(defaults.add_edit_bookings_team).toBe(true);
    expect(defaults.add_edit_bookings_own).toBe(false);

    expect(defaults.see_allowances_all).toBe(false);
    expect(defaults.see_allowances_team).toBe(false);
    expect(defaults.see_manage_overview).toBe(false);
    expect(defaults.see_manage_reasons).toBe(false);
    expect(defaults.see_manage_work_shifts).toBe(true);
    expect(defaults.edit_manage_work_shifts).toBe(false);

    expect(defaults.authorise_bookings_all).toBe(false);
    expect(defaults.authorise_bookings_team).toBe(true);
    expect(defaults.authorise_bookings_own).toBe(false);
  });

  it('applies per-cell overrides over defaults', () => {
    const defaults = getAbsenceSecondaryDefaultMap('manager');
    const effective = applyAbsenceSecondaryOverrides(defaults, {
      add_edit_bookings_team: false,
      add_edit_allowances_team: true,
      authorise_bookings_all: true,
    });

    expect(effective.add_edit_bookings_team).toBe(false);
    expect(effective.add_edit_allowances_team).toBe(true);
    expect(effective.authorise_bookings_all).toBe(true);
  });

  it('keeps key coverage complete', () => {
    const adminDefaults = getAbsenceSecondaryDefaultMap('admin');
    ABSENCE_SECONDARY_PERMISSION_KEYS.forEach((key) => {
      expect(typeof adminDefaults[key]).toBe('boolean');
    });
  });

  it('evaluates scoped permissions with all/team/own precedence', () => {
    const managerDefaults = getAbsenceSecondaryDefaultMap('manager');

    expect(
      canActorUseScopedAbsencePermission({
        actorPermissions: {
          effective: managerDefaults,
          user_id: 'actor-1',
          team_id: 'team-a',
        },
        target: {
          profile_id: 'employee-team-a',
          team_id: 'team-a',
        },
        allKey: 'add_edit_bookings_all',
        teamKey: 'add_edit_bookings_team',
        ownKey: 'add_edit_bookings_own',
      })
    ).toBe(true);

    expect(
      canActorUseScopedAbsencePermission({
        actorPermissions: {
          effective: managerDefaults,
          user_id: 'actor-1',
          team_id: 'team-a',
        },
        target: {
          profile_id: 'employee-team-b',
          team_id: 'team-b',
        },
        allKey: 'add_edit_bookings_all',
        teamKey: 'add_edit_bookings_team',
        ownKey: 'add_edit_bookings_own',
      })
    ).toBe(false);
  });

  it('allows manager allowance visibility for own team including self', () => {
    const managerDefaults = getAbsenceSecondaryDefaultMap('manager');

    expect(
      canActorUseScopedAbsencePermission({
        actorPermissions: {
          effective: managerDefaults,
          user_id: 'manager-1',
          team_id: 'team-a',
        },
        target: {
          profile_id: 'manager-1',
          team_id: 'team-a',
        },
        allKey: 'see_allowances_all',
        teamKey: 'see_allowances_team',
        ownKey: 'add_edit_allowances_all',
      })
    ).toBe(true);
  });
});

