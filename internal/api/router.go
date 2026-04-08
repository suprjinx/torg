package api

import (
	"net/http"

	"github.com/suprjinx/torg/internal/orgfile"
)

// Register sets up API routes on the given mux.
func Register(mux *http.ServeMux, store *orgfile.Store) {
	h := &handlers{store: store}

	mux.HandleFunc("/api/doc", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.getDoc(w, r)
		case http.MethodPut:
			h.putDoc(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
}
