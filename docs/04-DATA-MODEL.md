# Data Model — MVP

## Customer
- id
- name
- whatsapp
- notes
- created_at
- updated_at

## Driver
- id
- name
- whatsapp
- notes
- active
- created_at
- updated_at

## Vehicle
- id
- name/type
- identifier/plate (optional)
- notes
- active
- created_at
- updated_at

## Trip
- id
- customer_id
- trip_date
- trip_time
- pickup
- destination
- passengers
- vehicle_id (nullable)
- driver_id (nullable)
- price (nullable)
- partner/source (nullable)
- notes
- status
- created_at
- updated_at

## Design note
Do not over-model partner accounting or financial settlement in MVP. The system only needs enough information to coordinate the trip.
