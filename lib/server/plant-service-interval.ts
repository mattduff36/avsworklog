import type { Client } from 'pg';

export async function effectivePlantServiceInterval(client: Client, plantId: string, globalInterval: number) {
  const { rows } = await client.query<{ interval_hours: number }>(
    'SELECT interval_hours FROM public.plant_service_intervals WHERE plant_id=$1', [plantId]);
  return rows[0]?.interval_hours ?? globalInterval;
}

// Caller holds the service_plant configuration lock, shared with completion and overrides.
export async function rebasePlantServiceSchedules(client: Client, interval: number, actorId: string | null,
  plantId: string | null = null) {
  const { rows } = await client.query<{ id: string; plant_id: string; last_service_hours: number; next_service_hours: number | null }>(`
    SELECT m.id,m.plant_id,m.last_service_hours,m.next_service_hours
    FROM public.vehicle_maintenance m
    WHERE m.plant_id IS NOT NULL AND m.last_service_hours IS NOT NULL
      AND ($1::uuid IS NULL OR m.plant_id=$1)
      AND ($1::uuid IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM public.plant_service_intervals o WHERE o.plant_id=m.plant_id))
    ORDER BY m.id FOR UPDATE OF m`, [plantId]);
  for (const row of rows) {
    const due = row.last_service_hours + interval;
    if (due === row.next_service_hours) continue;
    await client.query('UPDATE public.vehicle_maintenance SET next_service_hours=$2,updated_at=now() WHERE id=$1', [row.id, due]);
    await client.query(`INSERT INTO public.maintenance_history
      (plant_id,field_name,old_value,new_value,value_type,comment,updated_by)
      VALUES($1,'next_service_hours',$2,$3,'text','Recalculated from recorded last service after Plant interval change',$4)`,
    [row.plant_id, row.next_service_hours == null ? null : String(row.next_service_hours), String(due), actorId]);
  }
}
