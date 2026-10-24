"""Network security validation and SSRF protection for outbound test probes."""
import ipaddress
import logging
import socket
from urllib.parse import urlparse
from typing import Tuple, Optional

logger = logging.getLogger(__name__)

# Cloud metadata IP addresses that are always dangerous and prohibited
BLOCKED_METADATA_IPS = {
    ipaddress.ip_network("169.254.169.254/32"),  # AWS, GCP, Azure, OpenStack
    ipaddress.ip_network("169.254.169.250/32"),
    ipaddress.ip_network("169.254.169.251/32"),
}

BLOCKED_HOSTNAMES = {
    "metadata.google.internal",
    "metadata.goog",
    "instance-data",
}

# Standard private networks
PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def sanitize_url_for_display(url: str) -> str:
    """Return a clean version of the URL containing only scheme, host, and port."""
    try:
        parsed = urlparse(url)
        netloc = parsed.netloc.split("@")[-1]  # Strip any embedded basic-auth user:pass
        return f"{parsed.scheme}://{netloc}"
    except Exception:
        return "[redacted-url]"


def validate_outbound_url(
    url: str,
    allow_local_network: bool = True
) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Validate that an outbound test URL is safe and well-formed.

    Returns:
        (is_valid, sanitized_url, error_message)
    """
    if not url or not isinstance(url, str):
        return False, None, "URL is empty or invalid."

    url = url.strip()

    try:
        parsed = urlparse(url)
    except Exception as exc:
        return False, None, f"Malformed URL syntax: {type(exc).__name__}"

    if parsed.scheme.lower() not in ("http", "https"):
        return False, None, f"Unsupported URL scheme '{parsed.scheme}'. Only HTTP and HTTPS are permitted."

    hostname = parsed.hostname
    if not hostname:
        return False, None, "URL missing valid hostname."

    hostname_clean = hostname.strip().lower()

    # Check blocked metadata hostnames
    if hostname_clean in BLOCKED_HOSTNAMES:
        return False, None, "Access to cloud instance metadata hostnames is forbidden."

    port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    if not (1 <= port <= 65535):
        return False, None, f"Invalid port number {port}."

    # Resolve IP address to prevent DNS rebinding and internal network scanning
    try:
        addr_info = socket.getaddrinfo(hostname_clean, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        return False, None, f"Unable to resolve hostname '{hostname_clean}': {exc.strerror}"
    except Exception as exc:
        return False, None, f"Failed resolving hostname '{hostname_clean}': {type(exc).__name__}"

    if not addr_info:
        return False, None, f"No IP address resolved for hostname '{hostname_clean}'."

    # Inspect all resolved IPs
    for entry in addr_info:
        ip_str = entry[4][0]
        try:
            ip_obj = ipaddress.ip_address(ip_str)
        except ValueError:
            return False, None, f"Invalid resolved IP address '{ip_str}'."

        # 1. Cloud metadata IP is ALWAYS prohibited under all environments
        for meta_net in BLOCKED_METADATA_IPS:
            if ip_obj in meta_net:
                return False, None, "Destination resolves to forbidden cloud metadata IP address (169.254.169.254)."

        # 2. Check private and loopback networks
        is_private_or_loopback = (
            ip_obj.is_loopback or
            ip_obj.is_private or
            ip_obj.is_link_local or
            any(ip_obj in net for net in PRIVATE_NETWORKS)
        )

        if is_private_or_loopback and not allow_local_network:
            return (
                False,
                None,
                f"Destination IP '{ip_str}' belongs to a private/loopback network and is blocked in production mode."
            )

    sanitized = f"{parsed.scheme.lower()}://{parsed.netloc.split('@')[-1]}{parsed.path or ''}"
    return True, sanitized, None
