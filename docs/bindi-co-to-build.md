# Bindi Co field app — to build

The roof-report side of the system (the Midcity field app, `app/midcity`). Done items move to the bottom.

## Next

- [ ] **Safety: SWMS for high-risk work (working at heights).** Roof work is high-risk construction work, so a SWMS has to be in place before the work starts, kept on site and followed.
  - Fast like the IRC field app's Safety step (tap chips, sign), but with what a SWMS has to hold:
    - a master roof-inspection SWMS covering ladder access, falls, fragile and brittle roofs, solar and electrical, weather, heat, asbestos and roof-space hazards
    - for each job, confirm on site with yes/no taps: the conditions on the day, the controls in place (ladder secured, gutter brackets, harness and anchor, edge, weather), anything new, and a photo where it helps (ladder setup, anchor)
    - signature, date and time
  - Saved as a PDF with the job, and stopped and re-done if conditions change.
  - Get the master SWMS content checked against the WA WHS regulations and WorkSafe WA guidance (or by a safety consultant) before relying on it.
- [ ] **Overview markup:**
  - several pins per letter (e.g. 7 broken tiles)
  - an area circle for a cluster
  - arrows
  - short text labels
- [ ] **"Problem" photo bursts:** tap "Problem B" before taking its photos, so they're tagged by the order taken instead of AI guesses.
- [ ] **Guided dictation:** prompts in report order, so the notes come out in the order the AI writes the report.
- [ ] **Crop step for the overview screenshot**, before placing pins.
- [ ] **Bindi Co logo** on the report (replaces the placeholder house).
- [ ] **Finish and send from the phone:** server PDF, email to the builder, QuickBooks invoice.
- [ ] **Bindi Co as its own business (tenant):** own Gmail and QuickBooks, Midcity as its first builder.
- [ ] **Booking by text** with the insured, and work orders in by email.
- [ ] **Builder portal scripts (Playwright):** accept the job, upload the report, complete it and invoice.

## Done

- Roof-only mode, and sign-in on the report AI routes
- Cause of damage as dot points with colour-coded problem letters (A), (B)…
- Roof photos: IRC uploader, one-tap tags (letters, fixed types, none), AI sorting
- Page one: roof overview with pins, problems, short cause, maintenance
