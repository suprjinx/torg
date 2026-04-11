package git

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func run(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// EnsureRepo initializes a git repo in dir if one doesn't exist.
func EnsureRepo(dir string) error {
	gitDir := filepath.Join(dir, ".git")
	if _, err := os.Stat(gitDir); err == nil {
		return nil
	}
	if _, err := run(dir, "init"); err != nil {
		return fmt.Errorf("git init: %w", err)
	}
	// Add any existing org files
	run(dir, "add", "*.org")
	run(dir, "commit", "-m", "torg: initial commit", "--allow-empty")
	return nil
}

// CommitAll stages all changes and commits if there's anything to commit.
func CommitAll(dir, message string) error {
	out, _ := run(dir, "status", "--porcelain")
	if out == "" {
		return nil
	}
	if _, err := run(dir, "add", "-A"); err != nil {
		return fmt.Errorf("git add: %w", err)
	}
	if _, err := run(dir, "commit", "-m", message); err != nil {
		return fmt.Errorf("git commit: %w", err)
	}
	return nil
}

// MergeFile performs a three-way merge. Returns the merged content,
// whether conflict markers are present, and any error.
func MergeFile(oursContent, baseContent, theirsContent string) (string, bool, error) {
	tmpDir, err := os.MkdirTemp("", "torg-merge-")
	if err != nil {
		return "", false, err
	}
	defer os.RemoveAll(tmpDir)

	oursPath := filepath.Join(tmpDir, "ours")
	basePath := filepath.Join(tmpDir, "base")
	theirsPath := filepath.Join(tmpDir, "theirs")

	os.WriteFile(oursPath, []byte(oursContent), 0644)
	os.WriteFile(basePath, []byte(baseContent), 0644)
	os.WriteFile(theirsPath, []byte(theirsContent), 0644)

	cmd := exec.Command("git", "merge-file", "-p", oursPath, basePath, theirsPath)
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			// Conflicts exist but merge produced output
			return string(out), true, nil
		}
		return "", false, fmt.Errorf("git merge-file: %w", err)
	}
	return string(out), false, nil
}

func AutoSaveMessage() string {
	return fmt.Sprintf("torg: auto-save %s", time.Now().Format("2006-01-02 15:04:05"))
}

func ShutdownMessage() string {
	return fmt.Sprintf("torg: shutdown %s", time.Now().Format("2006-01-02 15:04:05"))
}
