# Technical Plan

## Architecture
Cloudflare-first full-stack web application.

Recommended baseline:
- Frontend: React + TypeScript
- Backend/API: Cloudflare Workers
- Database: Cloudflare D1
- Hosting: Cloudflare Pages/Workers as appropriate
- Repository: GitHub

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
