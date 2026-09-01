import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  memoryApi,
  type ClaimExplanation,
  type ClaimSummary,
  type HistoryEvent,
  type PotentialConflict,
  type ProjectOverview,
  type SearchResult,
} from "./api.js";

function displayDate(value: string | null): string {
  if (value === null) return "not bounded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="stat"><strong>{value}</strong><span>{label}</span></div>;
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="empty"><div className="empty__mark">◇</div><h3>{title}</h3><p>{children}</p></div>;
}

function ClaimList({ claims, selected, onSelect }: {
  claims: readonly ClaimSummary[];
  selected: string | null;
  onSelect: (claim: ClaimSummary) => void;
}) {
  if (claims.length === 0) return <Empty title="No matching Claims">Try a broader phrase or inspect another project.</Empty>;
  return <div className="claim-list">
    {claims.map((claim) => <button
      type="button"
      className={`claim-row${selected === claim.id ? " claim-row--selected" : ""}`}
      key={claim.id}
      onClick={() => onSelect(claim)}
    >
      <span className="claim-row__statement">{claim.statement}</span>
      <span className="claim-row__meta">
        <Badge tone={claim.lifecycleStatus === "active" ? "good" : "warn"}>{claim.lifecycleStatus}</Badge>
        <span>{claim.predicate}</span><span>{claim.confidenceLevel}</span>
      </span>
    </button>)}
  </div>;
}

function EvidencePanel({ explanation }: { explanation: ClaimExplanation }) {
  const evidence = explanation.supportingEvidence;
  return <section className="detail-section" data-testid="belief-panel">
    <div className="section-heading"><span>02</span><div><p>Evidence chain</p><h2>WHY DO WE BELIEVE THIS?</h2></div></div>
    {evidence.length === 0
      ? <Empty title="No supporting Evidence">This Claim currently has no linked Evidence. Treat it according to its epistemic state.</Empty>
      : <div className="evidence-grid">{evidence.map((item) => <article className="evidence-card" key={item.id}>
          <div className="evidence-card__top"><Badge>{item.type}</Badge><code>{item.id}</code></div>
          <h3>{item.summary}</h3>
          {item.content && <p className="evidence-card__content">{item.content}</p>}
          {(item.command || item.result) && <div className="terminal-block">
            {item.command && <code>$ {item.command}</code>}
            {item.result && <pre>{item.result}</pre>}
          </div>}
          <dl className="facts">
            {item.file && <><dt>Source</dt><dd>{item.file}{item.lineStart ? `:${item.lineStart}` : ""}</dd></>}
            {item.commit && <><dt>Commit</dt><dd><code>{item.commit}</code></dd></>}
            {item.sourceUri && <><dt>URI</dt><dd>{item.sourceUri}</dd></>}
            {item.contentHash && <><dt>Hash</dt><dd><code>{item.contentHash.slice(0, 16)}…</code></dd></>}
          </dl>
        </article>)}</div>}
  </section>;
}

function ConflictPanel({ conflicts }: { conflicts: readonly PotentialConflict[] }) {
  return <section className="detail-section">
    <div className="section-heading"><span>03</span><div><p>Review queue</p><h2>Potential conflicts</h2></div></div>
    {conflicts.length === 0 ? <p className="quiet">No structural or semantic conflict candidates were found.</p>
      : <div className="conflict-list">{conflicts.map((conflict) => <article key={conflict.claimId}>
        <div><strong>{conflict.claimId}</strong><p>{conflict.conflictReason.replaceAll("_", " ")}</p></div>
        <span>{Math.round(conflict.similarity * 100)}%</span>
      </article>)}</div>}
    <p className="notice">Candidates are signals for agent or human review. MemoryOS never resolves them automatically.</p>
  </section>;
}

function HistoryPanel({ events }: { events: readonly HistoryEvent[] }) {
  return <section className="detail-section">
    <div className="section-heading"><span>04</span><div><p>Immutable journal</p><h2>Reflection history</h2></div></div>
    {events.length === 0 ? <p className="quiet">No Reflection Events are linked to this Claim.</p>
      : <ol className="timeline">{events.map((event) => <li key={event.id}>
        <time>{displayDate(event.createdAt)}</time><strong>{event.trigger.replaceAll("_", " ")}</strong>
        <p>{event.operations.map((operation) => `${operation.type} ${operation.entityId}`).join(" · ")}</p>
        <code>{event.id}</code>
      </li>)}</ol>}
  </section>;
}

function ClaimDetail({ explanation, conflicts, history }: {
  explanation: ClaimExplanation;
  conflicts: readonly PotentialConflict[];
  history: readonly HistoryEvent[];
}) {
  const claim = explanation.claim;
  return <div className="detail">
    <section className="claim-hero">
      <div className="section-heading"><span>01</span><div><p>Claim</p><h2>{claim.statement}</h2></div></div>
      <div className="hero-badges">
        <Badge tone={claim.lifecycleStatus === "active" ? "good" : "warn"}>{claim.lifecycleStatus}</Badge>
        <Badge>{claim.epistemicBasis}</Badge><Badge>{claim.confidenceLevel}</Badge>
      </div>
      <dl className="claim-path"><div><dt>Subject</dt><dd>{claim.subjectId}</dd></div><div><dt>Predicate</dt><dd>{claim.predicate}</dd></div><div><dt>Object</dt><dd>{claim.objectId ?? "—"}</dd></div></dl>
      <div className="validity"><span>Valid from {displayDate(claim.validFrom)}</span><span>Valid to {displayDate(claim.validTo)}</span><span>Revision {claim.revision}</span></div>
    </section>
    <EvidencePanel explanation={explanation} />
    <section className="detail-section provenance">
      <div className="section-heading"><span>↳</span><div><p>Origin</p><h2>Provenance</h2></div></div>
      <dl className="facts facts--wide">{Object.entries(explanation.provenance).filter(([, value]) => value).map(([key, value]) => <div key={key}><dt>{key}</dt><dd><code>{value}</code></dd></div>)}</dl>
    </section>
    <ConflictPanel conflicts={conflicts} />
    <HistoryPanel events={history.length > 0 ? history : explanation.reflectionHistory} />
  </div>;
}

export function App() {
  const initial = useMemo(() => new URLSearchParams(window.location.search), []);
  const [projects, setProjects] = useState<readonly ProjectOverview[]>([]);
  const [projectId, setProjectId] = useState<string | null>(initial.get("project"));
  const [query, setQuery] = useState("MemoryOS agent tools");
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(initial.get("claim"));
  const [explanation, setExplanation] = useState<ClaimExplanation | null>(null);
  const [conflicts, setConflicts] = useState<readonly PotentialConflict[]>([]);
  const [history, setHistory] = useState<readonly HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProject = projects.find((item) => item.project.id === projectId) ?? null;

  useEffect(() => {
    let active = true;
    memoryApi.projects().then((items) => {
      if (!active) return;
      setProjects(items);
      setProjectId((current) => current && items.some((item) => item.project.id === current)
        ? current : items[0]?.project.id ?? null);
    }).catch((reason: Error) => active && setError(reason.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (projectId === null) return;
    const url = new URL(window.location.href);
    url.searchParams.set("project", projectId);
    if (selectedClaimId) url.searchParams.set("claim", selectedClaimId); else url.searchParams.delete("claim");
    window.history.replaceState(null, "", url);
  }, [projectId, selectedClaimId]);

  useEffect(() => {
    if (projectId === null || selectedClaimId === null) {
      setExplanation(null); setConflicts([]); setHistory([]); return;
    }
    let active = true;
    setDetailLoading(true);
    Promise.all([
      memoryApi.explanation(projectId, selectedClaimId),
      memoryApi.conflicts(projectId, selectedClaimId),
      memoryApi.history(projectId, selectedClaimId),
    ]).then(([nextExplanation, nextConflicts, nextHistory]) => {
      if (!active) return;
      setExplanation(nextExplanation); setConflicts(nextConflicts); setHistory(nextHistory);
    }).catch((reason: Error) => active && setError(reason.message)).finally(() => active && setDetailLoading(false));
    return () => { active = false; };
  }, [projectId, selectedClaimId]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (projectId === null || query.trim() === "") return;
    setLoading(true); setError(null);
    try {
      const result = await memoryApi.search(projectId, query.trim());
      setSearch(result);
      const stillPresent = result.claims.some((claim) => claim.id === selectedClaimId);
      if (!stillPresent) setSelectedClaimId(result.claims[0]?.id ?? null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }

  function chooseProject(next: string) {
    setProjectId(next); setSearch(null); setSelectedClaimId(null); setExplanation(null); setError(null);
  }

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand__mark">M</div><div><strong>MemoryOS</strong><span>Knowledge explorer</span></div></div>
      <p className="sidebar-label">Logical projects</p>
      <nav>{projects.map((item) => <button type="button" key={item.project.id} onClick={() => chooseProject(item.project.id)} className={item.project.id === projectId ? "active" : ""}>
        <span>{item.project.name}</span><small>r{item.project.revision}</small>
      </button>)}</nav>
      <div className="sidebar-footer"><span className="live-dot" /> local service ready</div>
    </aside>
    <main>
      <header className="topbar"><div><p>INSPECTION WORKSPACE</p><h1>{selectedProject?.project.name ?? "MemoryOS"}</h1></div><div className="revision">Project revision <strong>{selectedProject?.project.revision ?? "—"}</strong></div></header>
      {error && <div className="error-banner"><strong>Request failed</strong><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
      {selectedProject ? <>
        <section className="overview">
          <div className="overview__copy"><p>{selectedProject.project.description ?? "Structured, evidence-backed project memory."}</p><code>{selectedProject.project.id}</code></div>
          <div className="stats"><Stat label="Concepts" value={selectedProject.counts.concepts}/><Stat label="Claims" value={selectedProject.counts.claims}/><Stat label="Evidence" value={selectedProject.counts.evidence}/><Stat label="Events" value={selectedProject.counts.reflectionEvents}/></div>
        </section>
        <form className="search" onSubmit={submitSearch}><span>⌕</span><input aria-label="Search project memory" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search claims, evidence, concepts…"/><button disabled={loading}>{loading ? "Searching…" : "Search memory"}</button></form>
        <div className="workspace">
          <section className="results"><div className="results__head"><div><p>Retrieved Claims</p><strong>{search?.claims.length ?? 0}</strong></div>{search && <small>{search.rankingMetadata.algorithm} · {search.rankingMetadata.channels.join(" + ")}</small>}</div>
            {search ? <ClaimList claims={search.claims} selected={selectedClaimId} onSelect={(claim) => setSelectedClaimId(claim.id)}/>
              : <Empty title="Search project memory">Use task language, a symbol, an error, or a decision. Results combine semantic, full-text, and graph signals.</Empty>}
          </section>
          <section className="inspector">{detailLoading ? <div className="loading-panel">Tracing evidence and history…</div>
            : explanation ? <ClaimDetail explanation={explanation} conflicts={conflicts} history={history}/>
            : <Empty title="Select a Claim">Open a search result to inspect its epistemic state, Evidence, provenance, conflicts, and immutable history.</Empty>}</section>
        </div>
      </> : loading ? <div className="loading-panel">Loading projects…</div> : <Empty title="No projects registered">Run <code>memoryos project init --project-id …</code> to create an explicit logical project.</Empty>}
    </main>
  </div>;
}
