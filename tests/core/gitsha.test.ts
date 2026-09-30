import { expect, it } from 'vitest';
import { gitBlobSha } from '../../src/core/gitsha';

it('matches git hash-object (git-scm.com example, G4)', async () => {
  expect(await gitBlobSha('what is up, doc?')).toBe('bd9dbf5aae1a3862dd1526723246b20206e5fc37');
});

it('counts bytes, not characters', async () => {
  // `printf 'é' | git hash-object --stdin` — "é" is 2 bytes in UTF-8
  expect(await gitBlobSha('é')).toBe('4b04fff51468d8ab5201ab02b725dc477bc7cb45');
});
