import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
};

export async function GET() {
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (!commitSha || !/^[0-9a-f]{40}$/u.test(commitSha)) {
    return NextResponse.json(
      { error: 'Deployment commit identity is unavailable.' },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }
  return NextResponse.json(
    { commit_sha: commitSha },
    { headers: NO_STORE_HEADERS }
  );
}
