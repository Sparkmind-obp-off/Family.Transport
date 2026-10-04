# Technical Plan

## Architecture
Cloudflare-first full-stack web application.

Implemented baseline (preserving the existing lightweight scaffold):
- Frontend: semantic HTML + CSS + plain JavaScript DOM APIs, no large UI framework
- Backend/API: TypeScript Cloudflare Worker
- Database: Cloudflare D1 with additive migrations and assignment integrity guards
- Hosting: Cloudflare Pages Assets + bundled Worker, BYOK account
- Repository: GitHub; verified tests and deployment on pushes to main

React was an earlier recommendation, not an MVP requirement. It was not introduced because the existing static frontend meets the small mobile-first operational scope with less runtime overhead. No persistent background server, marketplace collections, or external database was added; the operational entities remain customers, drivers, vehicles, and trips.

## Principles
- Keep infrastructure cheap and simple.
- Keep domain logic server-side where appropriate.
- Validate all inputs.
- Keep data model small.
- Design for mobile usage.
- Make deployment reproducible.

## Security baseline
- Protected operator area
- Server-side validation
- No sensitive credentials committed
- Deployment secrets stored securely
- Minimal personal data

## WhatsApp
Use wa.me-style links generated from stored numbers. No WhatsApp API is required for MVP.
