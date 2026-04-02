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
  async post(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },
  async put(path, body) {
    const r = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },
  async del(path) {
    const r = await fetch(path, { method: "DELETE" });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },
};

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

// --- Components ---

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

function handleKey(e, id, dispatch) {
  const alt = e.altKey;
  const shift = e.shiftKey;
  const key = e.key;

  // Alt+Arrow: move node or indent/outdent (org-mode style)
  if (alt && key === "ArrowUp")    { e.preventDefault(); dispatch(id, "move-up"); return; }
  if (alt && key === "ArrowDown")  { e.preventDefault(); dispatch(id, "move-down"); return; }
  if (alt && key === "ArrowRight") { e.preventDefault(); dispatch(id, "indent"); return; }
  if (alt && key === "ArrowLeft")  { e.preventDefault(); dispatch(id, "outdent"); return; }

  // Tab / Shift-Tab: fold/unfold
  if (key === "Tab" && !shift) { e.preventDefault(); dispatch(id, "toggle"); return; }
  if (key === "Tab" && shift)  { e.preventDefault(); dispatch(id, "toggle"); return; }

  // Navigation
  if (key === "ArrowUp")   { e.preventDefault(); dispatch(id, "nav-up"); return; }
  if (key === "ArrowDown") { e.preventDefault(); dispatch(id, "nav-down"); return; }

  // Enter: new sibling
  if (key === "Enter" && !shift) { e.preventDefault(); dispatch(id, "new-sibling"); return; }

  // Backspace on empty: delete
  if (key === "Backspace" && e.target.value === "") { e.preventDefault(); dispatch(id, "delete"); return; }
}

function App() {
  const [nodes, setNodes] = useState(null);
  const [focusedId, setFocusedId] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const pendingFocusRef = useRef(null);
  const inputRefs = useRef({});
  const pendingTitle = useRef({});
  const saveTimers = useRef({});

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

  // Focus the input whenever pendingFocusRef is set
  useEffect(() => {
    const id = pendingFocusRef.current;
    if (id !== null) {
      pendingFocusRef.current = null;
      requestAnimationFrame(() => {
        const el = inputRefs.current[id];
        if (el) {
          el.focus();
          el.selectionStart = el.selectionEnd = el.value.length;
        }
      });
    }
  });

  const focusNode = useCallback((id) => {
    setFocusedId(id);
    pendingFocusRef.current = id;
  }, []);

  const applyResult = useCallback((data, focusId) => {
    setNodes(data.nodes || []);
    // Server-provided focusId takes precedence, then explicit param
    const target = data.focusId || focusId;
    if (target) focusNode(target);
  }, [focusNode]);

  // Load on mount
  useEffect(() => {
    api.get("/api/outline").then((data) => {
      const n = data.nodes || [];
      setNodes(n);
      const flat = flattenVisible(n);
      if (flat.length > 0) focusNode(flat[0].id);
    });
  }, [focusNode]);

  // Debounced title save
  const saveTitle = useCallback((nodeId, title) => {
    if (saveTimers.current[nodeId]) clearTimeout(saveTimers.current[nodeId]);
    saveTimers.current[nodeId] = setTimeout(async () => {
      try {
        await api.put(`/api/nodes/${nodeId}`, { title });
        delete pendingTitle.current[nodeId];
      } catch (err) {
        console.error("save failed:", err);
      }
    }, 400);
  }, []);

  const flushSave = useCallback(async (nodeId) => {
    if (saveTimers.current[nodeId]) {
      clearTimeout(saveTimers.current[nodeId]);
      delete saveTimers.current[nodeId];
    }
    const title = pendingTitle.current[nodeId];
    if (title !== undefined) {
      delete pendingTitle.current[nodeId];
      await api.put(`/api/nodes/${nodeId}`, { title });
    }
  }, []);

  const dispatch = useCallback(async (nodeId, action, value) => {
    const flat = flattenVisible(nodes);
    const idx = flat.findIndex((n) => n.id === nodeId);

    if (action === "focus") {
      setFocusedId(nodeId);
      return;
    }

    if (action === "change") {
      pendingTitle.current[nodeId] = value;
      setNodes((prev) => {
        const update = (list) =>
          list.map((n) => {
            if (n.id === nodeId) return { ...n, title: value };
            if (n.children?.length > 0) return { ...n, children: update(n.children) };
            return n;
          });
        return update(prev);
      });
      saveTitle(nodeId, value);
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

    if (action === "toggle") {
      const node = flat.find((n) => n.id === nodeId);
      if (!node) return;
      const data = await api.put(`/api/nodes/${nodeId}`, { collapsed: !node.collapsed });
      applyResult(data, nodeId);
      return;
    }

    // Structural ops — flush pending save first
    await flushSave(nodeId);

    if (action === "new-sibling") {
      const data = await api.post(`/api/nodes/${nodeId}/sibling`, { title: "" });
      applyResult(data);
      return;
    }

    if (action === "delete") {
      const prevId = idx > 0 ? flat[idx - 1].id : null;
      const data = await api.del(`/api/nodes/${nodeId}`);
      applyResult(data, prevId);
      return;
    }

    if (["indent", "outdent", "move-up", "move-down"].includes(action)) {
      const data = await api.post(`/api/nodes/${nodeId}/move`, { action });
      applyResult(data);
    }
  }, [nodes, saveTitle, flushSave, focusNode, applyResult]);

  if (nodes === null) return html`<div className="empty">Loading...</div>`;

  if (nodes.length === 0) {
    return html`
      <div>
        <${Header} onHelp=${() => setShowHelp(true)} />
        <div className="empty"
             onClick=${async () => {
               const data = await api.post("/api/nodes/root/children", { title: "" });
               const flat = flattenVisible(data.nodes || []);
               applyResult(data, flat[0]?.id);
             }}>
          Click or press any key to start
        </div>
        <${Hints} />
      </div>
    `;
  }

  return html`
    <div>
      <${Header} onHelp=${() => setShowHelp(true)} />
      ${showHelp && html`<${HelpPanel} onClose=${() => setShowHelp(false)} />`}
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
      <${Hints} />
    </div>
  `;
}

function Header({ onHelp }) {
  return html`
    <header>
      <h1>torg</h1>
      <button className="help-btn" onClick=${onHelp} title="Keyboard shortcuts (Ctrl+H)">?</button>
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
          <button className="help-close" onClick=${onClose}>×</button>
        </div>
        <div className="help-body">
          <${HelpSection} title="Navigation">
            <${HelpRow} keys="↑ / ↓" desc="Move between items" />
            <${HelpRow} keys="Enter" desc="Create new item below" />
            <${HelpRow} keys="Backspace" desc="Delete empty item" />
          <//>
          <${HelpSection} title="Structure">
            <${HelpRow} keys="Alt + ←" desc="Outdent (promote)" />
            <${HelpRow} keys="Alt + →" desc="Indent (demote)" />
            <${HelpRow} keys="Alt + ↑" desc="Move item up" />
            <${HelpRow} keys="Alt + ↓" desc="Move item down" />
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
      <span><kbd>↑↓</kbd> navigate</span>
      <span><kbd>Enter</kbd> new</span>
      <span><kbd>Tab</kbd> fold</span>
      <span><kbd>Alt+←→</kbd> indent</span>
      <span><kbd>Alt+↑↓</kbd> move</span>
      <span><kbd>Ctrl+H</kbd> help</span>
    </div>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
