package model

import (
	"fmt"
	"strings"
)

// ToOrg serializes the flat item list to org-mode format.
func (items Items) ToOrg() string {
	var b strings.Builder
	prevLevel := 0
	for _, item := range items {
		// Blank line before top-level headings (except the first)
		if item.Level <= prevLevel && item.Level == 1 && b.Len() > 0 {
			b.WriteString("\n")
		}

		stars := strings.Repeat("*", item.Level)
		if item.Status != "" {
			fmt.Fprintf(&b, "%s %s %s", stars, item.Status, item.Title)
		} else {
			fmt.Fprintf(&b, "%s %s", stars, item.Title)
		}
		if len(item.Tags) > 0 {
			fmt.Fprintf(&b, " :%s:", strings.Join(item.Tags, ":"))
		}
		b.WriteString("\n")

		if item.Body != "" {
			b.WriteString(item.Body)
			b.WriteString("\n")
		}

		prevLevel = item.Level
	}
	return b.String()
}

// CollapsedMap extracts collapsed state from a tree (for saving to sidecar).
func CollapsedFromTree(outline *Outline) map[string]bool {
	m := make(map[string]bool)
	var walk func([]*Node)
	walk = func(nodes []*Node) {
		for _, n := range nodes {
			if n.Collapsed {
				m[n.ID] = true
			}
			walk(n.Children)
		}
	}
	walk(outline.Nodes)
	return m
}
