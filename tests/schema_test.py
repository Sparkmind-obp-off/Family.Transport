import sqlite3, unittest
from pathlib import Path

class SchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript(Path('schema.sql').read_text())
        self.db.execute("INSERT INTO customers VALUES ('c','Synthetic','','','2026-10-04T00:00:00Z','2026-10-04T00:00:00Z')")
        self.db.execute("INSERT INTO drivers VALUES ('d','Synthetic','','',1,'2026-10-04T00:00:00Z','2026-10-04T00:00:00Z')")
        self.db.execute("INSERT INTO vehicles VALUES ('v','Synthetic','','',1,'2026-10-04T00:00:00Z','2026-10-04T00:00:00Z')")
    def tearDown(self):
        self.db.close()
    def trip(self, **kwargs):
        data = dict(id='t',customer_id='c',trip_date='2026-10-04',trip_time='08:00',pickup='A',destination='B',passengers=1,price=None,status='PENDING',created_at='2026-10-04T00:00:00Z',updated_at='2026-10-04T00:00:00Z')
        data.update(kwargs)
        self.db.execute('INSERT INTO trips ('+','.join(data)+') VALUES ('+','.join('?' for _ in data)+')',list(data.values()))
    def test_foreign_key_and_nullable_assignments(self):
        self.trip()
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(), [])
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute("UPDATE trips SET customer_id='missing'")
    def test_history_protected_from_parent_deletion(self):
        self.trip()
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute("DELETE FROM customers WHERE id='c'")
    def test_invalid_status(self):
        with self.assertRaises(sqlite3.IntegrityError): self.trip(status='BAD')
    def test_invalid_numbers(self):
        for changes in [dict(passengers=0),dict(passengers=1.5),dict(price=-1),dict(price=1.2)]:
            with self.assertRaises(sqlite3.IntegrityError): self.trip(**changes)
    def test_invalid_dates_and_times(self):
        for changes in [dict(trip_date='2026-02-30'),dict(trip_date='2026-13-01'),dict(trip_time='24:00')]:
            with self.assertRaises(sqlite3.IntegrityError): self.trip(**changes)
    def test_status_workflow(self):
        self.trip()
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute("UPDATE trips SET status='ON_TRIP'")
        self.db.execute("UPDATE trips SET status='CONFIRMED'")
        self.db.execute("UPDATE trips SET driver_id='d',vehicle_id='v',status='ASSIGNED'")
        self.db.execute("UPDATE trips SET status='ON_TRIP'")
        self.db.execute("UPDATE trips SET status='COMPLETED'")
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute("UPDATE trips SET status='PENDING'")
    def test_inactive_assignment(self):
        self.trip()
        self.db.execute("UPDATE drivers SET active=0 WHERE id='d'")
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute("UPDATE trips SET driver_id='d'")
    def test_retained_inactive_driver_blocks_assignment_completion(self):
        self.trip()
        self.db.execute("UPDATE trips SET status='CONFIRMED',driver_id='d'")
        self.db.execute("UPDATE drivers SET active=0 WHERE id='d'")
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute("UPDATE trips SET vehicle_id='v',status='ASSIGNED'")
        self.assertEqual(self.db.execute('SELECT status,vehicle_id FROM trips').fetchone(), ('CONFIRMED',None))
    def test_retained_inactive_vehicle_blocks_assignment_completion(self):
        self.trip()
        self.db.execute("UPDATE trips SET status='CONFIRMED',vehicle_id='v'")
        self.db.execute("UPDATE vehicles SET active=0 WHERE id='v'")
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute("UPDATE trips SET driver_id='d',status='ASSIGNED'")
    def test_inactive_assigned_resource_blocks_trip_start(self):
        self.trip()
        self.db.execute("UPDATE trips SET status='CONFIRMED'")
        self.db.execute("UPDATE trips SET status='ASSIGNED',driver_id='d',vehicle_id='v'")
        self.db.execute("UPDATE drivers SET active=0 WHERE id='d'")
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute("UPDATE trips SET status='ON_TRIP'")
    def test_direct_insert_inactive_resource_rejected(self):
        self.db.execute("UPDATE drivers SET active=0 WHERE id='d'")
        with self.assertRaises(sqlite3.IntegrityError): self.trip(driver_id='d')
    def test_indexes_and_integrity(self):
        self.assertEqual(self.db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
        names = [r[1] for r in self.db.execute("PRAGMA index_list('trips')")]
        self.assertIn('idx_trips_customer_date', names)
        self.assertIn('idx_trips_date_status', names)
    def test_migration_preserves_historical_records(self):
        db = sqlite3.connect(':memory:')
        db.executescript(Path('migrations/0001_initial.sql').read_text())
        db.execute("INSERT INTO customers VALUES('legacy','Old record','','','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')")
        db.execute("INSERT INTO trips(id,customer_id,trip_date,trip_time,pickup,destination,passengers,status,created_at,updated_at) VALUES('legacy','legacy','2020-01-01','08:00','A','B',0,'COMPLETED','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')")
        before = db.execute('SELECT * FROM trips').fetchall()
        for name in ['0002_integrity.sql','0003_assignment_guards.sql']:
            db.executescript(Path('migrations',name).read_text())
            self.assertEqual(before, db.execute('SELECT * FROM trips').fetchall())
        db.close()

if __name__ == '__main__': unittest.main(verbosity=2)
