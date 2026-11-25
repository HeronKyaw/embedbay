const BOILERPLATE_PREFIXES = [
  /^IPC error:\s*/i,
  /^HTTP request failed:\s*/i,
  /^backend API error:\s*/i,
  /^HTTP download failed:\s*/i,
  /^Error:\s*/i,
];

function stripBoilerplatePrefixes(input: string): string {
  let current = input.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of BOILERPLATE_PREFIXES) {
      const next = current.replace(prefix, "").trim();
      if (next !== current) {
        current = next;
        changed = true;
      }
    }
  }
  return current;
}

function truncateText(text: string, maxLen = 140): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trimEnd()}…`;
}

export function formatUserError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);

  const stripped = stripBoilerplatePrefixes(raw);
  const collapsed = stripped.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return "An unexpected error occurred.";
  }

  const lower = collapsed.toLowerCase();

  if (lower.includes("<!doctype") || lower.includes("<html")) {
    return "Unexpected HTML response. Check VPN/SSO login or endpoint URL.";
  }

  if (
    lower.includes("dns error") ||
    lower.includes("failed to lookup address") ||
    lower.includes("no such host") ||
    lower.includes("os error 11001") ||
    lower.includes("name or service not known") ||
    lower.includes("getaddrinfo")
  ) {
    return "Host could not be resolved. Check the URL or VPN connection.";
  }

  if (
    !lower.startsWith("connection timed out.") &&
    !lower.startsWith("request timed out (") &&
    !lower.startsWith("gateway timeout (") &&
    (lower.includes("timed out") ||
      lower.includes("etimedout") ||
      lower.includes("os error 10060") ||
      lower.includes("deadline has elapsed") ||
      /\btimeout\b/.test(lower))
  ) {
    return "Connection timed out. Check your VPN or network connection.";
  }

  if (
    lower.includes("connection refused") ||
    lower.includes("actively refused") ||
    lower.includes("os error 10061") ||
    lower.includes("econnrefused")
  ) {
    return "Connection refused. Make sure the service is running and reachable.";
  }

  if (
    lower.includes("network is unreachable") ||
    lower.includes("no route to host") ||
    lower.includes("host is unreachable") ||
    lower.includes("os error 10051") ||
    lower.includes("os error 10065") ||
    lower.includes("enetunreach") ||
    lower.includes("ehostunreach")
  ) {
    return "Network unreachable. Check your VPN or network connection.";
  }

  if (
    !lower.startsWith("tls/ssl ") &&
    (lower.includes("unknownissuer") ||
      lower.includes("invalid peer certificate") ||
      lower.includes("ssl handshake") ||
      lower.includes("tls handshake") ||
      (lower.includes("certificate") &&
        (lower.includes("verify") ||
          lower.includes("rustls") ||
          lower.includes("openssl") ||
          lower.includes("error"))))
  ) {
    return "TLS/SSL handshake failed. Check the server certificate.";
  }

  if (
    lower.includes("error sending request for url") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("error trying to connect") ||
    lower.includes("client error (connect)")
  ) {
    return "Unable to reach endpoint. Check your VPN, network, or URL.";
  }

  const looksLikeRawHttpError =
    collapsed.length > 90 ||
    lower.includes("returned ") ||
    lower.includes("status ") ||
    lower.includes("http/") ||
    collapsed.includes("{");

  if (looksLikeRawHttpError) {
    if (lower.includes("401 unauthorized")) {
      return "Authentication failed (401). Check your API key or credentials.";
    }
    if (lower.includes("403 forbidden")) {
      return "Access denied (403). Check your credentials, permissions, or VPN auth.";
    }
    if (lower.includes("404 not found")) {
      return "Endpoint or resource not found (404). Check the URL and engine type.";
    }
    if (lower.includes("502 bad gateway")) {
      return "Bad gateway (502). The upstream service may be offline.";
    }
    if (lower.includes("503 service unavailable")) {
      return "Service unavailable (503). The server is temporarily unreachable.";
    }
    if (lower.includes("504 gateway timeout")) {
      return "Gateway timeout (504). The server took too long to respond.";
    }
  }

  if (lower.includes("unique constraint failed: instances.name")) {
    return "An instance with this name already exists. Please choose a different name.";
  }

  if (lower.includes("unique constraint failed: connection_groups.name")) {
    return "A group with this name already exists. Please choose a different name.";
  }

  if (lower.includes("unique constraint failed: tags.name")) {
    return "A tag with this name already exists. Please choose a different name.";
  }

  return truncateText(collapsed, 140);
}
