package model

import (
	"fmt"
	"strings"
)

// Item is a single outline entry in a flat ordered list.
type Item struct {
	Level      int               `json:"-"`
	IsBody     bool              `json:"-"`
	Title      string            `json:"title"`
	Status     string            `json:"status,omitempty"`
	Tags       []string          `json:"tags,omitempty"`
	Properties map[string]string `json:"properties,omitempty"`
}

// Items is the flat ordered list — the source of truth.
type Items []Item

// Node is a tree node for the API response (derived from Items for display).
type Node struct {
	ID         string            `json:"id"`
	Level      int               `json:"level"`
	IsBody     bool              `json:"isBody,omitempty"`
	Title      string            `json:"title"`
	Body       string            `json:"body,omitempty"`
	Status     string            `json:"status,omitempty"`
	Tags       []string          `json:"tags,omitempty"`
	Properties map[string]string `json:"properties,omitempty"`
	Children   []*Node           `json:"children"`
	Collapsed  bool              `json:"collapsed"`
}

// Outline is the API response.
type Outline struct {
	Nodes    []*Node `json:"nodes"`
	Preamble string  `json:"preamble,omitempty"`
	FocusID  string  `json:"focusId,omitempty"`
}

// ToTree converts the flat list into a nested tree for display.
// IDs are flat indices as strings. collapsed is keyed by flat index string.
func (items Items) ToTree(collapsed map[string]bool) *Outline {
	if len(items) == 0 {
		return &Outline{Nodes: []*Node{}}
	}

	// Build nodes for each item
	nodes := make([]*Node, len(items))
	for i, item := range items {
		nodes[i] = &Node{
			ID:         fmt.Sprintf("%d", i),
			Level:      item.Level,
			IsBody:     item.IsBody,
			Title:      item.Title,
			Status:     item.Status,
			Tags:       item.Tags,
			Properties: item.Properties,
			Children:   []*Node{},
			Collapsed:  collapsed[fmt.Sprintf("%d", i)],
		}
	}

	// Build tree using a stack
	var roots []*Node
	var stack []*Node // stack of ancestor nodes

	for _, n := range nodes {
		// Pop stack until we find a parent (lower level)
		for len(stack) > 0 && stack[len(stack)-1].Level >= n.Level {
			stack = stack[:len(stack)-1]
		}
		if len(stack) == 0 {
			roots = append(roots, n)
		} else {
			parent := stack[len(stack)-1]
			parent.Children = append(parent.Children, n)
		}
		stack = append(stack, n)
	}

	mergeBodyChildren(roots)
	return &Outline{Nodes: roots}
}

// mergeBodyChildren collects body child nodes into the parent's Body field
// and removes them from Children.
func mergeBodyChildren(nodes []*Node) {
	for _, n := range nodes {
		var bodyLines []string
		var headingChildren []*Node
		for _, c := range n.Children {
			if c.IsBody {
				bodyLines = append(bodyLines, c.Title)
			} else {
				headingChildren = append(headingChildren, c)
			}
		}
		if len(bodyLines) > 0 {
			n.Body = strings.Join(bodyLines, "\n")
		}
		n.Children = headingChildren
		mergeBodyChildren(n.Children)
	}
}

// SubtreeEnd returns the exclusive end index of the subtree rooted at idx.
// The subtree includes idx and all following items with level > items[idx].Level.
func (items Items) SubtreeEnd(idx int) int {
	level := items[idx].Level
	j := idx + 1
	for j < len(items) && items[j].Level > level {
		j++
	}
	return j
}

// PrevSibling returns the index of the previous sibling of items[idx]
// (same level, same parent), or -1 if at the first position.
func (items Items) PrevSibling(idx int) int {
	level := items[idx].Level
	for i := idx - 1; i >= 0; i-- {
		if items[i].Level == level {
			return i
		}
		if items[i].Level < level {
			return -1 // hit parent, no previous sibling
		}
	}
	return -1
}

// NextSibling returns the index of the next sibling of items[idx]
// (same level, same parent), or -1 if at the last position.
func (items Items) NextSibling(idx int) int {
	end := items.SubtreeEnd(idx)
	if end >= len(items) {
		return -1
	}
	if items[end].Level == items[idx].Level {
		return end
	}
	return -1 // hit lower level = parent boundary
}

// ParentIdx returns the index of the parent of items[idx], or -1 for root items.
func (items Items) ParentIdx(idx int) int {
	level := items[idx].Level
	for i := idx - 1; i >= 0; i-- {
		if items[i].Level < level {
			return i
		}
	}
	return -1
}
