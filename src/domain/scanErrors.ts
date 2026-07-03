export type ScanError = {
  page?: number;
  action: string;
  message: string;
};

export function describeApiError(res: any, fallback: string): string {
  const code = res?.error?.code ?? res?.code;
  const message = res?.error?.message ?? res?.message ?? fallback;
  return code !== undefined ? `${message} (${code})` : String(message);
}

export function describeThrownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatRecentErrors(errors: ScanError[], limit = 3): string {
  return errors
    .slice(-limit)
    .map(error => {
      const page = error.page !== undefined ? `Page ${error.page + 1} ` : '';
      return `${page}${error.action}: ${error.message}`;
    })
    .join('; ');
}

export function addScanError(errors: ScanError[], error: ScanError): void {
  errors.push(error);
  if (errors.length > 20) {
    errors.shift();
  }
}
