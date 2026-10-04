CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  whatsapp TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  whatsapp TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  identifier TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  trip_date TEXT NOT NULL,
  trip_time TEXT NOT NULL,
  pickup TEXT NOT NULL,
  destination TEXT NOT NULL,
  passengers INTEGER NOT NULL DEFAULT 1,
  vehicle_id TEXT,
  driver_id TEXT,
  price INTEGER,
  partner_source TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id)
);

CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(trip_date);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);

-- Additive migration: no drops, rewrites, or deletes; historical rows remain intact.
CREATE INDEX IF NOT EXISTS idx_trips_customer_date ON trips(customer_id,trip_date);
CREATE INDEX IF NOT EXISTS idx_trips_date_status ON trips(trip_date,status);
CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON trips(vehicle_id);
CREATE TRIGGER IF NOT EXISTS trips_validate_insert BEFORE INSERT ON trips
WHEN NEW.status NOT IN ('PENDING','CONFIRMED','ASSIGNED','ON_TRIP','COMPLETED','CANCELLED')
 OR typeof(NEW.passengers) != 'integer' OR NEW.passengers NOT BETWEEN 1 AND 100
 OR (NEW.price IS NOT NULL AND (typeof(NEW.price) != 'integer' OR NEW.price NOT BETWEEN 0 AND 1000000000))
 OR length(trim(NEW.pickup)) = 0 OR length(trim(NEW.destination)) = 0
 OR NEW.trip_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
 OR date(NEW.trip_date,'+0 days') IS NULL OR date(NEW.trip_date,'+0 days') != NEW.trip_date
 OR NEW.trip_date < '2000-01-01' OR NEW.trip_date > '2100-12-31'
 OR NEW.trip_time NOT GLOB '[0-2][0-9]:[0-5][0-9]' OR NEW.trip_time > '23:59'
 OR (NEW.status IN ('ASSIGNED','ON_TRIP','COMPLETED') AND (NEW.driver_id IS NULL OR NEW.vehicle_id IS NULL))
BEGIN SELECT RAISE(ABORT, 'invalid_trip'); END;
CREATE TRIGGER IF NOT EXISTS trips_validate_update BEFORE UPDATE ON trips
WHEN NEW.status NOT IN ('PENDING','CONFIRMED','ASSIGNED','ON_TRIP','COMPLETED','CANCELLED')
 OR typeof(NEW.passengers) != 'integer' OR NEW.passengers NOT BETWEEN 1 AND 100
 OR (NEW.price IS NOT NULL AND (typeof(NEW.price) != 'integer' OR NEW.price NOT BETWEEN 0 AND 1000000000))
 OR length(trim(NEW.pickup)) = 0 OR length(trim(NEW.destination)) = 0
 OR NEW.trip_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
 OR date(NEW.trip_date,'+0 days') IS NULL OR date(NEW.trip_date,'+0 days') != NEW.trip_date
 OR NEW.trip_date < '2000-01-01' OR NEW.trip_date > '2100-12-31'
 OR NEW.trip_time NOT GLOB '[0-2][0-9]:[0-5][0-9]' OR NEW.trip_time > '23:59'
 OR (NEW.status IN ('ASSIGNED','ON_TRIP','COMPLETED') AND (NEW.driver_id IS NULL OR NEW.vehicle_id IS NULL))
BEGIN SELECT RAISE(ABORT, 'invalid_trip'); END;
CREATE TRIGGER IF NOT EXISTS drivers_active_insert BEFORE INSERT ON drivers
WHEN NEW.active NOT IN (0,1)
BEGIN SELECT RAISE(ABORT, 'invalid_active'); END;
CREATE TRIGGER IF NOT EXISTS drivers_active_update BEFORE UPDATE ON drivers
WHEN NEW.active NOT IN (0,1)
BEGIN SELECT RAISE(ABORT, 'invalid_active'); END;
CREATE TRIGGER IF NOT EXISTS vehicles_active_insert BEFORE INSERT ON vehicles
WHEN NEW.active NOT IN (0,1)
BEGIN SELECT RAISE(ABORT, 'invalid_active'); END;
CREATE TRIGGER IF NOT EXISTS vehicles_active_update BEFORE UPDATE ON vehicles
WHEN NEW.active NOT IN (0,1)
BEGIN SELECT RAISE(ABORT, 'invalid_active'); END;
CREATE TRIGGER IF NOT EXISTS trips_status_transition BEFORE UPDATE OF status ON trips
WHEN NEW.status != OLD.status AND NOT (
 (OLD.status='PENDING' AND NEW.status IN ('CONFIRMED','CANCELLED')) OR
 (OLD.status='CONFIRMED' AND NEW.status IN ('ASSIGNED','CANCELLED')) OR
 (OLD.status='ASSIGNED' AND NEW.status IN ('ON_TRIP','CANCELLED')) OR
 (OLD.status='ON_TRIP' AND NEW.status IN ('COMPLETED','CANCELLED')))
BEGIN SELECT RAISE(ABORT, 'invalid_transition'); END;
CREATE TRIGGER IF NOT EXISTS trips_assignment_active BEFORE UPDATE ON trips
WHEN (NEW.driver_id IS NOT OLD.driver_id AND NEW.driver_id IS NOT NULL AND
 NOT EXISTS(SELECT 1 FROM drivers WHERE id=NEW.driver_id AND active=1)) OR
 (NEW.vehicle_id IS NOT OLD.vehicle_id AND NEW.vehicle_id IS NOT NULL AND
 NOT EXISTS(SELECT 1 FROM vehicles WHERE id=NEW.vehicle_id AND active=1))
BEGIN SELECT RAISE(ABORT, 'inactive_assignment'); END;

-- Additive guards only. Existing records and earlier migrations are not rewritten.
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
