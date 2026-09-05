// Single-flight + TTL cache for `openclaw doctor` GET polling (closes #613).
//
// Extracted from src/app/api/openclaw/doctor/route.ts because Next.js 16 forbids
// route files from exporting anything other than HTTP handlers + route config —
// the cache helpers (invalidateDoctorCache, runAndCacheDoctor) and their internal
// state live here so the route exports only GET/POST and tests import directly.
//
// `openclaw doctor` spawns a Node subprocess that allocates ~300-600 MB and runs
// at 37-51 % CPU. The dashboard banner + onboarding modal + multiple polling tabs
// could produce 6+ simultaneous subprocesses on a 4 GB host (issue #613).
// Two GET-only mitigations (POST/--fix stays uncoalesced — operators want a fresh run):
//   1. Single-flight: share an in-flight invocation with all concurrent callers.
//   2. TTL cache: cache the last successful response for MC_DOCTOR_TTL_MS (30 s default).
// Cache is invalidated by a successful POST /api/openclaw/doctor (--fix).

import { runOpenClaw } from '@/lib/command'
import { config } from '@/lib/config'
import { parseOpenClawDoctorOutput } from '@/lib/openclaw-doctor'

export function getCommandDetail(error: unknown): { detail: string; code: number | null } {
  const err = error as {
    stdout?: string
    stderr?: string
    message?: string
    code?: number | null
  }

  return {
    detail: [err?.stdout, err?.stderr, err?.message].filter(Boolean).join('\n').trim(),
    code: typeof err?.code === 'number' ? err.code : null,
  }
}

export function isMissingOpenClaw(detail: string): boolean {
  return /enoent|not installed|not reachable|command not found/i.test(detail)
}

export interface CachedDoctor {
  payload: unknown
  status: number
  fetchedAt: number
}

interface DoctorCacheModule {
  cached: CachedDoctor | null
  inFlight: Promise<CachedDoctor> | null
  ttlMs: number
}

// Module-level singleton (lives across requests within one server worker).
export const doctorCache: DoctorCacheModule = (() => {
  // Allow operators to tune the TTL (e.g. CI smoke tests set it to 0).
  const fromEnv = Number.parseInt(process.env.MC_DOCTOR_TTL_MS || '', 10)
  const ttlMs = Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : 30_000
  return { cached: null, inFlight: null, ttlMs }
})()

/** Internal helper: invalidates the GET cache. Called by POST after --fix. */
export function invalidateDoctorCache(): void {
  doctorCache.cached = null
}

export async function runAndCacheDoctor(): Promise<CachedDoctor> {
  try {
    const result = await runOpenClaw(['doctor'], { timeoutMs: 15000 })
    const payload = parseOpenClawDoctorOutput(
      `${result.stdout}\n${result.stderr}`,
      result.code ?? 0,
      { stateDir: config.openclawStateDir },
    )
    const entry: CachedDoctor = { payload, status: 200, fetchedAt: Date.now() }
    doctorCache.cached = entry
    return entry
  } catch (error) {
    const { detail, code } = getCommandDetail(error)
    if (isMissingOpenClaw(detail)) {
      // Don't cache "not installed" — the operator may install OpenClaw and
      // we want the next poll to pick that up immediately rather than waiting
      // out the TTL.
      const entry: CachedDoctor = {
        payload: { error: 'OpenClaw is not installed or not reachable' },
        status: 400,
        fetchedAt: Date.now(),
      }
      return entry
    }
    const payload = parseOpenClawDoctorOutput(detail, code ?? 1, {
      stateDir: config.openclawStateDir,
    })
    // Cache the parsed-error payload (status 200) so a flapping doctor doesn't
    // re-spawn on every poll. The payload itself carries the failure detail.
    const entry: CachedDoctor = { payload, status: 200, fetchedAt: Date.now() }
    doctorCache.cached = entry
    return entry
  }
}
