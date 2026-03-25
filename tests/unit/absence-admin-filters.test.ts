import { describe, expect, it } from 'vitest';

import { filterEmployeesBySelectedTeam } from '@/lib/utils/absence-admin';

const employees = [
  { id: 'emp-a', team_id: 'team-1' },
  { id: 'emp-b', team_id: 'team-2' },
  { id: 'emp-c', team_id: null },
];

describe('filterEmployeesBySelectedTeam', () => {
  it('returns all employees when no team filter is selected', () => {
    expect(filterEmployeesBySelectedTeam(employees, 'all')).toEqual(employees);
  });

  it('returns only employees from the selected team', () => {
    expect(filterEmployeesBySelectedTeam(employees, 'team-1')).toEqual([{ id: 'emp-a', team_id: 'team-1' }]);
  });

  it('returns only unassigned employees when requested', () => {
    expect(filterEmployeesBySelectedTeam(employees, 'unassigned')).toEqual([{ id: 'emp-c', team_id: null }]);
  });
});
