// The Gemini model the app uses for email parsing, matching and photo labels.
// Google retires Gemini models on a schedule (gemini-2.5-flash was shut down on
// the Gemini API on 16 Oct 2026, which silently stopped order emails being
// classified), so every call names this constant — change it here when a
// model is deprecated.
export const GEMINI_FLASH_MODEL = 'gemini-3.5-flash'
