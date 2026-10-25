export type CfProps = { asn?: number; asOrganization?: string; country?: string; city?: string };

export function requestIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "0.0.0.0";
}

export function cfProps(request: Request): CfProps {
  return (request as Request & { cf?: CfProps }).cf ?? {};
}
