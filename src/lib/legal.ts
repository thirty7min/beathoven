export const OPERATOR_NAME = "Beathoven";
export const CONTACT_EMAIL = "beathovensupport@gmail.com";
export const GOVERNING_LAW = "the Commonwealth of Virginia, United States";
export const MIN_AGE = 13;
export const LEGAL_LAST_UPDATED = "2026-10-18";
export const SUBMISSION_RETENTION_DAYS = 30;

export function formatLegalDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });
}
