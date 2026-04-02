package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"runtime"
	"strings"

	"github.com/suprjinx/torg/internal/api"
	"github.com/suprjinx/torg/internal/orgfile"
	"github.com/suprjinx/torg/internal/server"
)

func main() {
	filePath := flag.String("file", "outline.org", "path to the org file")
	addr := flag.String("addr", ":8080", "listen address")
	flag.Parse()

	store, err := orgfile.NewStore(*filePath)
	if err != nil {
		log.Fatalf("failed to open org file: %v", err)
	}

	mux := http.NewServeMux()
	api.Register(mux, store)
	server.RegisterStatic(mux)

	host := *addr
	if strings.HasPrefix(host, ":") {
		host = "localhost" + host
	}
	url := "http://" + host

	fmt.Printf("torg listening on %s (file: %s)\n", url, *filePath)
	openBrowser(url)
	log.Fatal(http.ListenAndServe(*addr, mux))
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	cmd.Start()
}
