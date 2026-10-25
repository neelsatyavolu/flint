export function buildCsp(opts: { dev: boolean }): string {
  const dev = opts.dev;
  const directives = [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "img-src 'self' data: blob: https: flint-attachment:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "frame-src 'self' about: blob:",
    dev ? "connect-src 'self' ws://localhost:* http://localhost:*" : "connect-src 'self'",
  ];
  return directives.join("; ");
}
