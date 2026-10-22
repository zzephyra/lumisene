import { ScriptAnalysis } from "./script-analysis";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, ReactFlowProvider, applyNodeChanges, type Connection, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "../../components/ui/button";
import { GraphToolbar } from "./graph-toolbar";
import { CharacterNode, type CharacterFlowNode } from "./character-node";
import { GraphActionsContext, type GraphActions } from "./graph-actions";
import { RelationshipEdge, flowHandles, relationshipLanes, type RelationshipFlowEdge } from "./relationship-edge";
import { Inspector } from "./inspector";
import { graph, remove, save, saveLayout, type Selection } from "./api";
import "./character-graph.css";

const nodeTypes = { character: CharacterNode };
const edgeTypes = { relationship: RelationshipEdge };
const marker = { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--color-muted)" };

export function CharacterGraph({ projectId, storyId, onEditStory, focusCharacterId }: { projectId: string; storyId: string; onEditStory?: () => void; focusCharacterId?: string | null }) {
  return (
    <ReactFlowProvider>
      <GraphCanvas key={`${projectId}:${storyId}`} projectId={projectId} storyId={storyId} onEditStory={onEditStory} focusCharacterId={focusCharacterId} />
    </ReactFlowProvider>
  );
}

function useHost(id: string) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setHost(document.getElementById(id));
  }, [id]);
  return host;
}

function motionDuration() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200;
}

function GraphCanvas({ projectId, storyId, onEditStory, focusCharacterId }: { projectId: string; storyId: string; onEditStory?: () => void; focusCharacterId?: string | null }) {
  const query = useQuery({
    queryKey: ["projects", projectId, "stories", storyId, "character-graph"],
    refetchInterval: 5000,
    queryFn: ({ signal }) => graph(projectId, storyId, signal),
  });
  const [nodes, setNodes] = useState<CharacterFlowNode[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [relation, setRelation] = useState("");
  const [message, setMessage] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const layoutWorker = useRef<Worker | null>(null);
  const dirty = useRef(false);
  const flow = useRef<ReactFlowInstance<CharacterFlowNode, RelationshipFlowEdge> | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const layoutVersion = useRef(0);
  const saving = useRef(false);
  const pendingLayout = useRef<CharacterFlowNode[] | null>(null);
  const layoutHistory = useRef<{ positions: Record<string, { x: number; y: number }>; viewport: { x: number; y: number; zoom: number } }[]>([]);
  const toolSlot = useHost("story-graph-tools");
  useEffect(() => () => layoutWorker.current?.terminate(), []);
  useEffect(() => {
    if (message !== "布局已保存") return;
    const timer = window.setTimeout(() => setMessage(""), 1800);
    return () => window.clearTimeout(timer);
  }, [message]);

  const select = useCallback((next: Selection) => {
    if (dirty.current && !window.confirm("有未保存的修改，放弃修改并切换？")) return;
    dirty.current = false;
    setSelection(next);
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function placeViewport(instance: ReactFlowInstance<CharacterFlowNode, RelationshipFlowEdge>, positions: Record<string, { x: number; y: number }> | undefined, viewport: { x: number; y: number; zoom: number } | undefined) {
    if (Object.keys(positions ?? {}).length > 0) instance.setViewport(viewport ?? { x: 0, y: 0, zoom: 1 });
    else requestAnimationFrame(() => fit());
  }

  useEffect(() => {
    if (!query.data) return;
    const data = query.data;
    layoutVersion.current = data.layout.version ?? 0;
    setNodes((old) => data.characters.map((character, index) => {
      const previous = old.find((node) => node.id === character.id);
      return {
        id: character.id,
        type: "character",
        position: previous?.position ?? data.layout.node_positions?.[character.id] ?? { x: (index % 4) * 320, y: Math.floor(index / 4) * 200 },
        data: {
          characterId: character.id,
          name: character.name,
          title: character.title,
          roleType: character.role_type,
          age: character.age,
          occupation: character.occupation,
          avatarUrl: character.avatar_url ?? undefined,
        },
      };
    }));
    if (!initialized.current && flow.current) {
      placeViewport(flow.current, data.layout.node_positions, data.layout.viewport);
      initialized.current = true;
    }
  }, [query.data]);

  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focusCharacterId || focused.current === focusCharacterId) return;
    if (!query.data?.characters.some((character) => character.id === focusCharacterId)) return;
    focused.current = focusCharacterId;
    select({ kind: "character", id: focusCharacterId });
  }, [focusCharacterId, query.data, select]);

  async function persist(current: CharacterFlowNode[]) {
    pendingLayout.current = current;
    if (saving.current) return;
    saving.current = true;
    try {
      while (pendingLayout.current) {
        const snapshot = pendingLayout.current;
        pendingLayout.current = null;
        const result = await saveLayout(projectId, storyId, {
          expected_version: layoutVersion.current,
          node_positions: Object.fromEntries(snapshot.map((node) => [node.id, node.position])),
          viewport: flow.current?.getViewport() ?? { x: 0, y: 0, zoom: 1 },
        });
        layoutVersion.current = result.version ?? 0;
      }
      setMessage("布局已保存");
    } catch (error) {
      pendingLayout.current = null;
      setMessage(error instanceof Error ? error.message : "布局保存失败");
    } finally {
      saving.current = false;
    }
  }

  const all = query.data?.relationships ?? [];
  const lanes = relationshipLanes(all);
  const edges: RelationshipFlowEdge[] = all.map((item) => {
    const sourceNode = nodes.find((node) => node.id === item.source_character_id);
    const targetNode = nodes.find((node) => node.id === item.target_character_id);
    const handles = sourceNode && targetNode ? flowHandles(sourceNode.position, targetNode.position) : { sourceHandle: "out-right", targetHandle: "in-left" };
    return {
      id: item.id,
      source: item.source_character_id,
      target: item.target_character_id,
      type: "relationship",
      selected: selection.kind === "relationship" && selection.id === item.id,
      hidden: !!relation && item.relationship_type !== relation,
      data: { label: item.relationship_type, lane: 0, ...lanes.get(item.id) },
      markerEnd: item.direction !== "undirected" ? marker : undefined,
      markerStart: item.direction === "mutual" ? marker : undefined,
      ...handles,
    };
  });

  async function addCharacter() {
    const name = window.prompt("人物姓名");
    if (!name?.trim()) return;
    try {
      const created = await save(projectId, storyId, "character", { name });
      await query.refetch();
      select({ kind: "character", id: created.id });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    }
  }

  async function connect(connection: Connection) {
    if (!connection.source || !connection.target) return;
    const relationship_type = window.prompt("关系类型，例如：朋友、父女、恋人");
    if (!relationship_type?.trim()) return;
    try {
      const created = await save(projectId, storyId, "relationship", {
        source_character_id: connection.source,
        target_character_id: connection.target,
        relationship_type,
      });
      await query.refetch();
      select({ kind: "relationship", id: created.id });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    }
  }

  function focus() {
    const match = nodes.find((node) => node.data.name.includes(search.trim()));
    if (!match || !flow.current) {
      setMessage(search.trim() ? "没有匹配的人物" : "");
      return;
    }
    setRole("");
    flow.current.setCenter(match.position.x + 130, match.position.y + 70, { zoom: Math.max(flow.current.getZoom(), 0.9), duration: motionDuration() });
    select({ kind: "character", id: match.id });
  }

  function fit() {
    const view = flow.current;
    const pane = container.current?.querySelector(".react-flow");
    if (!view || !(pane instanceof HTMLElement)) return;
    const visible = view.getNodes().filter((node) => !node.hidden);
    if (!visible.length) return;
    const zoomNow = view.getViewport().zoom || 1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of visible) {
      const element = pane.querySelector(`[data-id="${CSS.escape(node.id)}"]`);
      const rect = element?.getBoundingClientRect();
      const width = rect && rect.width > 0 ? rect.width / zoomNow : 260;
      const height = rect && rect.height > 0 ? rect.height / zoomNow : 120;
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + width);
      maxY = Math.max(maxY, node.position.y + height);
    }
    const boundsWidth = Math.max(1, maxX - minX);
    const boundsHeight = Math.max(1, maxY - minY);
    const padding = 0.18;
    const availableWidth = pane.clientWidth * (1 - padding * 2);
    const availableHeight = pane.clientHeight * (1 - padding * 2);
    const zoom = Math.min(1, availableWidth / boundsWidth, availableHeight / boundsHeight);
    view.setViewport({
      x: pane.clientWidth / 2 - (minX + boundsWidth / 2) * zoom,
      y: pane.clientHeight / 2 - (minY + boundsHeight / 2) * zoom,
      zoom,
    }, { duration: motionDuration() });
  }

  function remember() {
    layoutHistory.current = [...layoutHistory.current.slice(-29), {
      positions: Object.fromEntries(nodes.map((node) => [node.id, { ...node.position }])),
      viewport: flow.current?.getViewport() ?? { x: 0, y: 0, zoom: 1 },
    }];
    setCanUndo(true);
  }

  async function undoLayout() {
    const previous = layoutHistory.current.pop();
    setCanUndo(layoutHistory.current.length > 0);
    if (!previous) return;
    const next = nodes.map((node) => previous.positions[node.id] ? { ...node, position: previous.positions[node.id] } : node);
    setNodes(next);
    flow.current?.setViewport(previous.viewport);
    await persist(next);
  }

  function runLayout() {
    if (nodes.length && !window.confirm("自动布局将替换手动坐标，是否继续？")) return;
    layoutWorker.current?.terminate();
    const worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
    layoutWorker.current = worker;
    setMessage("正在计算布局…");
    worker.onmessage = (event) => {
      const next = event.data as CharacterFlowNode[];
      setNodes(next);
      void persist(next);
      requestAnimationFrame(() => fit());
      worker.terminate();
    };
    worker.onerror = () => {
      setMessage("布局计算失败，请重试");
      worker.terminate();
    };
    remember();
    worker.postMessage({ nodes, edges: edges.map((edge) => ({ source: edge.source, target: edge.target })) });
  }

  async function deleteCharacter(id: string) {
    const character = query.data?.characters.find((item) => item.id === id);
    if (!character) return;
    const count = (query.data?.relationships ?? []).filter((item) => item.source_character_id === id || item.target_character_id === id).length;
    if (!window.confirm(`删除此人物及 ${count} 条关联关系？`)) return;
    try {
      await remove(projectId, storyId, "character", id, character.version);
      dirty.current = false;
      if (selection.kind === "character" && selection.id === id) setSelection({ kind: "none" });
      await query.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    }
  }

  async function deleteRelationship(id: string) {
    const item = query.data?.relationships.find((edge) => edge.id === id);
    if (!item) return;
    if (!window.confirm("删除此关系？")) return;
    try {
      await remove(projectId, storyId, "relationship", id, item.version);
      dirty.current = false;
      if (selection.kind === "relationship" && selection.id === id) setSelection({ kind: "none" });
      await query.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable=true], [role=menu]")) return;
      if (selection.kind === "none") return;
      event.preventDefault();
      if (selection.kind === "character") void deleteCharacter(selection.id);
      else void deleteRelationship(selection.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const actions: GraphActions = {
    openCharacter: (id) => select({ kind: "character", id }),
    deleteCharacter: (id) => void deleteCharacter(id),
    openRelationship: (id) => select({ kind: "relationship", id }),
  };
  const roles = [...new Set(nodes.map((node) => node.data.roleType))].filter(Boolean);
  const relationTypes = [...new Set(all.map((item) => item.relationship_type))];
  const bar = (
    <div className="story-graph-bar">
      <GraphToolbar search={search} onSearch={setSearch} role={role} onRole={setRole} relation={relation} onRelation={setRelation} roles={roles} relationTypes={relationTypes} onFocus={focus} onLayout={runLayout} onFit={fit} onAdd={() => void addCharacter()} />
      <ScriptAnalysis
        onEditStory={onEditStory}
        canUndo={canUndo}
        characters={query.data?.characters ?? []}
        projectId={projectId}
        relationships={query.data?.relationships ?? []}
        storyId={storyId}
        onAccepted={() => { void query.refetch(); }}
        onNotice={setMessage}
        onUndo={() => { void undoLayout(); }}
      />
    </div>
  );

  return (
    <GraphActionsContext.Provider value={actions}>
      <section className="character-graph">
        {toolSlot ? createPortal(bar, toolSlot) : <header className="graph-toolbar">{bar}</header>}
        {message && <p className="graph-status" role="status">{message}</p>}
        <div className="graph-workspace">
          <div className="graph-canvas" ref={container}>
            {query.isPending ? <p>正在加载人物图谱…</p> : query.isError ? (
              <p role="alert">加载失败 <button onClick={() => void query.refetch()}>重试</button></p>
            ) : (
              <>
                <ReactFlow<CharacterFlowNode, RelationshipFlowEdge>
                  connectionLineStyle={{ stroke: "var(--color-primary)", strokeWidth: 1.5 }}
                  deleteKeyCode={null}
                  edgeTypes={edgeTypes}
                  edges={edges}
                  elevateNodesOnSelect={false}
                  maxZoom={4}
                  minZoom={0.05}
                  nodeTypes={nodeTypes}
                  nodes={nodes.map((node) => ({ ...node, hidden: !!role && node.data.roleType !== role, selected: selection.kind === "character" && selection.id === node.id }))}
                  onlyRenderVisibleElements={nodes.length > 60}
                  onConnect={(connection) => void connect(connection)}
                  onEdgeClick={(_, edge) => select({ kind: "relationship", id: edge.id })}
                  onInit={(instance) => {
                    flow.current = instance;
                    if (query.data && !initialized.current) {
                      placeViewport(instance, query.data.layout.node_positions, query.data.layout.viewport);
                      initialized.current = true;
                    }
                  }}
                  onMoveEnd={(event) => { if (event) void persist(nodes); }}
                  onNodeClick={(_, node) => select({ kind: "character", id: node.id })}
                  onNodeDragStart={remember}
                  onNodeDragStop={(_, node) => {
                    const next = nodes.map((item) => item.id === node.id ? node : item);
                    setNodes(next);
                    void persist(next);
                  }}
                  onNodesChange={(changes) => setNodes((old) => applyNodeChanges(changes, old))}
                >
                  <Background color="color-mix(in srgb, var(--color-muted) 16%, var(--color-canvas))" gap={22} size={1} variant={BackgroundVariant.Dots} />
                  <Controls showInteractive={false} />
                </ReactFlow>
                {nodes.length === 0 && (
                  <div className="graph-empty">
                    <h2>从人物开始构建故事</h2>
                    <p>添加人物，然后连接他们的关系。</p>
                    <Button className="h-8 px-3 text-xs" onClick={() => void addCharacter()}>添加第一个人物</Button>
                  </div>
                )}
              </>
            )}
          </div>
          {selection.kind !== "none" && query.data && (
            <Inspector
              graph={query.data}
              projectId={projectId}
              selection={selection}
              storyId={storyId}
              onClose={() => select({ kind: "none" })}
              onDirty={(value) => { dirty.current = value; }}
              onSaved={() => { void query.refetch(); }}
              onSelect={select}
            />
          )}
        </div>
      </section>
    </GraphActionsContext.Provider>
  );
}
