/**
 * A failed Google Calendar API request. The HTTP status lets callers name the
 * cause (see classifyCalendarError) without storing Google's response text.
 */
export class GoogleRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GoogleRequestError";
  }
}
