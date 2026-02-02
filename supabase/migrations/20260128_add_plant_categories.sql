-- Add plant machinery vehicle categories (from actual data)
-- Using ON CONFLICT to make idempotent
INSERT INTO vehicle_categories (name, description) VALUES
  ('Excavation & Earthmoving', 'Excavators, backhoes, bulldozers, graders'),
  ('Loading & Material Handling', 'Forklifts, telehandlers, wheel loaders'),
  ('Compaction, Crushing & Processing', 'Rollers, crushers, screeners, compactors'),
  ('Transport & Utility Vehicles', 'Dumpers, utility vehicles, agricultural tractors'),
  ('Access & Site Support', 'Cherry pickers, scissor lifts, generators'),
  ('Unclassified', 'Uncategorized plant machinery')
ON CONFLICT (name) DO NOTHING;

-- Add hours-based maintenance category
INSERT INTO maintenance_categories (
  name, description, type, alert_threshold_hours,
  is_active, responsibility, show_on_overview, applies_to
) VALUES
  ('Service Due (Hours)', 'Regular service based on engine hours', 'hours', 50,
   true, 'workshop', true, ARRAY['plant'])
ON CONFLICT (name) DO NOTHING;
