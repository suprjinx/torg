package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/suprjinx/torg/internal/model"
	"github.com/suprjinx/torg/internal/orgfile"
)

type handlers struct {
	store *orgfile.Store
}

func (h *handlers) items() model.Items {
	return model.FromDocument(h.store.Doc())
}

func (h *handlers) save(items model.Items, focusIdx int) (*model.Outline, error) {
	content := h.store.Preamble() + items.ToOrg()
	if err := h.store.Save(content); err != nil {
		return nil, err
	}
	fresh := h.items()
	outline := fresh.ToTree(h.store.Collapsed())
	outline.Preamble = strings.TrimRight(h.store.Preamble(), "\n")
	if focusIdx >= 0 && focusIdx < len(fresh) {
		outline.FocusID = fmt.Sprintf("%d", focusIdx)
	}
	return outline, nil
}

func (h *handlers) getOutline(w http.ResponseWriter, r *http.Request) {
	h.store.RLock()
	defer h.store.RUnlock()
	outline := h.items().ToTree(h.store.Collapsed())
	outline.Preamble = strings.TrimRight(h.store.Preamble(), "\n")
	writeJSON(w, outline)
}

type updateReq struct {
	Title      *string            `json:"title"`
	Body       *string            `json:"body"`
	Properties *map[string]string `json:"properties"`
	Collapsed  *bool              `json:"collapsed"`
}

func (h *handlers) updateNode(w http.ResponseWriter, r *http.Request) {
	idx, ok := parseID(r.URL.Path, "/api/nodes/")
	if !ok {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	var req updateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.store.Lock()
	defer h.store.Unlock()

	items := h.items()
	if idx < 0 || idx >= len(items) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	if req.Title != nil {
		items[idx].Title = *req.Title
	}
	if req.Properties != nil {
		if len(*req.Properties) == 0 {
			items[idx].Properties = nil
		} else {
			items[idx].Properties = *req.Properties
		}
	}

	if req.Body != nil {
		bodyLevel := items[idx].Level + 1
		bodyIdx := idx + 1
		hasBody := bodyIdx < len(items) && items[bodyIdx].IsBody && items[bodyIdx].Level == bodyLevel

		if *req.Body == "" {
			if hasBody {
				items = append(items[:bodyIdx], items[bodyIdx+1:]...)
			}
		} else {
			if hasBody {
				items[bodyIdx].Title = *req.Body
			} else {
				items = insert(items, bodyIdx, model.Item{Level: bodyLevel, IsBody: true, Title: *req.Body})
			}
		}
	}

	// Handle collapsed state via sidecar
	if req.Collapsed != nil {
		collapsed := h.store.Collapsed()
		id := fmt.Sprintf("%d", idx)
		if *req.Collapsed {
			collapsed[id] = true
		} else {
			delete(collapsed, id)
		}
		h.store.SaveMeta(collapsed)
	}

	result, err := h.save(items, idx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, result)
}

type createReq struct {
	Title  string `json:"title"`
	IsBody bool   `json:"isBody,omitempty"`
}

func (h *handlers) createChild(w http.ResponseWriter, r *http.Request) {
	parentStr := extractSeg(r.URL.Path, "/api/nodes/", "/children")

	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.store.Lock()
	defer h.store.Unlock()

	items := h.items()

	if parentStr == "root" {
		// Append as level-1 item at the end
		items = append(items, model.Item{Level: 1, Title: req.Title})
		result, err := h.save(items, len(items)-1)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, result)
		return
	}

	idx, err := strconv.Atoi(parentStr)
	if err != nil || idx < 0 || idx >= len(items) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	newItem := model.Item{Level: items[idx].Level + 1, Title: req.Title, IsBody: req.IsBody}
	var insertIdx int
	if req.IsBody {
		// Body items go right after the parent heading (before sub-headings)
		insertIdx = idx + 1
		// Skip past any existing body items
		for insertIdx < len(items) && items[insertIdx].IsBody && items[insertIdx].Level == newItem.Level {
			insertIdx++
		}
	} else {
		// Regular children go at end of parent's subtree
		insertIdx = items.SubtreeEnd(idx)
	}
	items = insert(items, insertIdx, newItem)

	result, err2 := h.save(items, insertIdx)
	if err2 != nil {
		http.Error(w, err2.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, result)
}

func (h *handlers) createSibling(w http.ResponseWriter, r *http.Request) {
	afterStr := extractSeg(r.URL.Path, "/api/nodes/", "/sibling")
	idx, err := strconv.Atoi(afterStr)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}

	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.store.Lock()
	defer h.store.Unlock()

	items := h.items()
	if idx < 0 || idx >= len(items) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	newItem := model.Item{Level: items[idx].Level, Title: req.Title, IsBody: items[idx].IsBody}
	end := items.SubtreeEnd(idx)
	items = insert(items, end, newItem)

	result, err2 := h.save(items, end)
	if err2 != nil {
		http.Error(w, err2.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, result)
}

func (h *handlers) deleteNode(w http.ResponseWriter, r *http.Request) {
	idx, ok := parseID(r.URL.Path, "/api/nodes/")
	if !ok {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}

	h.store.Lock()
	defer h.store.Unlock()

	items := h.items()
	if idx < 0 || idx >= len(items) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	end := items.SubtreeEnd(idx)
	items = append(items[:idx], items[end:]...)

	focusIdx := idx - 1
	if focusIdx < 0 && len(items) > 0 {
		focusIdx = 0
	}

	result, err := h.save(items, focusIdx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, result)
}

type moveReq struct {
	Action string `json:"action"`
}

func (h *handlers) moveNode(w http.ResponseWriter, r *http.Request) {
	idStr := extractSeg(r.URL.Path, "/api/nodes/", "/move")
	idx, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}

	var req moveReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.store.Lock()
	defer h.store.Unlock()

	items := h.items()
	if idx < 0 || idx >= len(items) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	var newIdx int

	switch req.Action {
	case "move-up":
		newIdx = moveUp(items, idx)
	case "move-down":
		newIdx = moveDown(items, idx)
	case "indent":
		newIdx = indentItem(items, idx)
	case "outdent":
		newIdx = outdentItem(items, idx)
	default:
		http.Error(w, "invalid action", http.StatusBadRequest)
		return
	}

	// After indent, uncollapse the new parent so the item stays visible
	if req.Action == "indent" {
		parentIdx := items.ParentIdx(newIdx)
		if parentIdx >= 0 {
			collapsed := h.store.Collapsed()
			parentId := fmt.Sprintf("%d", parentIdx)
			if collapsed[parentId] {
				delete(collapsed, parentId)
				h.store.SaveMeta(collapsed)
			}
		}
	}

	result, err2 := h.save(items, newIdx)
	if err2 != nil {
		http.Error(w, err2.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, result)
}

// --- move operations (all mutate items in place, return new focus index) ---

func moveUp(items model.Items, idx int) int {
	end := items.SubtreeEnd(idx)
	block := end - idx // size of this subtree

	prev := items.PrevSibling(idx)
	if prev >= 0 {
		// Swap with previous sibling's subtree
		prevEnd := items.SubtreeEnd(prev)
		// block A = items[prev:prevEnd], block B = items[idx:end]
		// (prevEnd == idx since they're adjacent siblings)
		swapBlocks(items, prev, prevEnd, end)
		return prev
	}

	// At first child position — outdent: move before parent
	parent := items.ParentIdx(idx)
	if parent < 0 {
		return idx // already at root top
	}

	// Extract the subtree
	subtree := make(model.Items, block)
	copy(subtree, items[idx:end])

	// Adjust levels: match parent's level
	delta := items[parent].Level - subtree[0].Level
	for i := range subtree {
		subtree[i].Level += delta
	}

	// Remove from old position
	copy(items[idx:], items[end:])
	items2 := items[:len(items)-block]

	// Insert before parent (parent shifted because we removed items after it? No — idx > parent, so removing idx:end doesn't affect parent index)
	insertAt := parent
	final := make(model.Items, 0, len(items2)+block)
	final = append(final, items2[:insertAt]...)
	final = append(final, subtree...)
	final = append(final, items2[insertAt:]...)
	copy(items[:len(final)], final)

	return parent
}

func moveDown(items model.Items, idx int) int {
	end := items.SubtreeEnd(idx)
	block := end - idx

	next := items.NextSibling(idx)
	if next >= 0 {
		nextEnd := items.SubtreeEnd(next)
		// Swap: block A = items[idx:end], block B = items[next:nextEnd]
		swapBlocks(items, idx, end, nextEnd)
		return idx + (nextEnd - next)
	}

	// At last child position — outdent: move after parent's subtree
	parent := items.ParentIdx(idx)
	if parent < 0 {
		return idx // already at root bottom
	}

	parentEnd := items.SubtreeEnd(parent)

	// Extract the subtree
	subtree := make(model.Items, block)
	copy(subtree, items[idx:end])

	delta := items[parent].Level - subtree[0].Level
	for i := range subtree {
		subtree[i].Level += delta
	}

	// Remove from old position
	copy(items[idx:], items[end:])
	items2 := items[:len(items)-block]

	// Insert after parent's subtree (adjust for removal)
	insertAt := parentEnd - block
	final := make(model.Items, 0, len(items2)+block)
	final = append(final, items2[:insertAt]...)
	final = append(final, subtree...)
	final = append(final, items2[insertAt:]...)
	copy(items[:len(final)], final)

	return insertAt
}

func indentItem(items model.Items, idx int) int {
	if idx == 0 {
		return idx // can't indent first item
	}
	// Can only indent if previous item is at same or higher level
	prevLevel := items[idx-1].Level
	if items[idx].Level > prevLevel {
		return idx // already deeper than previous
	}

	end := items.SubtreeEnd(idx)
	for i := idx; i < end; i++ {
		items[i].Level++
	}
	return idx
}

func outdentItem(items model.Items, idx int) int {
	if items[idx].Level <= 1 {
		return idx // already at root level
	}
	end := items.SubtreeEnd(idx)
	for i := idx; i < end; i++ {
		items[i].Level--
	}
	return idx
}

// swapBlocks swaps two adjacent blocks: items[a:mid] and items[mid:b]
func swapBlocks(items model.Items, a, mid, b int) {
	// Reverse first block, reverse second block, reverse entire range
	reverse(items[a:mid])
	reverse(items[mid:b])
	reverse(items[a:b])
}

func reverse(s model.Items) {
	for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
		s[i], s[j] = s[j], s[i]
	}
}

func insert(items model.Items, at int, item model.Item) model.Items {
	items = append(items, model.Item{})
	copy(items[at+1:], items[at:])
	items[at] = item
	return items
}

// --- helpers ---

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func parseID(path, prefix string) (int, bool) {
	s := strings.TrimPrefix(path, prefix)
	if i := strings.Index(s, "/"); i >= 0 {
		return 0, false
	}
	n, err := strconv.Atoi(s)
	return n, err == nil
}

func extractSeg(path, prefix, suffix string) string {
	s := strings.TrimPrefix(path, prefix)
	s = strings.TrimSuffix(s, suffix)
	return s
}

func (h *handlers) updatePreamble(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.store.Lock()
	defer h.store.Unlock()

	// Normalize: ensure trailing newline if non-empty
	preamble := req.Text
	if preamble != "" && !strings.HasSuffix(preamble, "\n") {
		preamble += "\n"
	}
	h.store.SetPreamble(preamble)

	items := h.items()
	result, err := h.save(items, -1)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, result)
}
