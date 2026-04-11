package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/suprjinx/torg/internal/model"
	"github.com/suprjinx/torg/internal/orgfile"
)

type handlers struct {
	store  *orgfile.Store
	onSave func() // called after successful save (resets idle timer)
}

func (h *handlers) listFiles(w http.ResponseWriter, r *http.Request) {
	files, err := h.store.ListFiles()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string][]string{"files": files})
}

func (h *handlers) createFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Filename string `json:"filename"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	name := req.Filename
	if !strings.HasSuffix(name, ".org") {
		name += ".org"
	}
	if err := h.store.CreateFile(name); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, map[string]string{"filename": name})
}

func (h *handlers) getDoc(w http.ResponseWriter, r *http.Request) {
	name := extractFilename(r.URL.Path)
	if name == "" {
		http.Error(w, "missing filename", http.StatusBadRequest)
		return
	}

	fs, err := h.store.LoadFile(name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	items := model.FromDocument(fs.Doc)
	nodes := items.ToTree(fs.Meta.Collapsed)

	writeJSON(w, model.Document{
		Filename: name,
		Preamble: fs.Preamble,
		Hash:     fs.BaseHash,
		Nodes:    nodes,
	})
}

func (h *handlers) putDoc(w http.ResponseWriter, r *http.Request) {
	name := extractFilename(r.URL.Path)
	if name == "" {
		http.Error(w, "missing filename", http.StatusBadRequest)
		return
	}

	var doc model.Document
	if err := json.NewDecoder(r.Body).Decode(&doc); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Convert tree to org content
	items := model.ItemsFromTree(doc.Nodes, 1)
	preamble := doc.Preamble
	if preamble != "" && !strings.HasSuffix(preamble, "\n") {
		preamble += "\n"
	}
	content := preamble + items.ToOrg()

	// Save collapsed state to sidecar
	collapsed := model.CollapsedFromTree(doc.Nodes)
	h.store.SaveMeta(name, collapsed)

	// Write to disk with merge-on-conflict
	newHash, conflict, err := h.store.SaveFile(name, content)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if h.onSave != nil {
		h.onSave()
	}

	resp := map[string]interface{}{"hash": newHash}
	if conflict {
		resp["conflict"] = true
	}
	writeJSON(w, resp)
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func extractFilename(path string) string {
	// /api/doc/notes.org -> notes.org
	const prefix = "/api/doc/"
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	return strings.TrimPrefix(path, prefix)
}
