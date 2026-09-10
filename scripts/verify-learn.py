#!/usr/bin/env python3
"""Drive pstack learn through an actual terminal with isolated SQLite evidence."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import sqlite3
import struct
import subprocess
import tempfile
import termios
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--evidence", type=Path, default=Path(".audit/learn-terminal.txt"))
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
transcript = bytearray()


class Terminal:
    def __init__(self, command, width=120, height=32):
        self.master, self.slave = pty.openpty()
        self.before = termios.tcgetattr(self.slave)
        self.resize(width, height)
        self.process = subprocess.Popen(command, cwd=root, stdin=self.slave, stdout=self.slave, stderr=self.slave, env={**os.environ, "NO_COLOR": "1"})
        self.output = bytearray()

    def resize(self, width, height):
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack("HHHH", height, width, 0, 0))
        if hasattr(self, "process"):
            self.process.send_signal(signal.SIGWINCH)

    def wait(self, text, after=0, seconds=8):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if text.encode() in self.output[after:]:
                return
            if select.select([self.master], [], [], 0.1)[0]:
                try:
                    chunk = os.read(self.master, 65536)
                except OSError:
                    break
                self.output.extend(chunk)
                transcript.extend(chunk)
        raise AssertionError(f"Did not see {text!r}\n{self.output[after:].decode(errors='replace')}")

    def key(self, key, expected):
        start = len(self.output)
        os.write(self.master, key)
        self.wait(expected, start)

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
        self.process.wait(timeout=5)
        after = termios.tcgetattr(self.slave)
        assert after[3] & (termios.ICANON | termios.ECHO) == self.before[3] & (termios.ICANON | termios.ECHO), "terminal modes were not restored"
        os.close(self.master)
        os.close(self.slave)


try:
    with tempfile.TemporaryDirectory(prefix="pstack-learn-pty-") as tmp:
        temp = Path(tmp).resolve()
        db_path = temp / "opencode.db"
        db = sqlite3.connect(db_path)
        db.executescript("""
        CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
        CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, title TEXT);
        CREATE TABLE part (id TEXT PRIMARY KEY, session_id TEXT, message_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
        CREATE INDEX part_session_idx ON part(session_id);
        CREATE INDEX session_project_idx ON session(project_id);
        """)
        now = int(time.time() * 1000)
        db.execute("INSERT INTO project VALUES (?, ?)", ("test", str(root)))
        db.execute("INSERT INTO session VALUES (?, ?, NULL, ?, ?, ?, ?)", ("session-test", "test", str(root), now, now, "Design the terminal learner"))

        def add_load(number):
            event = {"type": "tool", "tool": "skill", "state": {"status": "completed", "input": {"name": "architect"}, "metadata": {"dir": str(root / "skills/architect")}, "time": {"end": now + number}}}
            db.execute("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)", (f"part-{number}", "session-test", "message", now, now + number, json.dumps(event)))
            db.commit()

        add_load(1)
        command = [str(root / "learn"), "--db", str(db_path), "--project", str(root)]
        report = subprocess.run([*command, "--json"], cwd=root, capture_output=True, check=True, timeout=20)
        snapshot = json.loads(report.stdout)
        assert len(snapshot["catalog"]["capabilities"]) >= 69
        assert snapshot["history"]["kind"] == "available"
        print("PASS complete JSON output through a pipe")
        terminal = Terminal(command)
        try:
            terminal.wait("pstack learn")
            terminal.key(b"/architect\r", "INVOKE")
            terminal.wait("loads 1")
            add_load(2)
            terminal.key(b"r", "loads 2")
            terminal.key(b"\r", "RECENT EXAMPLES")
            terminal.wait("Design the terminal learner")
            terminal.wait("skill(architect)")
            terminal.key(b"\x1b", "LOADS")
            terminal.key(b"?", "loads = successful skill tool loads")
            terminal.key(b"\x1b", "pstack learn")
            terminal.resize(80, 24)
            terminal.key(b"\x1b[C", "INVOKE")
            terminal.key(b"\x1b", "LOADS")
            terminal.key(b"/autopilot-stack\r", "Autopilot-stack")
            terminal.key(b"\r", "/poteto-mode")
            terminal.wait("No recorded examples")
            terminal.key(b"p", "\x1b[?1049l")
            terminal.process.wait(timeout=5)
            assert terminal.process.returncode == 0
        finally:
            terminal.close()
        print("PASS actual PTY search, refresh from second writer, help, resize, details, and prompt print")

        terminal = Terminal(command, 36, 10)
        try:
            terminal.wait("resize")
            terminal.resize(120, 32)
            terminal.wait("pstack learn")
            terminal.key(b"/q", "Search")
            terminal.key(b"\x03", "\x1b[?1049l")
            terminal.process.wait(timeout=5)
            assert terminal.process.returncode == 0
        finally:
            terminal.close()
        print("PASS tiny-terminal recovery and Ctrl-C during search restores terminal")
        db.close()
finally:
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_bytes(transcript)
    print(f"Terminal evidence: {args.evidence}")
