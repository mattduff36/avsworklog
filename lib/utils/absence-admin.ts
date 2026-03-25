export interface TeamScopedEmployee {
  id: string;
  team_id: string | null;
}

export function filterEmployeesBySelectedTeam<T extends TeamScopedEmployee>(
  employees: T[],
  selectedTeamId: string
): T[] {
  if (selectedTeamId === 'all') {
    return employees;
  }

  if (selectedTeamId === 'unassigned') {
    return employees.filter((employee) => !employee.team_id);
  }

  return employees.filter((employee) => employee.team_id === selectedTeamId);
}
