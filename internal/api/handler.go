package api

import (
	"encoding/json"
	"net/http"

	"github.com/suprjinx/torg/internal/model"
	"github.com/suprjinx/torg/internal/orgfile"
)

type handlers struct {
	store *orgfile.Store
}

func (h *handlers) getDoc(w http.ResponseWriter, r *http.Request) {
	h.store.RLock()
	defer h.store.RUnlock()

	items := model.FromDocument(h.store.Doc())
	nodes := items.ToTree(h.store.Collapsed())

	writeJSON(w, model.Document{
		Version:  h.store.Version(),
		Preamble: h.store.Preamble(),
		Nodes:    nodes,
	})
}

func (h *handlers) putDoc(w http.ResponseWriter, r *http.Request) {
	var doc model.Document
	if err := json.NewDecoder(r.Body).Decode(&doc); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.store.Lock()
	defer h.store.Unlock()

	// Version conflict check
	if doc.Version != h.store.Version() {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":   "conflict",
			"version": h.store.Version(),
		})
		return
	}

	// Convert tree back to flat items, then to org text
	items := model.ItemsFromTree(doc.Nodes, 1)
	newVersion := doc.Version + 1
	preamble := orgfile.BuildPreamble(newVersion, doc.Preamble)
	content := preamble + items.ToOrg()

	if err := h.store.Save(content); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Save collapsed state from the tree to sidecar
	collapsed := model.CollapsedFromTree(doc.Nodes)
	h.store.SaveMeta(collapsed)

	writeJSON(w, map[string]int{"version": newVersion})
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
