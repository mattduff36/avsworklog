import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  url.pathname = `/api/admin/vans/${id}`;
  return NextResponse.redirect(url, 308);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  url.pathname = `/api/admin/vans/${id}`;
  return NextResponse.redirect(url, 308);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  url.pathname = `/api/admin/vans/${id}`;
  return NextResponse.redirect(url, 308);
}
