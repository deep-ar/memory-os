import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  memoryApi,
  type ClaimExplanation,
  type ClaimMapNode,
  type ClaimSummary,
  type ConceptMapNode,
  type ContextCatalog,
  type ContextGraph,
  type HistoryEvent,
  type KnowledgeMapEdge,
  type PotentialConflict,
  type ProjectOverview,
  type SearchResult,
} from "./api.js";
import { KnowledgeGraphCanvas, type GraphSelection } from "./KnowledgeGraphCanvas.js";

type WorkspaceMode = "map" | "search";

function displayDate(value: string | null): string {
  if (value === null) return "not bounded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

function Stat({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  return <div className={`stat${attention && value > 0 ? " stat--attention" : ""}`}><strong>{value}</strong><span>{label}</span></div>;
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

function ConceptDetail({ concept, graph, onClaim }: {
  readonly concept: ConceptMapNode;
  readonly graph: ContextGraph;
  readonly onClaim: (claim: ClaimMapNode) => void;
}) {
  const claims = graph.nodes.filter((node): node is ClaimMapNode => node.kind === "claim"
    && (node.subjectId === concept.id || node.objectId === concept.id));
  return <div className="detail">
    <section className="claim-hero">
      <div className="section-heading"><span>◆</span><div><p>Concept</p><h2>{concept.canonicalName}</h2></div></div>
      <div className="hero-badges"><Badge>{concept.conceptType}</Badge><Badge>{concept.priority}</Badge>{concept.boundary && <Badge tone="warn">boundary</Badge>}</div>
      {concept.description && <p className="detail-copy">{concept.description}</p>}
      <dl className="facts"><dt>ID</dt><dd><code>{concept.id}</code></dd><dt>Local degree</dt><dd>{concept.localDegree}</dd><dt>Aliases</dt><dd>{concept.aliases.join(", ") || "—"}</dd></dl>
    </section>
    <section className="detail-section">
      <div className="section-heading"><span>↳</span><div><p>Semantic neighbourhood</p><h2>Related Claims</h2></div></div>
      {claims.length === 0 ? <p className="quiet">This Context links the Concept directly, but no visible Claim uses it.</p>
        : <div className="claim-list compact">{claims.map((claim) => <button className="claim-row" type="button" key={claim.id} onClick={() => onClaim(claim)}>
          <span className="claim-row__statement">{claim.statement}</span><span className="claim-row__meta"><Badge>{claim.predicate}</Badge><span>{claim.priority}</span></span>
        </button>)}</div>}
    </section>
  </div>;
}

function EdgeDetail({ edge, graph }: { readonly edge: KnowledgeMapEdge; readonly graph: ContextGraph }) {
  const source = graph.nodes.find((node) => node.id === edge.source);
  const target = graph.nodes.find((node) => node.id === edge.target);
  const label = (node: typeof source) => node === undefined ? "Unknown" : node.kind === "concept" ? node.canonicalName : node.statement;
  return <div className="detail">
    <section className="claim-hero">
      <div className="section-heading"><span>→</span><div><p>Memory relation</p><h2>{edge.relation}</h2></div></div>
      <div className="hero-badges"><Badge>{edge.kind.replaceAll("_", " ")}</Badge>{edge.boundary && <Badge tone="warn">cross-context</Badge>}</div>
      <dl className="relation-path"><div><dt>Source</dt><dd>{label(source)}</dd><code>{edge.source}</code></div><span>→</span><div><dt>Target</dt><dd>{label(target)}</dd><code>{edge.target}</code></div></dl>
      <p className="notice">Direction is preserved exactly as stored in MemoryOS.</p>
    </section>
  </div>;
}

function ContextPicker({ catalog, selected, onSelect }: {
  readonly catalog: ContextCatalog;
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
}) {
  return <section className="context-section">
    <div className="context-section__head"><div><p>Context lens</p><h2>Browse memory without Search</h2></div><span>{catalog.contexts.length} contexts · {catalog.unscopedClaims} unscoped</span></div>
    {catalog.contexts.length === 0 ? <Empty title="No Contexts recorded">Claims can still be found through Search. Add explicit Contexts during reflection to make the map browsable.</Empty>
      : <div className="context-strip">{catalog.contexts.map((context) => <button
        type="button" key={context.id} onClick={() => onSelect(context.id)}
        className={selected === context.id ? "active" : ""}
      >
        <strong>{context.name}</strong><span>{context.health.claims} Claims · {context.health.concepts} Concepts</span>
        <small>{context.health.withoutEvidence + context.health.disputed + context.health.tentative} review signals</small>
      </button>)}</div>}
  </section>;
}

function HealthStrip({ graph }: { readonly graph: ContextGraph }) {
  const health = graph.health;
  return <div className="health-strip">
    <Stat label="Claims" value={health.claims}/><Stat label="Concepts" value={health.concepts}/><Stat label="Relations" value={health.relations}/><Stat label="Recent" value={health.recent}/>
    <Stat label="No Evidence" value={health.withoutEvidence} attention/><Stat label="Disputed" value={health.disputed} attention/><Stat label="Components" value={health.components} attention={health.components > 1}/><Stat label="Isolated" value={health.isolatedConcepts} attention/>
  </div>;
}

export function App() {
  const initial = useMemo(() => new URLSearchParams(window.location.search), []);
  const [projects, setProjects] = useState<readonly ProjectOverview[]>([]);
  const [projectId, setProjectId] = useState<string | null>(initial.get("project"));
  const [mode, setMode] = useState<WorkspaceMode>(initial.get("mode") === "search" ? "search" : "map");
  const [catalog, setCatalog] = useState<ContextCatalog | null>(null);
  const [contextId, setContextId] = useState<string | null>(initial.get("context"));
  const [graph, setGraph] = useState<ContextGraph | null>(null);
  const [includeBoundary, setIncludeBoundary] = useState(true);
  const [includeUnscoped, setIncludeUnscoped] = useState(false);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [graphLimit, setGraphLimit] = useState(100);
  const [graphSelection, setGraphSelection] = useState<GraphSelection | null>(null);
  const [query, setQuery] = useState("MemoryOS agent tools");
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(initial.get("claim"));
  const [explanation, setExplanation] = useState<ClaimExplanation | null>(null);
  const [conflicts, setConflicts] = useState<readonly PotentialConflict[]>([]);
  const [history, setHistory] = useState<readonly HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapLoading, setMapLoading] = useState(false);
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
    let active = true;
    setCatalog(null); setGraph(null); setGraphSelection(null); setMapLoading(true);
    memoryApi.contexts(projectId).then((nextCatalog) => {
      if (!active) return;
      setCatalog(nextCatalog);
      setContextId((current) => current && nextCatalog.contexts.some((context) => context.id === current)
        ? current : nextCatalog.contexts[0]?.id ?? null);
    }).catch((reason: Error) => active && setError(reason.message)).finally(() => active && setMapLoading(false));
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    if (projectId === null || contextId === null || mode !== "map") return;
    let active = true;
    setMapLoading(true); setError(null);
    memoryApi.contextGraph(projectId, contextId, {
      includeBoundary, includeUnscoped, includeHistory, limit: graphLimit,
    }).then((nextGraph) => {
      if (!active) return;
      setGraph(nextGraph);
      setGraphSelection((current) => current?.kind === "node" && nextGraph.nodes.some((node) => node.id === current.node.id)
        ? current : null);
    }).catch((reason: Error) => active && setError(reason.message)).finally(() => active && setMapLoading(false));
    return () => { active = false; };
  }, [projectId, contextId, mode, includeBoundary, includeUnscoped, includeHistory, graphLimit]);

  useEffect(() => {
    if (projectId === null) return;
    const url = new URL(window.location.href);
    url.searchParams.set("project", projectId);
    url.searchParams.set("mode", mode);
    if (contextId) url.searchParams.set("context", contextId); else url.searchParams.delete("context");
    if (selectedClaimId) url.searchParams.set("claim", selectedClaimId); else url.searchParams.delete("claim");
    window.history.replaceState(null, "", url);
  }, [projectId, contextId, mode, selectedClaimId]);

  useEffect(() => {
    if (projectId === null || selectedClaimId === null) {
      setExplanation(null); setConflicts([]); setHistory([]); setDetailLoading(false); return;
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
    setLoading(true); setError(null); setGraphSelection(null);
    try {
      const result = await memoryApi.search(projectId, query.trim());
      setSearch(result);
      const stillPresent = result.claims.some((claim) => claim.id === selectedClaimId);
      if (!stillPresent) setSelectedClaimId(result.claims[0]?.id ?? null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }

  function chooseProject(next: string) {
    setProjectId(next); setCatalog(null); setContextId(null); setGraph(null); setSearch(null);
    setSelectedClaimId(null); setExplanation(null); setGraphSelection(null); setError(null); setGraphLimit(100);
  }

  function chooseContext(next: string) {
    if (next === contextId) return;
    setContextId(next); setGraph(null); setGraphSelection(null); setSelectedClaimId(null); setGraphLimit(100);
  }

  const chooseClaim = useCallback((claim: ClaimMapNode | ClaimSummary) => {
    setSelectedClaimId(claim.id);
  }, []);

  const handleGraphSelection = useCallback((selection: GraphSelection) => {
    setGraphSelection(selection);
    setSelectedClaimId(selection.kind === "node" && selection.node.kind === "claim" ? selection.node.id : null);
  }, []);

  const mapInspector = (() => {
    if (detailLoading) return <div className="loading-panel">Tracing Evidence and history…</div>;
    if (selectedClaimId !== null && explanation !== null) return <ClaimDetail explanation={explanation} conflicts={conflicts} history={history}/>;
    if (graph !== null && graphSelection?.kind === "node" && graphSelection.node.kind === "concept") {
      return <ConceptDetail concept={graphSelection.node} graph={graph} onClaim={chooseClaim}/>;
    }
    if (graph !== null && graphSelection?.kind === "edge") return <EdgeDetail edge={graphSelection.edge} graph={graph}/>;
    return <Empty title="Inspect the memory web">Select a Concept, Claim, or relation. Evidence and provenance stay in this panel instead of becoming canvas noise.</Empty>;
  })();

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
          <div className="stats"><Stat label="Concepts" value={selectedProject.counts.concepts}/><Stat label="Claims" value={selectedProject.counts.claims}/><Stat label="Evidence" value={selectedProject.counts.evidence}/><Stat label="Contexts" value={selectedProject.counts.contexts}/></div>
        </section>
        <div className="mode-tabs" role="tablist" aria-label="Explorer mode">
          <button type="button" role="tab" aria-selected={mode === "map"} className={mode === "map" ? "active" : ""} onClick={() => setMode("map")}>Context map</button>
          <button type="button" role="tab" aria-selected={mode === "search"} className={mode === "search" ? "active" : ""} onClick={() => setMode("search")}>Search</button>
        </div>
        {mode === "map" ? <>
          {catalog ? <ContextPicker catalog={catalog} selected={contextId} onSelect={chooseContext}/>
            : <div className="loading-panel">Loading Contexts…</div>}
          {contextId !== null && <div className="map-toolbar">
            <label><input type="checkbox" checked={includeBoundary} onChange={(event) => setIncludeBoundary(event.target.checked)}/> Boundary</label>
            <label><input type="checkbox" checked={includeUnscoped} onChange={(event) => setIncludeUnscoped(event.target.checked)}/> Unscoped</label>
            <label><input type="checkbox" checked={includeHistory} onChange={(event) => setIncludeHistory(event.target.checked)}/> History</label>
            <span className="map-toolbar__legend"><i className="legend-dot legend-dot--review"/> review <i className="legend-dot legend-dot--backbone"/> backbone <i className="legend-dot legend-dot--boundary"/> boundary</span>
            {graph?.truncated && <button type="button" onClick={() => setGraphLimit(Math.min(graph.totalPrimaryClaims, 1_000))}>Show all {Math.min(graph.totalPrimaryClaims, 1_000)}</button>}
          </div>}
          {graph && <HealthStrip graph={graph}/>}
          <div className="map-workspace">
            <section className="map-panel">
              {mapLoading ? <div className="loading-panel">Building semantic map…</div>
                : graph && graph.nodes.length > 0 ? <>
                  <div className="map-panel__head"><div><p>{graph.context.name}</p><strong>{graph.includedPrimaryClaims} of {graph.totalPrimaryClaims} primary Claims</strong></div><small>{graph.nodes.length} nodes · {graph.edges.length} links</small></div>
                  <KnowledgeGraphCanvas graph={graph} onSelect={handleGraphSelection}/>
                </> : <Empty title="No visible knowledge">This Context has no Claims for the selected layers.</Empty>}
            </section>
            <section className="inspector map-inspector">{mapInspector}</section>
          </div>
        </> : <>
          <form className="search" onSubmit={submitSearch}><span>⌕</span><input aria-label="Search project memory" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search claims, evidence, concepts…"/><button disabled={loading}>{loading ? "Searching…" : "Search memory"}</button></form>
          <div className="workspace">
            <section className="results"><div className="results__head"><div><p>Retrieved Claims</p><strong>{search?.claims.length ?? 0}</strong></div>{search && <small>{search.rankingMetadata.algorithm} · {search.rankingMetadata.channels.join(" + ")}</small>}</div>
              {search ? <ClaimList claims={search.claims} selected={selectedClaimId} onSelect={chooseClaim}/>
                : <Empty title="Search project memory">Use task language, a symbol, an error, or a decision. Results combine semantic, full-text, and graph signals.</Empty>}
            </section>
            <section className="inspector">{detailLoading ? <div className="loading-panel">Tracing Evidence and history…</div>
              : explanation ? <ClaimDetail explanation={explanation} conflicts={conflicts} history={history}/>
              : <Empty title="Select a Claim">Open a search result to inspect its epistemic state, Evidence, provenance, conflicts, and immutable history.</Empty>}</section>
          </div>
        </>}
      </> : loading ? <div className="loading-panel">Loading projects…</div> : <Empty title="No projects registered">Run <code>memoryos project init --project-id …</code> to create an explicit logical project.</Empty>}
    </main>
  </div>;
}
