"""Offline bundle guard: Python networking is limited to numeric loopback addresses.

Installed as sitecustomize.py in the bundled embedded interpreter. This is not an
OS firewall and does not restrict unrelated programs. No user/system files change.
"""

import ipaddress
import socket
import sys

sys.dont_write_bytecode = True


def _loopback(host):
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except (TypeError, ValueError):
        return False


_connect = socket.socket.connect
_connect_ex = socket.socket.connect_ex
_getaddrinfo = socket.getaddrinfo


def _local_connect(self, address):
    if self.family in (socket.AF_INET, socket.AF_INET6) and not _loopback(address[0]):
        raise OSError("PolicyGlass offline bundle blocks non-loopback networking")
    return _connect(self, address)


def _local_connect_ex(self, address):
    if self.family in (socket.AF_INET, socket.AF_INET6) and not _loopback(address[0]):
        raise OSError("PolicyGlass offline bundle blocks non-loopback networking")
    return _connect_ex(self, address)


def _local_getaddrinfo(host, *args, **kwargs):
    if host is not None and not _loopback(host):
        raise OSError("PolicyGlass offline bundle blocks external DNS")
    return _getaddrinfo(host, *args, **kwargs)


socket.socket.connect = _local_connect
socket.socket.connect_ex = _local_connect_ex
socket.getaddrinfo = _local_getaddrinfo
POLICYGLASS_OFFLINE_GUARD = True
