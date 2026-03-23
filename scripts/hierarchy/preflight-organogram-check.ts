import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import {
  ORGANOGRAM_MANAGER_ROLES,
  ORGANOGRAM_PEOPLE,
  ORGANOGRAM_TEAMS,
} from './organogram-config';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

interface ProfileRow {
  id: string;
  full_name: string | null;
}

interface RoleRow {
  name: string;
}

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

async function getClient(): Promise<pg.Client> {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL is not set in .env.local');
  }

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

async function main() {
  const client = await getClient();
  try {
    console.log('Running organogram preflight check...\n');

    const { rows: profileRows } = await client.query<ProfileRow>(`
      SELECT id, full_name
      FROM profiles
      WHERE full_name IS NOT NULL
    `);
    const { rows: roleRows } = await client.query<RoleRow>(`
      SELECT name
      FROM roles
    `);

    const profileByExactName = new Map<string, ProfileRow>();
    const profileByNormalizedName = new Map<string, ProfileRow>();
    for (const profile of profileRows) {
      if (!profile.full_name) continue;
      profileByExactName.set(profile.full_name, profile);
      profileByNormalizedName.set(normalizeName(profile.full_name), profile);
    }

    const knownRoleNames = new Set(roleRows.map((row) => row.name));
    const missingManagerRoles = ORGANOGRAM_MANAGER_ROLES
      .map((role) => role.name)
      .filter((roleName) => !knownRoleNames.has(roleName));

    const unresolvedPeople: string[] = [];
    const unresolvedManagers: string[] = [];
    const missingTeamIds: string[] = [];

    const teamIdSet = new Set(ORGANOGRAM_TEAMS.map((team) => team.id));
    for (const person of ORGANOGRAM_PEOPLE) {
      if (!teamIdSet.has(person.teamId)) {
        missingTeamIds.push(`${person.fullName} -> ${person.teamId}`);
      }
      const personProfile =
        profileByExactName.get(person.fullName) ||
        profileByNormalizedName.get(normalizeName(person.fullName));
      if (!personProfile) {
        unresolvedPeople.push(person.fullName);
      }
      if (person.primaryManagerName) {
        const managerProfile =
          profileByExactName.get(person.primaryManagerName) ||
          profileByNormalizedName.get(normalizeName(person.primaryManagerName));
        if (!managerProfile) {
          unresolvedManagers.push(`${person.fullName} -> primary manager ${person.primaryManagerName}`);
        }
      }
      if (person.secondaryManagerName) {
        const secondaryProfile =
          profileByExactName.get(person.secondaryManagerName) ||
          profileByNormalizedName.get(normalizeName(person.secondaryManagerName));
        if (!secondaryProfile) {
          unresolvedManagers.push(`${person.fullName} -> secondary manager ${person.secondaryManagerName}`);
        }
      }
    }

    console.log(`Profiles in system: ${profileRows.length}`);
    console.log(`Mapped people in organogram config: ${ORGANOGRAM_PEOPLE.length}`);
    console.log(`Teams configured: ${ORGANOGRAM_TEAMS.length}`);
    console.log(`Manager roles configured: ${ORGANOGRAM_MANAGER_ROLES.length}\n`);

    if (missingManagerRoles.length > 0) {
      console.log('Missing manager roles (to be created in migration):');
      for (const roleName of missingManagerRoles) {
        console.log(`  - ${roleName}`);
      }
      console.log('');
    } else {
      console.log('All required manager roles already exist.\n');
    }

    if (missingTeamIds.length > 0) {
      console.error('Invalid team references in mapping config:');
      for (const missingTeam of missingTeamIds) {
        console.error(`  - ${missingTeam}`);
      }
      throw new Error('Strict-block failed: invalid team references in organogram mapping.');
    }

    if (unresolvedPeople.length > 0) {
      console.error('Mapped people not found in profiles (existing-users-only mode):');
      for (const name of unresolvedPeople) {
        console.error(`  - ${name}`);
      }
      throw new Error('Strict-block failed: unresolved people in organogram mapping.');
    }

    if (unresolvedManagers.length > 0) {
      console.error('Mapped manager links that cannot be resolved:');
      for (const issue of unresolvedManagers) {
        console.error(`  - ${issue}`);
      }
      throw new Error('Strict-block failed: unresolved manager links.');
    }

    console.log('Preflight passed: all mapped people and manager links resolved.\n');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
