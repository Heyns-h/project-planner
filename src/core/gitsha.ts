// Git blob SHA: SHA-1 of "blob <byte length>\0" + content (verification G4).
// Used to confirm the local cache matches the repo without downloading.

const encoder = new TextEncoder();

export async function gitBlobSha(content: string): Promise<string> {
  const body = encoder.encode(content);
  const header = encoder.encode(`blob ${body.byteLength}\0`);
  const data = new Uint8Array(header.byteLength + body.byteLength);
  data.set(header, 0);
  data.set(body, header.byteLength);
  const digest = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
