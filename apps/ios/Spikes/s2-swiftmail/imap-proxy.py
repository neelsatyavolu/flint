"""Spike S2: loopback proxy 127.0.0.1:3144 -> 3143 that rewrites GreenMail's non-compliant untagged
`* FLAGS (... \\*)` line (the `\\*` wildcard is only legal in PERMANENTFLAGS) so swift-nio-imap's strict parser accepts it."""
import asyncio, re, sys

UP = ("127.0.0.1", 3143)
BAD = re.compile(rb"^(\* FLAGS \(.*?) ?\\\*\)\r\n$")

async def pump_up(r, w):
    try:
        while data := await r.read(65536):
            w.write(data); await w.drain()
    except Exception:
        pass
    finally:
        w.close()

async def pump_down(r, w):
    try:
        while line := await r.readline():
            m = BAD.match(line)
            if m:
                line = m.group(1) + b")\r\n"
            w.write(line); await w.drain()
    except Exception:
        pass
    finally:
        w.close()

async def handle(cr, cw):
    ur, uw = await asyncio.open_connection(*UP)
    await asyncio.gather(pump_up(cr, uw), pump_down(ur, cw))

async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", 3144)
    async with server:
        await server.serve_forever()

asyncio.run(main())
