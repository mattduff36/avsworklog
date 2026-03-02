import { NextRequest, NextResponse } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export function redirectToLegacyVanEndpoint(request: NextRequest, fromPath: string): NextResponse {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(fromPath, "/api/admin/vans");
  return NextResponse.redirect(url, 308);
}

export async function redirectToLegacyVanEndpointById(
  request: NextRequest,
  context: RouteParams
): Promise<NextResponse> {
  const { id } = await context.params;
  const url = new URL(request.url);
  url.pathname = `/api/admin/vans/${id}`;
  return NextResponse.redirect(url, 308);
}

