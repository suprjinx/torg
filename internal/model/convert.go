package model

import (
	"strings"

	"github.com/niklasfasching/go-org/org"
)

// FromDocument converts a go-org Document into a flat item list.
func FromDocument(doc *org.Document) Items {
	var items Items
	walkSections(doc.Outline.Children, &items)
	return items
}

func walkSections(sections []*org.Section, items *Items) {
	for _, sec := range sections {
		if sec.Headline == nil {
			continue
		}
		h := sec.Headline
		*items = append(*items, Item{
			Level:  h.Lvl,
			Title:  inlineNodesToText(h.Title),
			Status: h.Status,
			Tags:   h.Tags,
			Body:   extractBody(h.Children),
		})
		walkSections(sec.Children, items)
	}
}

func inlineNodesToText(nodes []org.Node) string {
	var b strings.Builder
	for _, n := range nodes {
		switch v := n.(type) {
		case org.Text:
			b.WriteString(v.Content)
		case org.Emphasis:
			marker := emphasisMarker(v.Kind)
			b.WriteString(marker)
			b.WriteString(inlineNodesToText(v.Content))
			b.WriteString(marker)
		case org.RegularLink:
			if len(v.Description) > 0 {
				b.WriteString("[[")
				b.WriteString(v.URL)
				b.WriteString("][")
				b.WriteString(inlineNodesToText(v.Description))
				b.WriteString("]]")
			} else {
				b.WriteString("[[")
				b.WriteString(v.URL)
				b.WriteString("]]")
			}
		default:
			b.WriteString(n.String())
		}
	}
	return b.String()
}

func emphasisMarker(kind string) string {
	switch kind {
	case "bold":
		return "*"
	case "italic":
		return "/"
	case "underline":
		return "_"
	case "strikethrough":
		return "+"
	case "code":
		return "="
	case "verbatim":
		return "~"
	default:
		return ""
	}
}

func extractBody(children []org.Node) string {
	var parts []string
	for _, child := range children {
		switch child.(type) {
		case org.Headline:
			continue
		default:
			s := strings.TrimSpace(child.String())
			if s != "" {
				parts = append(parts, s)
			}
		}
	}
	return strings.Join(parts, "\n")
}
