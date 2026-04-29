import type { CompiledModule, Diagnostic } from "@omriashke/dynamico-core";

export interface AuthFlags {
  token?: string;
  user?: string;
  password?: string;
}

export interface ClientOptions extends AuthFlags {
  registry: string;
}

/** Build common HTTP headers including auth, if provided. */
function authHeaders(opts: AuthFlags): Record<string, string> {
  const h: Record<string, string> = {};
  if (opts.token) {
    h["authorization"] = `Bearer ${opts.token}`;
  } else if (opts.user && opts.password) {
    const encoded = Buffer.from(`${opts.user}:${opts.password}`).toString("base64");
    h["authorization"] = `Basic ${encoded}`;
  }
  return h;
}

export interface UploadResponse {
  dryRun: boolean;
  /** Single-component shape (compiled is spread at the top level). */
  name?: string;
  version?: string;
  code?: string;
  warnings?: Diagnostic[];
  error?: { kind: string; message: string; diagnostics?: Diagnostic[] };
  /** Bulk shape. */
  results?: CompiledModule[];
}

export async function upload(
  opts: ClientOptions,
  body:
    | { name: string; source: string; description?: string }
    | { components: Array<{ name: string; source: string; description?: string }> },
  dryRun: boolean,
): Promise<{ status: number; data: UploadResponse }> {
  const url = `${opts.registry.replace(/\/$/, "")}/upload${dryRun ? "?dryRun=true" : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(opts) },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as UploadResponse;
  return { status: res.status, data };
}

export type ListedComponent = Omit<CompiledModule, "code"> & { description?: string };

export async function listComponents(opts: ClientOptions): Promise<{
  status: number;
  data: ListedComponent[];
}> {
  const res = await fetch(`${opts.registry.replace(/\/$/, "")}/components`, {
    headers: authHeaders(opts),
  });
  const data = (await res.json()) as ListedComponent[];
  return { status: res.status, data };
}

export interface SourceResponse {
  name: string;
  path: string;
  source: string;
  description: string;
  version: string;
}

export async function getSource(
  opts: ClientOptions,
  name: string,
): Promise<{ status: number; data: SourceResponse | { error: string } }> {
  const res = await fetch(
    `${opts.registry.replace(/\/$/, "")}/component/${encodeURIComponent(name)}/source`,
    { headers: authHeaders(opts) },
  );
  const data = (await res.json()) as SourceResponse | { error: string };
  return { status: res.status, data };
}

export interface SearchHit {
  name: string;
  description: string;
  score: number;
}

export async function search(
  opts: ClientOptions,
  query: string,
): Promise<{ status: number; data: { query: string; hits: SearchHit[] } | { error: string } }> {
  const url = `${opts.registry.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: authHeaders(opts) });
  const data = (await res.json()) as { query: string; hits: SearchHit[] } | { error: string };
  return { status: res.status, data };
}

export async function getComponent(opts: ClientOptions, name: string): Promise<{
  status: number;
  data: CompiledModule | { error: string };
}> {
  const res = await fetch(`${opts.registry.replace(/\/$/, "")}/component/${encodeURIComponent(name)}`, {
    headers: authHeaders(opts),
  });
  const data = (await res.json()) as CompiledModule | { error: string };
  return { status: res.status, data };
}

export async function deleteComponent(opts: ClientOptions, name: string): Promise<{
  status: number;
  data: { ok?: boolean; name?: string; error?: string };
}> {
  const res = await fetch(`${opts.registry.replace(/\/$/, "")}/component/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: authHeaders(opts),
  });
  const data = (await res.json()) as { ok?: boolean; name?: string; error?: string };
  return { status: res.status, data };
}

export interface PatchMetaResponse {
  ok?: boolean;
  name?: string;
  path?: string;
  description?: string;
  error?: string;
}

export async function patchMeta(
  opts: ClientOptions,
  name: string,
  patch: { description?: string },
): Promise<{ status: number; data: PatchMetaResponse }> {
  const res = await fetch(
    `${opts.registry.replace(/\/$/, "")}/component/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authHeaders(opts) },
      body: JSON.stringify(patch),
    },
  );
  const data = (await res.json()) as PatchMetaResponse;
  return { status: res.status, data };
}

export interface ManifestShape {
  version: 1;
  components: Record<string, { path: string; description: string }>;
}

export interface ReplaceConfigResponse {
  ok?: boolean;
  added?: string[];
  removed?: string[];
  changed?: string[];
  error?: string;
  diagnostics?: string[];
}

export async function replaceConfig(
  opts: ClientOptions,
  body: ManifestShape,
): Promise<{ status: number; data: ReplaceConfigResponse }> {
  const res = await fetch(`${opts.registry.replace(/\/$/, "")}/config`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...authHeaders(opts) },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as ReplaceConfigResponse;
  return { status: res.status, data };
}
