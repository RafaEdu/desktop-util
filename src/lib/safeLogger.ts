const SAFE_CODE_PATTERN = /^[A-Z0-9_:-]{3,80}$/;

/**
 * Emits only a fixed diagnostic code in development builds.
 *
 * Never pass user content, URLs, filenames, certificate data, clipboard data,
 * database rows or raw Error objects to this function.
 */
export function logSafeError(code: string): void {
  if (!import.meta.env.DEV) {
    return;
  }

  const safeCode = SAFE_CODE_PATTERN.test(code) ? code : "UNSPECIFIED_ERROR";
  console.error(`[${safeCode}]`);
}
