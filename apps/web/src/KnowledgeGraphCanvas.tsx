import type { Core, ElementDefinition, StylesheetJson } from "cytoscape";
import { useEffect, useRef } from "react";
import type { ContextGraph, KnowledgeMapEdge, KnowledgeMapNode } from "./api.js";

export type GraphSelection =
  | { readonly kind: "node"; readonly node: KnowledgeMapNode }
  | { readonly kind: "edge"; readonly edge: KnowledgeMapEdge };

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
      "font-size": 10,
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
      "font-size": 7,
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
];

function nodeLabel(node: KnowledgeMapNode): string {
  if (node.kind === "concept") return node.canonicalName;
  return node.statement.length > 92 ? `${node.statement.slice(0, 89)}…` : node.statement;
}

function elements(graph: ContextGraph): ElementDefinition[] {
  return [
    ...graph.nodes.map((node): ElementDefinition => ({
      group: "nodes",
      data: {
        id: node.id,
        kind: node.kind,
        label: nodeLabel(node),
        width: node.kind === "concept" ? Math.min(78 + node.localDegree * 6, 128) : 190,
        height: node.kind === "concept" ? Math.min(50 + node.localDegree * 3, 78) : 72,
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

export function KnowledgeGraphCanvas({ graph, onSelect }: {
  readonly graph: ContextGraph;
  readonly onSelect: (selection: GraphSelection) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const core = useRef<Core | null>(null);

  useEffect(() => {
    if (host.current === null) return;
    let disposed = false;
    let instance: Core | null = null;
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    const edgesById = new Map(graph.edges.map((edge) => [edge.id, edge]));
    void import("cytoscape").then(({ default: cytoscape }) => {
      if (disposed || host.current === null) return;
      instance = cytoscape({
        container: host.current,
        elements: elements(graph),
        style: styles,
        minZoom: 0.15,
        maxZoom: 2.5,
        wheelSensitivity: 0.18,
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
      instance.on("tap", "node", (event) => {
        const node = nodesById.get(event.target.id());
        if (node !== undefined) onSelect({ kind: "node", node });
      });
      instance.on("tap", "edge", (event) => {
        const edge = edgesById.get(event.target.id());
        if (edge !== undefined) onSelect({ kind: "edge", edge });
      });
    });
    return () => {
      disposed = true;
      core.current = null;
      instance?.destroy();
    };
  }, [graph, onSelect]);

  function chooseNode(id: string) {
    const node = graph.nodes.find((item) => item.id === id);
    if (node === undefined) return;
    core.current?.elements().unselect();
    core.current?.getElementById(id).select();
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
    <div className="graph-canvas" ref={host} data-testid="knowledge-graph" aria-label={`Knowledge graph for ${graph.context.name}`} />
  </div>;
}
