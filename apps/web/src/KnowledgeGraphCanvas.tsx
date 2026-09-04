import type { Core, ElementDefinition, StylesheetJson } from "cytoscape";
import { useEffect, useId, useRef } from "react";
import type { ContextGraph, KnowledgeMapEdge, KnowledgeMapNode } from "./api.js";

export type GraphSelection =
  | { readonly kind: "node"; readonly node: KnowledgeMapNode }
  | { readonly kind: "edge"; readonly edge: KnowledgeMapEdge };

interface NavigatorHandle {
  destroy(): void;
}

interface CoreWithNavigator extends Core {
  navigator(options: {
    readonly container: string;
    readonly removeCustomContainer: boolean;
    readonly viewLiveFramerate: number;
    readonly thumbnailEventFramerate: number;
    readonly rerenderDelay: number;
  }): NavigatorHandle;
}

let navigatorRegistered = false;

const styles: StylesheetJson = [
  {
    selector: "node",
    style: {
      "background-color": "#18251f",
      "border-color": "#5a7668",
      "border-width": 1,
      color: "#dbe7e0",
      label: "data(label)",
      "font-family": "Inter, system-ui, sans-serif",
      "font-size": 12,
      "text-wrap": "wrap",
      "text-max-width": "130px",
      "text-valign": "center",
      "text-halign": "center",
      width: "data(width)",
      height: "data(height)",
      padding: "8px",
    },
  },
  {
    selector: "node[kind = 'concept']",
    style: {
      shape: "ellipse",
      "background-color": "#173226",
      "border-color": "#69c99b",
      "font-size": 13,
      "font-weight": 600,
    },
  },
  {
    selector: "node[kind = 'claim']",
    style: {
      shape: "round-rectangle",
      "background-color": "#171d1b",
      "border-color": "#52615a",
      "text-max-width": "180px",
    },
  },
  { selector: ".priority-P0", style: { "border-color": "#e0a55d", "border-width": 3 } },
  { selector: ".priority-P1", style: { "border-color": "#75dfa9", "border-width": 2 } },
  { selector: ".priority-P4", style: { opacity: 0.45 } },
  { selector: ".boundary", style: { opacity: 0.45, "border-style": "dashed" } },
  { selector: ":selected", style: { "border-color": "#f4f8f5", "border-width": 4, "overlay-opacity": 0 } },
  {
    selector: "edge",
    style: {
      width: 1.3,
      "line-color": "#40544b",
      "target-arrow-color": "#587165",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      label: "data(label)",
      color: "#718078",
      "font-size": 12,
      "text-background-color": "#0d1210",
      "text-background-opacity": 0.85,
      "text-background-padding": "2px",
      "text-rotation": "autorotate",
    },
  },
  {
    selector: "edge[kind = 'claim_relation']",
    style: { width: 2, "line-color": "#57826d", "target-arrow-color": "#75c99f", color: "#8ab59f" },
  },
  { selector: "edge[relation = 'CONTRADICTS']", style: { "line-color": "#d59a55", "target-arrow-color": "#d59a55", color: "#d8ad78" } },
  { selector: "edge.boundary", style: { "line-style": "dashed", opacity: 0.5 } },
  { selector: ".focus-muted", style: { opacity: 0.12, "text-opacity": 0 } },
  { selector: "node.focus-neighbour", style: { "z-index": 10 } },
  { selector: "edge.focus-neighbour", style: { width: 2.5, opacity: 1, "z-index": 9 } },
];

function nodeLabel(node: KnowledgeMapNode): string {
  if (node.kind === "concept") return node.canonicalName;
  return node.statement.length > 74 ? `${node.statement.slice(0, 71)}…` : node.statement;
}

function elements(graph: ContextGraph): ElementDefinition[] {
  return [
    ...graph.nodes.map((node): ElementDefinition => ({
      group: "nodes",
      data: {
        id: node.id,
        kind: node.kind,
        label: nodeLabel(node),
        width: node.kind === "concept" ? Math.min(96 + node.localDegree * 6, 146) : 230,
        height: node.kind === "concept" ? Math.min(58 + node.localDegree * 3, 84) : 88,
      },
      classes: [`priority-${node.priority}`, ...(node.boundary ? ["boundary"] : [])].join(" "),
    })),
    ...graph.edges.map((edge): ElementDefinition => ({
      group: "edges",
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        relation: edge.relation,
        kind: edge.kind,
        label: edge.kind === "claim_relation" ? edge.relation : "",
      },
      classes: edge.boundary ? "boundary" : "",
    })),
  ];
}

export function KnowledgeGraphCanvas({ graph, selectedNodeId, onSelect }: {
  readonly graph: ContextGraph;
  readonly selectedNodeId: string | null;
  readonly onSelect: (selection: GraphSelection) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const navigatorHost = useRef<HTMLDivElement>(null);
  const core = useRef<Core | null>(null);
  const selectedNodeIdRef = useRef(selectedNodeId);
  const navigatorId = `knowledge-map-navigator-${useId().replaceAll(":", "")}`;
  const showNavigator = graph.nodes.length >= 20;

  function clearFocus(instance: Core) {
    instance.elements().removeClass("focus-muted focus-neighbour");
  }

  function focusNode(instance: Core, id: string, animate: boolean) {
    const node = instance.getElementById(id);
    if (node.empty()) return;
    const neighbourhood = node.closedNeighborhood();
    clearFocus(instance);
    instance.elements().difference(neighbourhood).addClass("focus-muted");
    neighbourhood.addClass("focus-neighbour");
    instance.elements().unselect();
    node.select();
    if (animate) {
      instance.stop(true);
      instance.animate({ fit: { eles: neighbourhood, padding: 76 } }, { duration: 220, easing: "ease-out" });
    }
  }

  function fitAll() {
    const instance = core.current;
    if (instance === null) return;
    clearFocus(instance);
    instance.elements().unselect();
    instance.stop(true);
    instance.animate({ fit: { eles: instance.elements(), padding: 44 } }, { duration: 220, easing: "ease-out" });
  }

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
    if (core.current !== null && selectedNodeId !== null) focusNode(core.current, selectedNodeId, false);
  }, [selectedNodeId]);

  useEffect(() => {
    if (host.current === null) return;
    let disposed = false;
    let instance: Core | null = null;
    let navigator: NavigatorHandle | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    const edgesById = new Map(graph.edges.map((edge) => [edge.id, edge]));
    void Promise.all([
      import("cytoscape"),
      showNavigator ? import("cytoscape-navigator") : Promise.resolve(null),
    ]).then(([{ default: cytoscape }, navigatorModule]) => {
      if (disposed || host.current === null) return;
      if (navigatorModule !== null && !navigatorRegistered) {
        navigatorModule.default(cytoscape);
        navigatorRegistered = true;
      }
      instance = cytoscape({
        container: host.current,
        elements: elements(graph),
        style: styles,
        minZoom: 0.15,
        maxZoom: 2.5,
        layout: {
          name: "cose",
          animate: false,
          randomize: false,
          fit: true,
          padding: 36,
          nodeRepulsion: () => 650_000,
          idealEdgeLength: () => 130,
        },
      });
      core.current = instance;
      if (showNavigator && navigatorHost.current !== null) {
        navigator = (instance as CoreWithNavigator).navigator({
          container: `#${navigatorId}`,
          removeCustomContainer: false,
          viewLiveFramerate: 0,
          thumbnailEventFramerate: 20,
          rerenderDelay: 120,
        });
      }
      resizeObserver = new ResizeObserver(() => instance?.resize());
      resizeObserver.observe(host.current);
      instance.on("tap", "node", (event) => {
        const node = nodesById.get(event.target.id());
        if (node !== undefined) {
          focusNode(instance!, node.id, false);
          onSelect({ kind: "node", node });
        }
      });
      instance.on("tap", "edge", (event) => {
        const edge = edgesById.get(event.target.id());
        if (edge !== undefined) onSelect({ kind: "edge", edge });
      });
      instance.on("tap", (event) => {
        if (event.target !== instance) return;
        clearFocus(instance!);
        instance!.elements().unselect();
      });
      instance.on("dblclick", "node", (event) => {
        focusNode(instance!, event.target.id(), true);
      });
      if (selectedNodeIdRef.current !== null) focusNode(instance, selectedNodeIdRef.current, true);
    });
    return () => {
      disposed = true;
      core.current = null;
      resizeObserver?.disconnect();
      navigator?.destroy();
      instance?.destroy();
    };
  }, [graph, navigatorId, onSelect, showNavigator]);

  function chooseNode(id: string) {
    const node = graph.nodes.find((item) => item.id === id);
    if (node === undefined) return;
    if (core.current !== null) focusNode(core.current, id, true);
    onSelect({ kind: "node", node });
  }

  return <div className="graph-frame">
    <label className="graph-jump">Inspect node
      <select aria-label="Inspect graph node" defaultValue="" onChange={(event) => chooseNode(event.target.value)}>
        <option value="" disabled>Select Concept or Claim…</option>
        {graph.nodes.map((node) => <option key={node.id} value={node.id}>
          {node.kind === "concept" ? `Concept: ${node.canonicalName}` : `Claim: ${node.statement}`}
        </option>)}
      </select>
    </label>
    <div className="graph-controls" aria-label="Graph viewport controls">
      <button type="button" onClick={fitAll}>Fit all</button>
    </div>
    <div className="graph-canvas" ref={host} data-testid="knowledge-graph" aria-label={`Knowledge graph for ${graph.context.name}`} />
    {showNavigator && <div id={navigatorId} ref={navigatorHost} className="graph-navigator" data-testid="graph-navigator" aria-label="Graph minimap" />}
  </div>;
}
