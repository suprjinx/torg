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

function updateNodeField(nodes, nodeId, field, value) {
  const update = (list) =>
    list.map((n) => {
      if (n.id === nodeId) return { ...n, [field]: value };
      if (n.children?.length > 0) return { ...n, children: update(n.children) };
      return n;
    });
  return update(nodes);
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

// --- Components ---

function PreambleRow({ focused, dispatch, inputRefs }) {
  const isFocused = focused;
  return html`
    <div className=${"node-row preamble-row" + (isFocused ? " focused" : "")}
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

  // Shift+Enter: focus body textarea in detail pane
  if (key === "Enter" && shift) { e.preventDefault(); dispatch(id, "focus-body"); return; }

  // Enter: new sibling
  if (key === "Enter" && !shift) { e.preventDefault(); dispatch(id, "new-sibling"); return; }

  // Backspace on empty: delete
  if (key === "Backspace" && e.target.value === "") { e.preventDefault(); dispatch(id, "delete"); return; }
}

function App() {
  const [nodes, setNodes] = useState(null);
  const [preamble, setPreamble] = useState("");
  const [focusedId, setFocusedId] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const pendingFocusRef = useRef(null);
  const inputRefs = useRef({});
  const pendingTitle = useRef({});
  const pendingBody = useRef({});
  const pendingPreamble = useRef(null);
  const saveTimers = useRef({});
  const bodyTimers = useRef({});
  const preambleTimer = useRef(null);
  const bodyTextareaRef = useRef(null);

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

  const applyResult = useCallback((data, focusId) => {
    setNodes(data.nodes || []);
    if (data.preamble !== undefined) setPreamble(data.preamble || "");
    const target = data.focusId || focusId;
    if (target) focusNode(target);
  }, [focusNode]);

  // Load on mount
  useEffect(() => {
    api.get("/api/outline").then((data) => {
      const n = data.nodes || [];
      setNodes(n);
      setPreamble(data.preamble || "");
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

  // Debounced body save
  const saveBody = useCallback((nodeId, body) => {
    if (bodyTimers.current[nodeId]) clearTimeout(bodyTimers.current[nodeId]);
    bodyTimers.current[nodeId] = setTimeout(async () => {
      try {
        const data = await api.put(`/api/nodes/${nodeId}`, { body });
        delete pendingBody.current[nodeId];
        setNodes(data.nodes || []);
      } catch (err) {
        console.error("body save failed:", err);
      }
    }, 400);
  }, []);

  // Debounced preamble save
  const savePreamble = useCallback((text) => {
    if (preambleTimer.current) clearTimeout(preambleTimer.current);
    preambleTimer.current = setTimeout(async () => {
      try {
        const data = await api.put("/api/preamble", { text });
        pendingPreamble.current = null;
        setNodes(data.nodes || []);
      } catch (err) {
        console.error("preamble save failed:", err);
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

  const flushBody = useCallback(async () => {
    for (const nodeId of Object.keys(bodyTimers.current)) {
      clearTimeout(bodyTimers.current[nodeId]);
      delete bodyTimers.current[nodeId];
    }
    for (const nodeId of Object.keys(pendingBody.current)) {
      const body = pendingBody.current[nodeId];
      delete pendingBody.current[nodeId];
      await api.put(`/api/nodes/${nodeId}`, { body });
    }
  }, []);

  const flushPreamble = useCallback(async () => {
    if (preambleTimer.current) {
      clearTimeout(preambleTimer.current);
      preambleTimer.current = null;
    }
    if (pendingPreamble.current !== null) {
      const text = pendingPreamble.current;
      pendingPreamble.current = null;
      await api.put("/api/preamble", { text });
    }
  }, []);

  const dispatch = useCallback(async (nodeId, action, value) => {
    // Build flat list with preamble as first entry for navigation
    const flat = [{ id: "preamble" }, ...flattenVisible(nodes)];
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

    if (action === "change") {
      pendingTitle.current[nodeId] = value;
      setNodes((prev) => updateNodeField(prev, nodeId, "title", value));
      saveTitle(nodeId, value);
      return;
    }

    if (action === "change-body") {
      pendingBody.current[nodeId] = value;
      saveBody(nodeId, value);
      return;
    }

    if (action === "change-preamble") {
      pendingPreamble.current = value;
      savePreamble(value);
      return;
    }

    if (action === "focus-body") {
      if (bodyTextareaRef.current) {
        bodyTextareaRef.current.focus();
      }
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

    // Preamble doesn't support structural ops
    if (nodeId === "preamble") return;

    if (action === "toggle") {
      await flushSave(nodeId);
      const node = flat.find((n) => n.id === nodeId);
      if (!node) return;
      const data = await api.put(`/api/nodes/${nodeId}`, { collapsed: !node.collapsed });
      applyResult(data, nodeId);
      return;
    }

    // Structural ops — flush pending saves first
    await flushSave(nodeId);
    await flushBody();
    await flushPreamble();

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

    if (action === "update-properties") {
      const data = await api.put(`/api/nodes/${nodeId}`, { properties: value });
      setNodes(data.nodes || []);
      return;
    }

    if (["indent", "outdent", "move-up", "move-down"].includes(action)) {
      const data = await api.post(`/api/nodes/${nodeId}/move`, { action });
      applyResult(data);
    }
  }, [nodes, saveTitle, saveBody, savePreamble, flushSave, flushBody, flushPreamble, focusNode, applyResult]);

  if (nodes === null) return html`<div className="empty">Loading...</div>`;

  const isPreambleFocused = focusedId === "preamble";
  const focusedNode = (!isPreambleFocused && focusedId) ? findNode(nodes, focusedId) : null;

  // Build detail pane props
  const detailNode = isPreambleFocused ? { body: preamble } : focusedNode;
  const detailKey = isPreambleFocused ? "preamble" : focusedId;

  if (nodes.length === 0) {
    return html`
      <div>
        <${Header} onHelp=${() => setShowHelp(true)} />
        <div className="app-layout">
          <div className="outline-pane">
            <${PreambleRow} focused=${isPreambleFocused} dispatch=${dispatch} inputRefs=${inputRefs} />
            <div className="empty"
                 onClick=${async () => {
                   const data = await api.post("/api/nodes/root/children", { title: "" });
                   const flat = flattenVisible(data.nodes || []);
                   applyResult(data, flat[0]?.id);
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
      <${Header} onHelp=${() => setShowHelp(true)} />
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
