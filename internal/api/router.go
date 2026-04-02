package api

import (
	"net/http"
	"strings"

	"github.com/suprjinx/torg/internal/orgfile"
)

// Register sets up all API routes on the given mux.
func Register(mux *http.ServeMux, store *orgfile.Store) {
	h := &handlers{store: store}

	mux.HandleFunc("/api/outline", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.getOutline(w, r)
	})

	mux.HandleFunc("/api/nodes/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		switch {
		case strings.HasSuffix(path, "/children") && r.Method == http.MethodPost:
			h.createChild(w, r)
		case strings.HasSuffix(path, "/sibling") && r.Method == http.MethodPost:
			h.createSibling(w, r)
		case strings.HasSuffix(path, "/move") && r.Method == http.MethodPost:
			h.moveNode(w, r)
		case r.Method == http.MethodPut:
			h.updateNode(w, r)
		case r.Method == http.MethodDelete:
			h.deleteNode(w, r)
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	})
}
