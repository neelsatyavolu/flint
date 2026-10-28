"""Loopback proxy for the Swift GreenMail suite: LISTEN_PORT -> UPSTREAM_PORT on 127.0.0.1.

GreenMail 1.6.15 answers SELECT with `* FLAGS (... \\*)`. The `\\*` wildcard is only legal inside PERMANENTFLAGS, and
swift-nio-imap's strict parser rejects the whole response, so every SELECT would fail. This proxy forwards bytes and drops the
`\\*` from untagged `* FLAGS` lines only. It exists for tests; real servers do not send that line.

usage: python3 -I greenmail-imap-proxy.py LISTEN_PORT UPSTREAM_PORT
"""
import asyncio
import re
import sys

LISTEN = int(sys.argv[1])
UPSTREAM = ("127.0.0.1", int(sys.argv[2]))
LIMIT = 1 << 26  # a BODYSTRUCTURE or a FETCH line can be long
BAD = re.compile(rb"^(\* FLAGS \(.*?) ?\\\*\)\r\n$")


async def pump_up(reader, writer):
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        writer.close()


async def pump_down(reader, writer):
    try:
        while line := await reader.readline():
            match = BAD.match(line)
            if match:
                line = match.group(1) + b")\r\n"
            writer.write(line)
            await writer.drain()
    except Exception:
        pass
    finally:
        writer.close()


async def handle(client_reader, client_writer):
    try:
        upstream_reader, upstream_writer = await asyncio.open_connection(*UPSTREAM, limit=LIMIT)
    except Exception:
        client_writer.close()
        return
    await asyncio.gather(pump_up(client_reader, upstream_writer), pump_down(upstream_reader, client_writer))


async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", LISTEN, limit=LIMIT)
    async with server:
        await server.serve_forever()


asyncio.run(main())
