package orgfile

import (
	"encoding/json"
	"os"
	"strings"
	"sync"

	"github.com/niklasfasching/go-org/org"
)

// Store manages reading and writing an org file with concurrency safety.
// UI metadata (collapsed state) is stored in a .torg.json sidecar file.
type Store struct {
	path     string
	metaPath string
	mu       sync.RWMutex
	doc      *org.Document
	meta     Meta
	preamble string // text before the first heading, preserved on save
}

// Meta holds UI state that doesn't belong in the org file.
type Meta struct {
	Collapsed map[string]bool `json:"collapsed,omitempty"`
}

// NewStore opens (or creates) an org file and parses it into memory.
func NewStore(path string) (*Store, error) {
	s := &Store{
		path:     path,
		metaPath: path + ".meta.json",
	}
	if err := s.Load(); err != nil {
		return nil, err
	}
	return s, nil
}

// Load reads and parses the org file and sidecar from disk.
func (s *Store) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

func (s *Store) loadLocked() error {
	data, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		if err := os.WriteFile(s.path, []byte(""), 0644); err != nil {
			return err
		}
		data = []byte("")
	} else if err != nil {
		return err
	}

	// Extract preamble (everything before the first heading line)
	s.preamble = extractPreamble(string(data))

	conf := org.New()
	s.doc = conf.Parse(strings.NewReader(string(data)), s.path)

	// Load sidecar metadata
	s.meta = Meta{Collapsed: make(map[string]bool)}
	if metaData, err := os.ReadFile(s.metaPath); err == nil {
		json.Unmarshal(metaData, &s.meta)
		if s.meta.Collapsed == nil {
			s.meta.Collapsed = make(map[string]bool)
		}
	}

	return nil
}

// Save writes the org content to disk, then re-parses.
func (s *Store) Save(content string) error {
	if err := os.WriteFile(s.path, []byte(content), 0644); err != nil {
		return err
	}
	return s.loadLocked()
}

// SaveMeta writes the sidecar metadata to disk.
func (s *Store) SaveMeta(collapsed map[string]bool) error {
	s.meta.Collapsed = collapsed
	data, err := json.Marshal(s.meta)
	if err != nil {
		return err
	}
	return os.WriteFile(s.metaPath, data, 0644)
}

// Doc returns the parsed document.
func (s *Store) Doc() *org.Document { return s.doc }

// Collapsed returns the collapsed state map.
func (s *Store) Collapsed() map[string]bool { return s.meta.Collapsed }

func (s *Store) RLock()   { s.mu.RLock() }
func (s *Store) RUnlock() { s.mu.RUnlock() }
func (s *Store) Lock()    { s.mu.Lock() }
func (s *Store) Unlock()  { s.mu.Unlock() }
func (s *Store) Path() string     { return s.path }
func (s *Store) Preamble() string { return s.preamble }
func (s *Store) SetPreamble(p string) {
	s.preamble = p
}

// extractPreamble returns all text before the first org heading line,
// including the trailing newline so it can be directly prepended to heading output.
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
	return content // no headings at all
}
