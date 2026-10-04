-- Additive guards only. Existing records and earlier migrations are not rewritten.
-- A retained resource can become inactive between an API read and its D1 write.
CREATE TRIGGER IF NOT EXISTS trips_resources_active_insert BEFORE INSERT ON trips
WHEN (NEW.driver_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM drivers WHERE id=NEW.driver_id AND active=1
)) OR (NEW.vehicle_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM vehicles WHERE id=NEW.vehicle_id AND active=1
))
BEGIN SELECT RAISE(ABORT, 'inactive_assignment'); END;

CREATE TRIGGER IF NOT EXISTS trips_resources_active_change BEFORE UPDATE ON trips
WHEN NEW.status IN ('ASSIGNED','ON_TRIP')
 AND (NEW.status IS NOT OLD.status OR NEW.driver_id IS NOT OLD.driver_id OR NEW.vehicle_id IS NOT OLD.vehicle_id)
 AND (NOT EXISTS (SELECT 1 FROM drivers WHERE id=NEW.driver_id AND active=1)
   OR NOT EXISTS (SELECT 1 FROM vehicles WHERE id=NEW.vehicle_id AND active=1))
BEGIN SELECT RAISE(ABORT, 'inactive_assignment'); END;
