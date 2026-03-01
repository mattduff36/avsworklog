import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/version
 * Returns the deployment ID of the currently running server.
 * Used by DeploymentVersionChecker to detect stale client bundles.
 */
export async function GET() {
  return NextResponse.json({
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || 'local',
  });
}
