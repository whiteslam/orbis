// Starting the worker: one workflow_dispatch on the PRIVATE repo that holds the
// worker's workflow and its secrets (the app repo is public, and so are its
// Actions logs). The token is fine-grained, with Actions: write on that one
// repo and nothing else. Pure apart from the injected fetch.

export type DispatchConfig = { token: string; repo: string; workflow: string; ref: string };

export type DispatchInput = { mode: 'run' | 'settle'; runIds: string[]; userId?: string };

export type DispatchResult = { ok: true } | { ok: false; reason: 'not_configured' | 'rejected' | 'unreachable' };

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const WORKFLOW = /^[A-Za-z0-9_.-]{1,100}\.ya?ml$/;
const REF = /^[A-Za-z0-9_./-]{1,200}$/;
const TIMEOUT_MS = 10_000;

/** The worker's address from the environment, or null while it isn't set up. */
export function dispatchConfig(env: Record<string, string | undefined> = process.env): DispatchConfig | null {
  const token = env.ORBIS_RESEARCH_GITHUB_TOKEN?.trim();
  const repo = env.ORBIS_RESEARCH_GITHUB_REPO?.trim();
  const workflow = env.ORBIS_RESEARCH_WORKFLOW?.trim() || 'research-desk.yml';
  const ref = env.ORBIS_RESEARCH_GITHUB_REF?.trim() || 'main';
  if (!token || !repo || !REPO.test(repo) || !WORKFLOW.test(workflow) || !REF.test(ref)) return null;
  return { token, repo, workflow, ref };
}

async function attempt(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<'ok' | 'rejected' | 'retry'> {
  try {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    // 204 No Content, or 200 when GitHub returns the run's details.
    if (response.status === 204 || response.status === 200) return 'ok';
    return response.status >= 500 ? 'retry' : 'rejected';
  } catch {
    return 'retry';
  }
}

/**
 * Starts one workflow run for these research runs. A 5xx or a dropped
 * connection is tried once more; a 4xx (bad token, wrong repo, workflow not
 * found) is not, since trying again would only fail again.
 */
export async function dispatchRuns(input: DispatchInput, deps: { config: DispatchConfig | null; fetch?: typeof fetch }): Promise<DispatchResult> {
  const { config } = deps;
  if (!config) return { ok: false, reason: 'not_configured' };
  const fetchImpl = deps.fetch ?? fetch;
  const url = `https://api.github.com/repos/${config.repo}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`;
  const init: RequestInit = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    // workflow_dispatch inputs are strings.
    body: JSON.stringify({ ref: config.ref, inputs: { mode: input.mode, run_ids: input.runIds.join(','), user_id: input.userId ?? '' } }),
    cache: 'no-store',
  };
  let outcome = await attempt(url, init, fetchImpl);
  if (outcome === 'retry') outcome = await attempt(url, init, fetchImpl);
  if (outcome === 'ok') return { ok: true };
  return { ok: false, reason: outcome === 'rejected' ? 'rejected' : 'unreachable' };
}
