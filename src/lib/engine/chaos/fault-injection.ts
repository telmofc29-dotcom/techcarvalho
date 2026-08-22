// CHAOS: the fault injector.
//
// WHAT THIS IS FOR
// ----------------
// `proofs.ts` defines `chaos_proven` as "the failure was deliberately INDUCED
// and the system's real response observed", and explicitly refuses to accept a
// passing unit test as evidence for any fail-closed capability. The difference
// between the two is where the failure comes from: a unit test hands a function
// a hand-written argument that represents a failure, whereas a chaos run breaks
// something underneath the system and watches what the system actually does.
//
// So this module is a FAKE DATABASE, not a fake assertion. It stands where
// `supabase.rpc()` stands, it answers in exactly the bytes PostgREST answers in,
// and it can be told to fail in each of the specific ways this project has
// actually been failed by. Everything above it — postconditions.ts,
// silent-success.ts, health.ts, stage-outcome.ts, circuit-breaker.ts — is the
// real production code, unmodified and unmocked.
//
// THE FAULT VOCABULARY IS THE POINT
// ---------------------------------
// Each member of `RpcFault` below is a shape this codebase has been bitten by or
// is documented as vulnerable to, and each returns the LITERAL response
// supabase-js produces for it. In particular `rls_silent_zero_rows` and
// `rls_silent_void` return `error: null`, because that is the entire problem:
// Postgres RLS denies by matching zero rows, and PostgREST reports zero matched
// rows as a successful request. A fault injector that returned an error for a
// denial would be simulating a database this project does not have, and would
// prove nothing about the failure that has actually shipped here three times.
//
// NOT server-only. Nothing here touches Next.js, Supabase or the network.

/** The ways a call into the database can go wrong, in the bytes it goes wrong in. */
export type RpcFault =
  /** No fault. The configured answer is returned. */
  | { kind: "healthy" }
  /**
   * THE SIGNATURE BUG. A table-returning function or a select the caller is not
   * permitted to read: the statement runs, RLS matches zero rows, and PostgREST
   * returns an empty array with NO ERROR. Byte-for-byte identical to a genuinely
   * empty table. This is the 2026-08 grants incident and the analytics_events
   * DELETE, and it is the shape every other layer here has to survive.
   */
  | { kind: "rls_silent_zero_rows" }
  /**
   * The scalar form of the same thing: a SECURITY DEFINER function the role
   * cannot execute, or one that is `returns void`, answers `data: null,
   * error: null`. Indistinguishable from a successful void call.
   */
  | { kind: "rls_silent_void" }
  /**
   * The third disguise: the function DID run, answered honestly with a
   * documented status the caller never enumerated ('rejected_invalid'), and the
   * caller filed it as benign. Incident #2. No error, real work refused.
   */
  | { kind: "rls_silent_rejected"; status: string }
  /** An outright denial. The easy, honest case — included as the control. */
  | { kind: "permission_denied"; operation: string }
  /**
   * A revoked grant under Supabase makes an object INVISIBLE rather than
   * forbidden, so a permission problem usually arrives as "not found in schema
   * cache". Distinct enough to be worth inducing separately.
   */
  | { kind: "function_missing"; operation: string }
  /** The connection itself dies. supabase-js throws rather than returning. */
  | { kind: "connection_lost" };

/** The shape supabase-js hands back, which is what postconditions.ts consumes. */
export type RpcResponse<T> = { data: T | null; error: { message: string; code?: string } | null };

export type ChaosCall = {
  operation: string;
  args: Record<string, unknown> | undefined;
  fault: RpcFault["kind"];
  response: RpcResponse<unknown> | { threw: string };
};

export type ChaosClient = {
  /** Structurally what `supabase.rpc(name, args)` is, for the callers below. */
  rpc<T = unknown>(operation: string, args?: Record<string, unknown>): Promise<RpcResponse<T>>;
  /** Break one named RPC. Every other RPC keeps working — a partial outage. */
  breakRpc(operation: string, fault: RpcFault): void;
  /** Break everything. A whole-database outage. */
  breakAll(fault: RpcFault): void;
  /** Restore normal service, so a test can prove the halt LIFTS as well as lands. */
  heal(): void;
  /** Every call made, with the fault applied and the exact bytes returned. */
  readonly calls: readonly ChaosCall[];
};

/**
 * Build a fake database.
 *
 * `healthyAnswers` is what each RPC returns when nothing is broken — the
 * happy-path bytes, so a scenario can establish a working baseline before the
 * fault is induced. A proof that never observed the healthy case cannot claim
 * the halt was caused by the fault.
 */
export function createChaosClient(healthyAnswers: Record<string, unknown> = {}): ChaosClient {
  const calls: ChaosCall[] = [];
  const perRpc = new Map<string, RpcFault>();
  let global: RpcFault = { kind: "healthy" };

  function faultFor(operation: string): RpcFault {
    return perRpc.get(operation) ?? global;
  }

  return {
    calls,

    breakRpc(operation, fault) {
      perRpc.set(operation, fault);
    },

    breakAll(fault) {
      global = fault;
      perRpc.clear();
    },

    heal() {
      global = { kind: "healthy" };
      perRpc.clear();
    },

    async rpc<T>(operation: string, args?: Record<string, unknown>): Promise<RpcResponse<T>> {
      const fault = faultFor(operation);

      const record = (response: RpcResponse<unknown> | { threw: string }) => {
        calls.push({ operation, args, fault: fault.kind, response });
      };

      switch (fault.kind) {
        case "healthy": {
          const data = (healthyAnswers[operation] ?? null) as T | null;
          const response = { data, error: null };
          record(response);
          return response;
        }

        case "rls_silent_zero_rows": {
          // An empty ROW SET with no error. Not null — that distinction is
          // load-bearing in guard.ts, which reads a null from a table-returning
          // function as "the function is not there" and an [] as "no rows".
          const response = { data: [] as unknown as T, error: null };
          record(response);
          return response;
        }

        case "rls_silent_void": {
          const response = { data: null, error: null };
          record(response);
          return response;
        }

        case "rls_silent_rejected": {
          const response = { data: fault.status as unknown as T, error: null };
          record(response);
          return response;
        }

        case "permission_denied": {
          const response = {
            data: null,
            error: { message: `permission denied for function ${fault.operation}`, code: "42501" },
          };
          record(response);
          return response;
        }

        case "function_missing": {
          const response = {
            data: null,
            error: {
              message: `Could not find the function public.${fault.operation} in the schema cache`,
              code: "PGRST202",
            },
          };
          record(response);
          return response;
        }

        case "connection_lost": {
          record({ threw: "TypeError: fetch failed" });
          throw new TypeError("fetch failed");
        }
      }
    },
  };
}
