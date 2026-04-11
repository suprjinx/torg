package orgfile

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/niklasfasching/go-org/org"
	"github.com/suprjinx/torg/internal/git"
)

// Store manages a directory of org files with hash-based change detection.
type Store struct {
	dir    string
	mu     sync.RWMutex
	active map[string]*FileState
}

// FileState holds the parsed state and merge base for a single file.
type FileState struct {
	Doc         *org.Document
	Preamble    string
	Meta        Meta
	BaseHash    string // SHA-256 of content at time of load/last save
	BaseContent string // content at time of load/last save (merge ancestor)
}

// Meta holds UI state stored in a sidecar file.
type Meta struct {
	Collapsed map[string]bool `json:"collapsed,omitempty"`
}

// NewStore opens a directory, ensures it's a git repo, and commits current state.
func NewStore(dir string) (*Store, error) {
	info, err := os.Stat(dir)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, os.ErrInvalid
	}

	if err := git.EnsureRepo(dir); err != nil {
		return nil, err
	}

	// Commit current state as base snapshot
	git.CommitAll(dir, "torg: snapshot base")

	return &Store{
		dir:    dir,
		active: make(map[string]*FileState),
	}, nil
}

// Dir returns the directory path.
func (s *Store) Dir() string { return s.dir }

// ListFiles returns sorted .org filenames in the directory.
func (s *Store) ListFiles() ([]string, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".org") {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files)
	return files, nil
}

// LoadFile reads and parses an org file, storing its content as the merge base.
func (s *Store) LoadFile(name string) (*FileState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	path := filepath.Join(s.dir, name)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	content := string(data)
	preamble := strings.TrimRight(extractPreamble(content), "\n")

	conf := org.New()
	doc := conf.Parse(strings.NewReader(content), path)

	meta := loadMeta(path + ".meta.json")

	fs := &FileState{
		Doc:         doc,
		Preamble:    preamble,
		Meta:        meta,
		BaseHash:    contentHash(content),
		BaseContent: content,
	}
	s.active[name] = fs
	return fs, nil
}

// SaveFile writes content to disk with hash-based conflict detection.
// If the file changed on disk since our base, performs a three-way merge.
// Returns the new hash and whether conflict markers are present.
func (s *Store) SaveFile(name, content string) (newHash string, conflict bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	path := filepath.Join(s.dir, name)
	fs := s.active[name]

	// Read what's currently on disk
	diskData, diskErr := os.ReadFile(path)
	if diskErr != nil && !os.IsNotExist(diskErr) {
		return "", false, diskErr
	}
	diskContent := string(diskData)
	diskHash := contentHash(diskContent)

	// Did the file change externally since we last loaded/saved?
	if fs != nil && diskHash != fs.BaseHash {
		// External edit detected — three-way merge
		merged, hasConflicts, mergeErr := git.MergeFile(content, fs.BaseContent, diskContent)
		if mergeErr != nil {
			return "", false, mergeErr
		}
		if err := os.WriteFile(path, []byte(merged), 0644); err != nil {
			return "", false, err
		}
		h := contentHash(merged)
		fs.BaseHash = h
		fs.BaseContent = merged
		fs.Doc = parseOrg(merged, path)
		fs.Preamble = strings.TrimRight(extractPreamble(merged), "\n")
		return h, hasConflicts, nil
	}

	// No external changes — just overwrite
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return "", false, err
	}
	h := contentHash(content)
	if fs != nil {
		fs.BaseHash = h
		fs.BaseContent = content
		fs.Doc = parseOrg(content, path)
		fs.Preamble = strings.TrimRight(extractPreamble(content), "\n")
	}
	return h, false, nil
}

// CreateFile creates a new empty org file.
func (s *Store) CreateFile(name string) error {
	path := filepath.Join(s.dir, name)
	if _, err := os.Stat(path); err == nil {
		return os.ErrExist
	}
	return os.WriteFile(path, []byte(""), 0644)
}

// SaveMeta writes collapsed state to the sidecar file.
func (s *Store) SaveMeta(name string, collapsed map[string]bool) {
	path := filepath.Join(s.dir, name) + ".meta.json"
	data, _ := json.Marshal(Meta{Collapsed: collapsed})
	os.WriteFile(path, data, 0644)
}

// --- helpers ---

func contentHash(content string) string {
	h := sha256.Sum256([]byte(content))
	return hex.EncodeToString(h[:])
}

func extractPreamble(content string) string {
	lines := strings.Split(content, "\n")
	for i, line := range lines {
		if len(line) > 0 && line[0] == '*' {
			if i == 0 {
				return ""
			}
			return strings.Join(lines[:i], "\n") + "\n"
		}
	}
	return content
}

func parseOrg(content, path string) *org.Document {
	conf := org.New()
	return conf.Parse(strings.NewReader(content), path)
}

func loadMeta(path string) Meta {
	meta := Meta{Collapsed: make(map[string]bool)}
	if data, err := os.ReadFile(path); err == nil {
		json.Unmarshal(data, &meta)
		if meta.Collapsed == nil {
			meta.Collapsed = make(map[string]bool)
		}
	}
	return meta
}
