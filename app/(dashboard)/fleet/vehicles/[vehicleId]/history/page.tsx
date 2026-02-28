import { redirect } from 'next/navigation';

export default async function VehicleHistoryRedirect({ params }: { params: Promise<{ vehicleId: string }> }) {
  const { vehicleId } = await params;
  redirect(`/fleet/vans/${vehicleId}/history`);
}
