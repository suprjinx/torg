package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/suprjinx/torg/internal/api"
	"github.com/suprjinx/torg/internal/git"
	"github.com/suprjinx/torg/internal/orgfile"
	"github.com/suprjinx/torg/internal/server"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	flag.Parse()

	dir := "."
	if flag.NArg() > 0 {
		dir = flag.Arg(0)
	}

	// Ensure directory exists
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Fatalf("cannot create directory %s: %v", dir, err)
		}
	}

	store, err := orgfile.NewStore(dir)
	if err != nil {
		log.Fatalf("failed to open directory: %v", err)
	}

	// Idle commit timer — fires after 20 minutes of no saves
	idleTimer := time.NewTimer(20 * time.Minute)
	idleTimer.Stop()

	onSave := func() {
		idleTimer.Reset(20 * time.Minute)
	}

	mux := http.NewServeMux()
	api.Register(mux, store, onSave)
	server.RegisterStatic(mux)

	srv := &http.Server{Addr: *addr, Handler: mux}

	// Signal handling for graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	// Idle timer goroutine
	go func() {
		for {
			select {
			case <-idleTimer.C:
				if err := store.CommitCurrent(git.AutoSaveMessage()); err != nil {
					log.Printf("idle commit: %v", err)
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	host := *addr
	if strings.HasPrefix(host, ":") {
		host = "localhost" + host
	}
	url := "http://" + host

	fmt.Printf("torg listening on %s (dir: %s)\n", url, dir)
	openBrowser(url)

	go func() {
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	<-ctx.Done()
	fmt.Println("\nshutting down...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)

	// Final commit on shutdown
	if err := store.CommitCurrent(git.ShutdownMessage()); err != nil {
		log.Printf("shutdown commit: %v", err)
	}
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
