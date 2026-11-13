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
- [ ] **"Current problem" switch for photos:** set (B) and every photo taken is tagged (B) until it's switched. Switch back to (A) at any time, so photos taken out of order (from the roof space, or spotted on the way out) still land on the right problem. The AI sorting stays as the backup.
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
- Overview markup: several pins per letter, area circles, arrows, text labels, move, undo, delete
- Area outlines (tap each corner, e.g. round the building) beside the circles, with the problem letter inside both
- Markup on any report photo: open it full screen, then Mark up (same tools; starts in the photo's own letter). Make safe photos too, in White
- Problem letters past (C): the AI gives each separate defect its own letter with no limit, and letters run A–Z (colours repeat after L)
- One letter list everywhere: a letter in the cause, page one, a photo tag or markup is offered on the photos and the overview at once, plus a spare. Page one lists a problem added to the cause straight away (its first point), and when page one falls behind the cause a note offers Update Page One, which rewrites only the short cause and problem lines. A copy of the cause is kept each time page one is written; any word change to a problem's points (not just capitals or punctuation) flags that problem, and the update is shown what changed. The button is always there under page one's fields
