import { describe, expect, it } from 'vitest';
import {
  getTeamLineManagers,
  resolveTeamLineManagerCandidate,
} from '@/lib/config/team-line-managers';

describe('team line manager config', () => {
  it('excludes testsuite-only team mappings by default', () => {
    const teams = getTeamLineManagers();

    expect(teams.some((team) => team.teamId === 'test')).toBe(false);
  });

  it('can include testsuite-only team mappings when explicitly requested', () => {
    const teams = getTeamLineManagers({ includeTestTeams: true });

    expect(teams.some((team) => team.teamId === 'test')).toBe(true);
  });

  it('prefers a real manager profile over a placeholder with the same name', () => {
    const resolved = resolveTeamLineManagerCandidate(
      [
        { id: 'placeholder-tim', full_name: 'Tim Weaver', is_placeholder: true },
        { id: 'real-tim', full_name: 'Tim Weaver', is_placeholder: false },
      ],
      'Tim Weaver'
    );

    expect(resolved?.id).toBe('real-tim');
  });

  it('fails fast when multiple real profiles share the same manager name', () => {
    expect(() =>
      resolveTeamLineManagerCandidate(
        [
          { id: 'tim-1', full_name: 'Tim Weaver', is_placeholder: false },
          { id: 'tim-2', full_name: 'Tim Weaver', is_placeholder: false },
        ],
        'Tim Weaver'
      )
    ).toThrow('Multiple non-placeholder profiles found for manager: Tim Weaver');
  });
});
