export function hostnameFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeDomainEntry(value: string): string | null {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("://")) {
    return hostnameFromUrl(normalized);
  }

  return normalized.split("/")[0]?.split(":")[0] ?? null;
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
    const normalized = normalizeDomainEntry(entry);

    if (!normalized) {
      return false;
    }

    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}
