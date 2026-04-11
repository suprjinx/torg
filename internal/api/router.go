package api

import (
	"net/http"

	"github.com/suprjinx/torg/internal/orgfile"
)

// Register sets up API routes on the given mux.
func Register(mux *http.ServeMux, store *orgfile.Store, onSave func()) {
	h := &handlers{store: store, onSave: onSave}

	mux.HandleFunc("/api/files", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.listFiles(w, r)
		case http.MethodPost:
			h.createFile(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/doc/", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.getDoc(w, r)
		case http.MethodPut, http.MethodPost: // POST for sendBeacon compatibility
			h.putDoc(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
}
