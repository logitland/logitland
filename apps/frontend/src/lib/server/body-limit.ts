/** A report is a few short fields; 8 KB leaves room for 500 characters of any script and the form's own overhead. */
export const REPORT_BODY_MAX = 8 * 1024;

/** A claim code is nine characters; 2 KB covers the form's own overhead. */
export const CLAIM_BODY_MAX = 2 * 1024;

/** True when the request says how big its body is and that size is within the limit. A missing or malformed length is refused, so nothing unbounded is read. */
export function bodyWithin(request: Request, max: number): boolean {
  const header = request.headers.get('content-length');
  if (!header || !/^\d+$/.test(header)) return false;
  const length = Number(header);
  return length > 0 && length <= max;
}
