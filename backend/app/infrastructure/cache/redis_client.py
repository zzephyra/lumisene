"""Small Redis client for the settings cache. PostgreSQL remains the source of truth."""

import asyncio
import json
from urllib.parse import urlsplit

from app.modules.settings.defaults import cache_accepts

_PUBLISH = """
local current = redis.call('GET', KEYS[1])
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and type(decoded) == 'table' and tonumber(decoded['revision']) then
    if tonumber(decoded['revision']) > tonumber(ARGV[2]) then
      return 0
    end
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
"""


class SettingsCache:
    def __init__(self, url: str, *, ttl_seconds: int = 60) -> None:
        self._url = url.strip()
        self._ttl = ttl_seconds

    async def read(self) -> dict | None:
        if not self._url:
            return None
        try:
            raw = await _command(self._url, "GET", "system-settings:v1")
        except Exception:
            return None
        if not isinstance(raw, str):
            return None
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return None
        return payload if isinstance(payload, dict) else None

    async def publish(self, document: dict) -> bool:
        if not self._url:
            return False
        revision = document.get("revision")
        if not isinstance(revision, int):
            return False
        encoded = json.dumps(document, separators=(",", ":"))
        try:
            result = await _command(
                self._url,
                "EVAL",
                _PUBLISH,
                "1",
                "system-settings:v1",
                encoded,
                str(revision),
                str(self._ttl),
            )
        except Exception:
            return False
        return result == 1


def accept_cached_write(current: dict | None, incoming_revision: int) -> bool:
    stored = None
    if isinstance(current, dict) and isinstance(current.get("revision"), int):
        stored = current["revision"]
    return cache_accepts(stored, incoming_revision)


async def _command(url: str, *parts: str) -> str | int | None:
    location = urlsplit(url)
    if location.scheme != "redis" or not location.hostname:
        raise RuntimeError("redis url is invalid")
    db = location.path.lstrip("/") or "0"
    port = location.port or 6379
    connection = asyncio.open_connection(location.hostname, port)
    reader, writer = await asyncio.wait_for(connection, timeout=1)
    try:
        if location.password:
            await _call(reader, writer, "AUTH", location.password)
        if db != "0":
            await _call(reader, writer, "SELECT", db)
        return await _call(reader, writer, *parts)
    finally:
        writer.close()
        await writer.wait_closed()


async def _call(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, *parts: str) -> str | int | None:
    payload = f"*{len(parts)}\r\n".encode()
    for part in parts:
        encoded = part.encode()
        payload += f"${len(encoded)}\r\n".encode() + encoded + b"\r\n"
    writer.write(payload)
    await writer.drain()
    return await asyncio.wait_for(_read(reader), timeout=1)


async def _read(reader: asyncio.StreamReader) -> str | int | None:
    prefix = await reader.readexactly(1)
    line = (await reader.readline()).rstrip(b"\r\n")
    if prefix == b"+":
        return line.decode()
    if prefix == b":":
        return int(line)
    if prefix == b"-":
        raise RuntimeError("redis command failed")
    if prefix == b"$":
        size = int(line)
        if size < 0:
            return None
        data = await reader.readexactly(size)
        await reader.readexactly(2)
        return data.decode()
    raise RuntimeError("redis response is invalid")
