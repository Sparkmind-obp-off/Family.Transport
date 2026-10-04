# Operating Notes

## Intended use
This tool is an operational aid, not a replacement for existing relationships and communication methods.

## Typical use
1. Customer messages through WhatsApp.
2. Operator creates a trip.
3. Operator coordinates driver/vehicle externally.
4. Operator records assignment in the app.
5. Operator updates status during the trip.
6. Operator marks the trip completed.

## Operator access and practical sequence (2026-10-04)
- Open the production HTTPS URL and use the browser's Basic authentication prompt: username `operator`, password provided privately. Never write the password in customer notes or chats.
- Add active driver and vehicle records, then create a PENDING trip with an existing/new customer.
- Confirm availability first (CONFIRMED), then assign driver and vehicle. Complete assignment automatically sets ASSIGNED.
- Mark ON_TRIP and then COMPLETED. Cancel instead of deleting; terminal trips are preserved and cannot be edited through the app.
- Phone prefix 0 is normalized to 62. WhatsApp shortcuts only open a draft; the operator reviews and sends manually.
- Dashboard dates follow the operator device's local date. Check the phone's timezone and clock.
- HTTP Basic uses a browser session rather than an app logout button. Use a trusted device/private window and close the full session when finished. Password rotation is done through Cloudflare Pages secrets, not source code.
- Production starts without sample customer data. Synthetic tests are local, or explicitly cleaned up after production smoke testing.

## Important
Do not require drivers or customers to install anything.

## Data hygiene
- Keep customer phone numbers accurate.
- Use one trip record per journey.
- Do not delete completed trips unless there is a clear administrative reason.
- Keep notes factual and minimal.
