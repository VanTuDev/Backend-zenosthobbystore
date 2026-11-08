// Minimal typing for the Workers-only module used by src/worker.ts (avoids pulling the whole
// @cloudflare/workers-types set, which conflicts with @types/node globals).
declare module "cloudflare:node" {
  export function httpServerHandler(options: { port: number }): {
    fetch(request: unknown, env?: unknown, ctx?: unknown): Promise<unknown>;
  };
}
