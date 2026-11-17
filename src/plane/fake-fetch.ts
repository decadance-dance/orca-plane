// Test helper: stands in for fetch and records every request the plugin makes.
import { env } from './http'

export type FakeCall = { url: string; init: RequestInit }
export type FakeAnswer =
  | { status?: number; json?: unknown; body?: string; headers?: Record<string, string> }
  | Error
type Route = (url: URL, init: RequestInit) => FakeAnswer | Promise<FakeAnswer>

/** Routes each request to `route`; returns the recorded calls. Also stubs sleep and the clock. */
export function fakeFetch(route: Route, now = 1_700_000_000_000) {
  const calls: FakeCall[] = []
  const sleeps: number[] = []
  let clock = now
  env.now = () => clock
  env.sleep = async (ms) => {
    sleeps.push(ms)
    clock += ms
  }
  env.fetch = async (url, init) => {
    calls.push({ url, init })
    const answer = await route(new URL(url), init)
    if (answer instanceof Error) throw answer
    const body = answer.body ?? (answer.json === undefined ? '' : JSON.stringify(answer.json))
    return new Response(body, {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json', ...answer.headers }
    })
  }
  return { calls, sleeps, advance: (ms: number) => (clock += ms) }
}
