import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import htm from "htm";

const html = htm.bind(React.createElement);

// --- API ---

const api = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },
  async put(path, body) {
    const r = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 409) {
      const data = await r.json();
      throw Object.assign(new Error("conflict"), { conflict: true, serverVersion: data.version });
    }
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },
};

// --- Local ID generator ---

let _nextId = 1;
function newId() {
  return `n${_nextId++}`;
}

// --- Tree helpers ---

function flattenVisible(nodes) {
  const result = [];
  function walk(list) {
    for (const n of list) {
      result.push(n);
      if (n.children?.length > 0 && !n.collapsed) walk(n.children);
    }
  }
  walk(nodes || []);
  return result;
}

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length > 0) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

function newNode(title = "") {
  return {
    id: newId(),
    title,
    body: "",
    status: "",
    tags: [],
    properties: {},
    children: [],
    collapsed: false,
  };
}

// Deep-clone a tree, updating a single node field
function updateNodeField(nodes, nodeId, field, value) {
  return nodes.map((n) => {
    if (n.id === nodeId) return { ...n, [field]: value };
    if (n.children?.length > 0) return { ...n, children: updateNodeField(n.children, nodeId, field, value) };
    return n;
  });
}

// Find parent + index of a node within the tree
function findParentInfo(nodes, id, parent = null, parentList = null) {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { parent, parentList: nodes, index: i };
    if (nodes[i].children?.length > 0) {
      const found = findParentInfo(nodes[i].children, id, nodes[i], nodes[i].children);
      if (found) return found;
    }
  }
  return null;
}

// Insert a new sibling after a node (after its subtree position)
function insertSiblingAfter(nodes, afterId) {
  const nn = newNode();
  return { nodes: insertAfter(nodes, afterId, nn), newId: nn.id };
}

function insertAfter(nodes, afterId, newNode) {
  const result = [];
  for (const n of nodes) {
    if (n.id === afterId) {
      result.push({ ...n, children: n.children ? [...n.children] : [] });
      result.push(newNode);
    } else {
      const updatedChildren = n.children?.length > 0 ? insertAfter(n.children, afterId, newNode) : n.children;
      result.push(updatedChildren !== n.children ? { ...n, children: updatedChildren } : n);
    }
  }
  return result;
}

// Remove a node from the tree
function removeNode(nodes, id) {
  const result = [];
  for (const n of nodes) {
    if (n.id === id) continue;
    const updatedChildren = n.children?.length > 0 ? removeNode(n.children, id) : n.children;
    result.push(updatedChildren !== n.children ? { ...n, children: updatedChildren } : n);
  }
  return result;
}

// Indent: make node a child of its previous sibling
function indentNode(nodes, id) {
  const info = findParentInfo(nodes, id);
  if (!info || info.index === 0) return nodes; // can't indent first child

  const prevSibling = info.parentList[info.index - 1];
  const node = info.parentList[info.index];

  // Remove node from current position
  let result = removeNode(nodes, id);
  // Append to previous sibling's children and uncollapse it
  result = mapNode(result, prevSibling.id, (n) => ({
    ...n,
    collapsed: false,
    children: [...(n.children || []), { ...node }],
  }));
  return result;
}

// Outdent: move node to be a sibling of its parent (after parent)
function outdentNode(nodes, id) {
  const info = findParentInfo(nodes, id);
  if (!info || !info.parent) return nodes; // already at root

  const node = info.parentList[info.index];
  // Remove from current parent
  let result = removeNode(nodes, id);
  // Insert after the parent
  result = insertAfter(result, info.parent.id, { ...node });
  return result;
}

// Move node up within its siblings
function moveNodeUp(nodes, id) {
  const info = findParentInfo(nodes, id);
  if (!info || info.index === 0) return nodes;

  const list = [...info.parentList];
  [list[info.index - 1], list[info.index]] = [list[info.index], list[info.index - 1]];

  if (!info.parent) return list;
  return mapNode(nodes, info.parent.id, (n) => ({ ...n, children: list }));
}

// Move node down within its siblings
function moveNodeDown(nodes, id) {
  const info = findParentInfo(nodes, id);
  if (!info || info.index >= info.parentList.length - 1) return nodes;

  const list = [...info.parentList];
  [list[info.index], list[info.index + 1]] = [list[info.index + 1], list[info.index]];

  if (!info.parent) return list;
  return mapNode(nodes, info.parent.id, (n) => ({ ...n, children: list }));
}

// Apply a transform to a specific node by ID
function mapNode(nodes, id, fn) {
  return nodes.map((n) => {
    if (n.id === id) return fn(n);
    if (n.children?.length > 0) {
      const updated = mapNode(n.children, id, fn);
      return updated !== n.children ? { ...n, children: updated } : n;
    }
    return n;
  });
}

// --- Components ---

function PreambleRow({ focused, dispatch, inputRefs }) {
  return html`
    <div className=${"node-row preamble-row" + (focused ? " focused" : "")}
         onClick=${() => dispatch("preamble", "focus")}
         ref=${(el) => { if (el) inputRefs.current["preamble"] = el; }}
         tabIndex="0"
         onFocus=${() => dispatch("preamble", "focus")}
         onKeyDown=${(e) => {
           if (e.key === "ArrowDown") { e.preventDefault(); dispatch("preamble", "nav-down"); }
           if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); dispatch("preamble", "focus-body"); }
         }}>
      <span className="preamble-icon">\u00B6</span>
      <span className="preamble-label">Preamble</span>
    </div>
  `;
}

function OutlineNode({ node, focusedId, dispatch, inputRefs, depth }) {
  const isFocused = focusedId === node.id;
  const hasChildren = node.children?.length > 0;

  return html`
    <div>
      <div className=${"node-row" + (isFocused ? " focused" : "")}>
        <span style=${{ width: depth * 24, flexShrink: 0 }} />
        <span className=${"bullet" + (hasChildren ? " has-children" : "")}
              onMouseDown=${(e) => {
                e.preventDefault();
                if (hasChildren) dispatch(node.id, "toggle");
              }}>
          ${hasChildren ? (node.collapsed ? "\u25B6" : "\u25BC") : "\u2022"}
        </span>
        <input
          ref=${(el) => { if (el) inputRefs.current[node.id] = el; }}
          className="node-title"
          value=${node.title}
          placeholder=""
          onFocus=${() => dispatch(node.id, "focus")}
          onKeyDown=${(e) => handleKey(e, node.id, dispatch)}
          onChange=${(e) => dispatch(node.id, "change", e.target.value)}
        />
      </div>
      ${hasChildren && !node.collapsed && node.children.map(
        (child) => html`
          <${OutlineNode}
            key=${child.id}
            node=${child}
            focusedId=${focusedId}
            dispatch=${dispatch}
            inputRefs=${inputRefs}
            depth=${depth + 1}
          />
        `
      )}
    </div>
  `;
}

function PropertiesEditor({ nodeId, properties, dispatch }) {
  const entries = Object.entries(properties || {});
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");

  return html`
    <div className="props-editor">
      ${entries.map(([k, v]) => html`
        <div className="prop-row" key=${k}>
          <span className="prop-key">${k}</span>
          <input
            className="prop-value"
            value=${v}
            onChange=${(e) => {
              const updated = { ...properties, [k]: e.target.value };
              dispatch(nodeId, "update-properties", updated);
            }}
          />
          <button className="prop-delete"
                  onClick=${() => {
                    const updated = { ...properties };
                    delete updated[k];
                    dispatch(nodeId, "update-properties", updated);
                  }}
                  title="Remove property">\u00D7</button>
        </div>
      `)}
      <div className="prop-row prop-add">
        <input className="prop-key-input" placeholder="key"
               value=${newKey} onChange=${(e) => setNewKey(e.target.value)} />
        <input className="prop-value" placeholder="value"
               value=${newVal} onChange=${(e) => setNewVal(e.target.value)} />
        <button className="prop-add-btn"
                onClick=${() => {
                  if (newKey.trim()) {
                    const updated = { ...properties, [newKey.trim()]: newVal };
                    dispatch(nodeId, "update-properties", updated);
                    setNewKey("");
                    setNewVal("");
                  }
                }}
                title="Add property">+</button>
      </div>
    </div>
  `;
}

function DetailPane({ node, isPreamble, dispatch, inputRefs, bodyTextareaRef }) {
  const bodySource = isPreamble ? (node?.body || "") : (node?.body || "");
  const [bodyText, setBodyText] = useState(bodySource);
  const localRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = localRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }, [bodyText]);

  if (!node && !isPreamble) {
    return html`
      <div className="detail-pane">
        <div className="detail-empty">Select an item to see details</div>
      </div>
    `;
  }

  const handleBodyChange = (e) => {
    setBodyText(e.target.value);
    if (isPreamble) {
      dispatch("preamble", "change-preamble", e.target.value);
    } else {
      dispatch(node.id, "change-body", e.target.value);
    }
  };

  const handleBodyKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      const targetId = isPreamble ? "preamble" : node?.id;
      dispatch(targetId, "focus-outline");
    }
  };

  const title = isPreamble ? "Preamble" : (node?.title || "Untitled");

  return html`
    <div className="detail-pane">
      <div className="detail-header">${title}</div>
      <div className="detail-section">
        <label className="detail-label">${isPreamble ? "Content" : "Body"}</label>
        <textarea
          ref=${(el) => {
            localRef.current = el;
            if (bodyTextareaRef) bodyTextareaRef.current = el;
          }}
          className="detail-body"
          value=${bodyText}
          placeholder=${isPreamble ? "File header, #+TITLE, etc..." : "Add notes..."}
          onChange=${handleBodyChange}
          onKeyDown=${handleBodyKeyDown}
        />
      </div>
      ${!isPreamble && html`
        <div className="detail-section">
          <label className="detail-label">Properties</label>
          <${PropertiesEditor}
            nodeId=${node.id}
            properties=${node.properties}
            dispatch=${dispatch}
          />
        </div>
      `}
    </div>
  `;
}

function handleKey(e, id, dispatch) {
  const alt = e.altKey;
  const shift = e.shiftKey;
  const key = e.key;

  if (alt && key === "ArrowUp")    { e.preventDefault(); dispatch(id, "move-up"); return; }
  if (alt && key === "ArrowDown")  { e.preventDefault(); dispatch(id, "move-down"); return; }
  if (alt && key === "ArrowRight") { e.preventDefault(); dispatch(id, "indent"); return; }
  if (alt && key === "ArrowLeft")  { e.preventDefault(); dispatch(id, "outdent"); return; }

  if (key === "Tab" && !shift) { e.preventDefault(); dispatch(id, "toggle"); return; }
  if (key === "Tab" && shift)  { e.preventDefault(); dispatch(id, "toggle"); return; }

  if (key === "ArrowUp")   { e.preventDefault(); dispatch(id, "nav-up"); return; }
  if (key === "ArrowDown") { e.preventDefault(); dispatch(id, "nav-down"); return; }

  if (key === "Enter" && shift) { e.preventDefault(); dispatch(id, "focus-body"); return; }
  if (key === "Enter" && !shift) { e.preventDefault(); dispatch(id, "new-sibling"); return; }

  if (key === "Backspace" && e.target.value === "") { e.preventDefault(); dispatch(id, "delete"); return; }
}

// --- Sync status labels ---
const SYNC_SAVED = "saved";
const SYNC_DIRTY = "unsaved";
const SYNC_SAVING = "saving";
const SYNC_ERROR = "error";
const SYNC_CONFLICT = "conflict";

function SyncIndicator({ status }) {
  const labels = {
    [SYNC_SAVED]: "Saved",
    [SYNC_DIRTY]: "Unsaved changes",
    [SYNC_SAVING]: "Saving\u2026",
    [SYNC_ERROR]: "Save failed \u2014 retrying",
    [SYNC_CONFLICT]: "Conflict! Reload needed",
  };
  const cls = "sync-indicator sync-" + status;
  return html`<span className=${cls}>${labels[status] || ""}</span>`;
}

function App() {
  const [nodes, setNodes] = useState(null);
  const [preamble, setPreamble] = useState("");
  const [version, setVersion] = useState(0);
  const [focusedId, setFocusedId] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [syncStatus, setSyncStatus] = useState(SYNC_SAVED);
  const pendingFocusRef = useRef(null);
  const inputRefs = useRef({});
  const bodyTextareaRef = useRef(null);
  const dirtyRef = useRef(false);
  // Refs to always have latest state in the sync interval
  const nodesRef = useRef(null);
  const preambleRef = useRef("");
  const versionRef = useRef(0);

  // Keep refs in sync
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { preambleRef.current = preamble; }, [preamble]);
  useEffect(() => { versionRef.current = version; }, [version]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setSyncStatus(SYNC_DIRTY);
  }, []);

  // Global Ctrl+H handler
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "h") {
        e.preventDefault();
        setShowHelp((v) => !v);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Focus effect
  useEffect(() => {
    const id = pendingFocusRef.current;
    if (id !== null) {
      pendingFocusRef.current = null;
      requestAnimationFrame(() => {
        const el = inputRefs.current[id];
        if (el) {
          el.focus();
          if (el.setSelectionRange) {
            el.selectionStart = el.selectionEnd = el.value?.length || 0;
          }
        }
      });
    }
  });

  const focusNode = useCallback((id) => {
    setFocusedId(id);
    pendingFocusRef.current = id;
  }, []);

  // Load document on mount
  useEffect(() => {
    api.get("/api/doc").then((data) => {
      const n = data.nodes || [];
      setNodes(n);
      setPreamble(data.preamble || "");
      setVersion(data.version || 0);
      const flat = flattenVisible(n);
      if (flat.length > 0) focusNode(flat[0].id);
    });
  }, [focusNode]);

  // Background sync: push to server every 3 seconds when dirty
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!dirtyRef.current || !nodesRef.current) return;
      dirtyRef.current = false;
      setSyncStatus(SYNC_SAVING);
      try {
        const result = await api.put("/api/doc", {
          version: versionRef.current,
          preamble: preambleRef.current,
          nodes: nodesRef.current,
        });
        setVersion(result.version);
        versionRef.current = result.version;
        setSyncStatus(SYNC_SAVED);
      } catch (err) {
        if (err.conflict) {
          setSyncStatus(SYNC_CONFLICT);
        } else {
          dirtyRef.current = true; // retry next cycle
          setSyncStatus(SYNC_ERROR);
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Also sync on page unload
  useEffect(() => {
    const handleUnload = () => {
      if (!dirtyRef.current || !nodesRef.current) return;
      const body = JSON.stringify({
        version: versionRef.current,
        preamble: preambleRef.current,
        nodes: nodesRef.current,
      });
      navigator.sendBeacon("/api/doc", new Blob([body], { type: "application/json" }));
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  // Dispatch: all operations are local state mutations
  const dispatch = useCallback((nodeId, action, value) => {
    // Build flat list with preamble for navigation
    const flat = [{ id: "preamble" }, ...flattenVisible(nodesRef.current || [])];
    const idx = flat.findIndex((n) => n.id === nodeId);

    if (action === "focus") {
      setFocusedId(nodeId);
      return;
    }

    if (action === "focus-outline") {
      setFocusedId(nodeId);
      requestAnimationFrame(() => {
        const el = inputRefs.current[nodeId];
        if (el) {
          el.focus();
          if (el.setSelectionRange) {
            el.selectionStart = el.selectionEnd = el.value?.length || 0;
          }
        }
      });
      return;
    }

    if (action === "focus-body") {
      if (bodyTextareaRef.current) bodyTextareaRef.current.focus();
      return;
    }

    if (action === "nav-up" && idx > 0) {
      focusNode(flat[idx - 1].id);
      return;
    }

    if (action === "nav-down" && idx < flat.length - 1) {
      focusNode(flat[idx + 1].id);
      return;
    }

    // Preamble only supports nav and focus-body
    if (nodeId === "preamble") {
      if (action === "change-preamble") {
        setPreamble(value);
        markDirty();
      }
      return;
    }

    if (action === "change") {
      setNodes((prev) => updateNodeField(prev, nodeId, "title", value));
      markDirty();
      return;
    }

    if (action === "change-body") {
      setNodes((prev) => updateNodeField(prev, nodeId, "body", value));
      markDirty();
      return;
    }

    if (action === "update-properties") {
      setNodes((prev) => updateNodeField(prev, nodeId, "properties", value));
      markDirty();
      return;
    }

    if (action === "toggle") {
      setNodes((prev) => {
        const node = findNode(prev, nodeId);
        if (!node) return prev;
        return updateNodeField(prev, nodeId, "collapsed", !node.collapsed);
      });
      markDirty();
      return;
    }

    if (action === "new-sibling") {
      setNodes((prev) => {
        const { nodes: updated, newId } = insertSiblingAfter(prev, nodeId);
        // Schedule focus after render
        requestAnimationFrame(() => focusNode(newId));
        return updated;
      });
      markDirty();
      return;
    }

    if (action === "delete") {
      const prevId = idx > 1 ? flat[idx - 1].id : (flat.length > 2 ? flat[2]?.id : null);
      setNodes((prev) => removeNode(prev, nodeId));
      if (prevId && prevId !== "preamble") focusNode(prevId);
      markDirty();
      return;
    }

    if (action === "indent") {
      setNodes((prev) => indentNode(prev, nodeId));
      focusNode(nodeId);
      markDirty();
      return;
    }

    if (action === "outdent") {
      setNodes((prev) => outdentNode(prev, nodeId));
      focusNode(nodeId);
      markDirty();
      return;
    }

    if (action === "move-up") {
      setNodes((prev) => moveNodeUp(prev, nodeId));
      focusNode(nodeId);
      markDirty();
      return;
    }

    if (action === "move-down") {
      setNodes((prev) => moveNodeDown(prev, nodeId));
      focusNode(nodeId);
      markDirty();
      return;
    }
  }, [focusNode, markDirty]);

  if (nodes === null) return html`<div className="empty">Loading...</div>`;

  const isPreambleFocused = focusedId === "preamble";
  const focusedNode = (!isPreambleFocused && focusedId) ? findNode(nodes, focusedId) : null;
  const detailNode = isPreambleFocused ? { body: preamble } : focusedNode;
  const detailKey = isPreambleFocused ? "preamble" : focusedId;

  if (nodes.length === 0) {
    return html`
      <div>
        <${Header} onHelp=${() => setShowHelp(true)} syncStatus=${syncStatus} />
        <div className="app-layout">
          <div className="outline-pane">
            <${PreambleRow} focused=${isPreambleFocused} dispatch=${dispatch} inputRefs=${inputRefs} />
            <div className="empty"
                 onClick=${() => {
                   const nn = newNode();
                   setNodes([nn]);
                   focusNode(nn.id);
                   markDirty();
                 }}>
              Click or press any key to start
            </div>
          </div>
          <${DetailPane}
            key=${detailKey}
            node=${detailNode}
            isPreamble=${isPreambleFocused}
            dispatch=${dispatch}
            inputRefs=${inputRefs}
            bodyTextareaRef=${bodyTextareaRef}
          />
        </div>
        <${Hints} />
      </div>
    `;
  }

  return html`
    <div>
      <${Header} onHelp=${() => setShowHelp(true)} syncStatus=${syncStatus} />
      ${showHelp && html`<${HelpPanel} onClose=${() => setShowHelp(false)} />`}
      <div className="app-layout">
        <div className="outline-pane">
          <${PreambleRow} focused=${isPreambleFocused} dispatch=${dispatch} inputRefs=${inputRefs} />
          ${nodes.map(
            (node) => html`
              <${OutlineNode}
                key=${node.id}
                node=${node}
                focusedId=${focusedId}
                dispatch=${dispatch}
                inputRefs=${inputRefs}
                depth=${0}
              />
            `
          )}
        </div>
        <${DetailPane}
          key=${detailKey}
          node=${detailNode}
          isPreamble=${isPreambleFocused}
          dispatch=${dispatch}
          inputRefs=${inputRefs}
          bodyTextareaRef=${bodyTextareaRef}
        />
      </div>
      <${Hints} />
    </div>
  `;
}

function Header({ onHelp, syncStatus }) {
  return html`
    <header>
      <h1>torg</h1>
      <div className="header-right">
        <${SyncIndicator} status=${syncStatus} />
        <button className="help-btn" onClick=${onHelp} title="Keyboard shortcuts (Ctrl+H)">?</button>
      </div>
    </header>
  `;
}

function HelpPanel({ onClose }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return html`
    <div className="help-overlay" onClick=${onClose}>
      <div className="help-panel" onClick=${(e) => e.stopPropagation()}>
        <div className="help-header">
          <h2>Keyboard shortcuts</h2>
          <button className="help-close" onClick=${onClose}>\u00D7</button>
        </div>
        <div className="help-body">
          <${HelpSection} title="Navigation">
            <${HelpRow} keys="\u2191 / \u2193" desc="Move between items" />
            <${HelpRow} keys="Enter" desc="Create new item below" />
            <${HelpRow} keys="Shift + Enter" desc="Focus body / preamble text" />
            <${HelpRow} keys="Escape" desc="Return to outline" />
            <${HelpRow} keys="Backspace" desc="Delete empty item" />
          <//>
          <${HelpSection} title="Structure">
            <${HelpRow} keys="Alt + \u2190" desc="Outdent (promote)" />
            <${HelpRow} keys="Alt + \u2192" desc="Indent (demote)" />
            <${HelpRow} keys="Alt + \u2191" desc="Move item up" />
            <${HelpRow} keys="Alt + \u2193" desc="Move item down" />
          <//>
          <${HelpSection} title="Folding">
            <${HelpRow} keys="Tab" desc="Fold / unfold children" />
            <${HelpRow} keys="Click bullet" desc="Fold / unfold children" />
          <//>
          <${HelpSection} title="Other">
            <${HelpRow} keys="Ctrl + H" desc="Toggle this help" />
            <${HelpRow} keys="Esc" desc="Close help" />
          <//>
        </div>
      </div>
    </div>
  `;
}

function HelpSection({ title, children }) {
  return html`
    <div className="help-section">
      <h3>${title}</h3>
      <div className="help-rows">${children}</div>
    </div>
  `;
}

function HelpRow({ keys, desc }) {
  return html`
    <div className="help-row">
      <span className="help-keys">${keys}</span>
      <span className="help-desc">${desc}</span>
    </div>
  `;
}

function Hints() {
  return html`
    <div className="hints">
      <span><kbd>\u2191\u2193</kbd> navigate</span>
      <span><kbd>Enter</kbd> new</span>
      <span><kbd>Shift+Enter</kbd> body</span>
      <span><kbd>Tab</kbd> fold</span>
      <span><kbd>Alt+\u2190\u2192</kbd> indent</span>
      <span><kbd>Alt+\u2191\u2193</kbd> move</span>
      <span><kbd>Ctrl+H</kbd> help</span>
    </div>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
