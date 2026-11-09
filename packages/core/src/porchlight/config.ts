/** Where Porchlight lives. Pairing links (flint://porchlight/pair?code=…&host=…) are accepted only for PORCHLIGHT_HOST. */
export const PORCHLIGHT_ORIGIN = "https://porchlight.xanom.co";
export const PORCHLIGHT_HOST = new URL(PORCHLIGHT_ORIGIN).host;
/** Signed in, this page makes a pairing code and opens it in Flint as a flint:// link. */
export const PORCHLIGHT_CONNECT_URL = `${PORCHLIGHT_ORIGIN}/app/connect/flint`;
