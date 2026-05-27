export function hostnameFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isDomainAllowed(url: string, whitelist: string[]): boolean {
  if (whitelist.length === 0) {
    return true;
  }

  const hostname = hostnameFromUrl(url);

  if (!hostname) {
    return false;
  }

  return whitelist.some((entry) => {
    const normalized = entry.trim().toLowerCase();

    if (!normalized) {
      return false;
    }

    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}
