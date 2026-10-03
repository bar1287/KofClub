export default async function globalTeardown(): Promise<void> {
  const child = globalThis.__GAME_SERVICE__;
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}
