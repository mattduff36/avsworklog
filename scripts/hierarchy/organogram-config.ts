export interface OrganogramTeamDefinition {
  id: string;
  name: string;
  primaryLeaderName: string;
  secondaryLeaderName?: string;
  managerRoleName: string;
  managerRoleDisplayName: string;
}

export interface OrganogramPersonMapping {
  fullName: string;
  teamId: string;
  primaryManagerName?: string;
  secondaryManagerName?: string;
  roleType: 'leader' | 'member';
}

export const ORGANOGRAM_TEAMS: OrganogramTeamDefinition[] = [
  {
    id: 'executive',
    name: 'Executive',
    primaryLeaderName: 'Tom Squires',
    managerRoleName: 'managing-director',
    managerRoleDisplayName: 'Managing Director',
  },
  {
    id: 'sheq',
    name: 'SHEQ',
    primaryLeaderName: 'Conway Evans',
    managerRoleName: 'sheq-manager',
    managerRoleDisplayName: 'SHEQ Manager',
  },
  {
    id: 'finance_payroll',
    name: 'Finance and Payroll',
    primaryLeaderName: 'Peter Woodward',
    managerRoleName: 'company-accountant-manager',
    managerRoleDisplayName: 'Company Accountant',
  },
  {
    id: 'heavy_plant_earthworks',
    name: 'Heavy Plant and Earthworks',
    primaryLeaderName: 'Tim Weaver',
    managerRoleName: 'heavy-plant-earthworks-contracts-manager',
    managerRoleDisplayName: 'Heavy Plant and Earthworks Contracts Manager',
  },
  {
    id: 'civils',
    name: 'Civils',
    primaryLeaderName: 'George Healey',
    secondaryLeaderName: 'Louis Cree',
    managerRoleName: 'civils-manager',
    managerRoleDisplayName: 'Civils Manager',
  },
  {
    id: 'transport',
    name: 'Transport',
    primaryLeaderName: 'Neil Frost',
    managerRoleName: 'transport-manager',
    managerRoleDisplayName: 'Transport Manager',
  },
  {
    id: 'workshop_yard',
    name: 'Workshop and Yard',
    primaryLeaderName: 'Andy Hill',
    managerRoleName: 'workshop-manager',
    managerRoleDisplayName: 'Workshop Manager',
  },
];

export const ORGANOGRAM_MANAGER_ROLES: Array<{
  name: string;
  display_name: string;
  description: string;
  role_class: 'manager';
  is_manager_admin: true;
  is_super_admin: false;
}> = [
  {
    name: 'managing-director',
    display_name: 'Managing Director',
    description: 'Executive manager role for the Managing Director.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'sheq-manager',
    display_name: 'SHEQ Manager',
    description: 'Manager role for SHEQ oversight.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'company-accountant-manager',
    display_name: 'Company Accountant',
    description: 'Manager role for finance and payroll oversight.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'heavy-plant-earthworks-contracts-manager',
    display_name: 'Heavy Plant and Earthworks Contracts Manager',
    description: 'Manager role for heavy plant and earthworks operations.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'civils-project-manager',
    display_name: 'Civils Project Manager',
    description: 'Manager role for civils project delivery.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'civils-contracts-manager',
    display_name: 'Civils Contracts Manager',
    description: 'Manager role for civils contracts operations.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'transport-manager',
    display_name: 'Transport Manager',
    description: 'Manager role for transport operations.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'workshop-manager',
    display_name: 'Workshop Manager',
    description: 'Manager role for workshop and yard operations.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'civils-manager',
    display_name: 'Civils Manager',
    description: 'Manager role for civils operations and projects.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
  {
    name: 'civils-site-managers-supervisors-manager',
    display_name: 'Civils Site Managers and Supervisors Manager',
    description: 'Manager role for civils site managers and supervisors.',
    role_class: 'manager',
    is_manager_admin: true,
    is_super_admin: false,
  },
];

export const ORGANOGRAM_PEOPLE: OrganogramPersonMapping[] = [
  {
    fullName: 'Tom Squires',
    teamId: 'executive',
    roleType: 'leader',
  },
  {
    fullName: 'Conway Evans',
    teamId: 'sheq',
    roleType: 'leader',
  },
  {
    fullName: 'Peter Woodward',
    teamId: 'finance_payroll',
    roleType: 'leader',
  },
  {
    fullName: 'Suzanne Squires',
    teamId: 'finance_payroll',
    primaryManagerName: 'Peter Woodward',
    roleType: 'member',
  },
  {
    fullName: 'Charlotte Boyles',
    teamId: 'finance_payroll',
    primaryManagerName: 'Peter Woodward',
    roleType: 'member',
  },
  {
    fullName: 'Aileen Hurrell',
    teamId: 'finance_payroll',
    primaryManagerName: 'Peter Woodward',
    roleType: 'member',
  },
  {
    fullName: 'Tim Weaver',
    teamId: 'heavy_plant_earthworks',
    roleType: 'leader',
  },
  {
    fullName: 'George Healey',
    teamId: 'civils',
    roleType: 'leader',
  },
  {
    fullName: 'Louis Cree',
    teamId: 'civils',
    roleType: 'leader',
  },
  {
    fullName: 'Neil Frost',
    teamId: 'transport',
    roleType: 'leader',
  },
  {
    fullName: 'Sarah Hubbard',
    teamId: 'transport',
    primaryManagerName: 'Neil Frost',
    roleType: 'member',
  },
  {
    fullName: 'Andy Hill',
    teamId: 'workshop_yard',
    roleType: 'leader',
  },
];
