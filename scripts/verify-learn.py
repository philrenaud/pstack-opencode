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
import re
import codecs

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
        self.decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self.saved_cursor = (0, 0)
        self.row = self.col = 0
        self.pending = ""
        self.screen = [[" "] * width for _ in range(height)]

    def resize(self, width, height):
        self.width, self.height = width, height
        self.screen = [[" "] * width for _ in range(height)]
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack("HHHH", height, width, 0, 0))
        if hasattr(self, "process"):
            self.process.send_signal(signal.SIGWINCH)

    def consume(self, chunk):
        text = self.pending + self.decoder.decode(chunk)
        self.pending = ""
        while text:
            if text.startswith("\x1b["):
                match = re.match(r"\x1b\[([0-?]*)([ -/]*)([@-~])", text)
                if not match:
                    self.pending = text
                    return
                raw, _, code = match.groups()
                values = [int(v) if v.isdigit() else 0 for v in raw.lstrip("?<=>").split(";")]
                n = values[0] or 1
                if code in ("H", "f"):
                    self.row = n - 1
                    self.col = (values[1] if len(values) > 1 and values[1] else 1) - 1
                elif code == "G": self.col = n - 1
                elif code == "A": self.row = max(0, self.row - n)
                elif code == "B": self.row += n
                elif code == "C": self.col += n
                elif code == "D": self.col = max(0, self.col - n)
                elif code == "s": self.saved_cursor = (self.row, self.col)
                elif code == "u" and not raw: self.row, self.col = self.saved_cursor
                elif code == "J" and values[0] == 2: self.screen = [[" "] * self.width for _ in range(self.height)]
                elif code == "K" and 0 <= self.row < self.height:
                    start = 0 if values[0] == 2 else self.col
                    for col in range(max(0, start), self.width): self.screen[self.row][col] = " "
                text = text[match.end():]
                continue
            if text.startswith("\x1b]"):
                match = re.match(r"\x1b\].*?(?:\x07|\x1b\\)", text, re.S)
                if not match:
                    self.pending = text
                    return
                text = text[match.end():]
                continue
            if text[0] == "\x1b":
                if len(text) < 2:
                    self.pending = text
                    return
                text = text[2:]
                continue
            char, text = text[0], text[1:]
            if char == "\r": self.col = 0
            elif char == "\n": self.row += 1
            elif char >= " ":
                if 0 <= self.row < self.height and 0 <= self.col < self.width:
                    self.screen[self.row][self.col] = char
                self.col += 1

    def wait(self, text, after=0, seconds=8):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            visible = "\n".join("".join(row) for row in self.screen)
            if text.encode() in self.output[after:] or ("\x1b" not in text and text in visible):
                return
            if select.select([self.master], [], [], 0.1)[0]:
                try:
                    chunk = os.read(self.master, 65536)
                except OSError:
                    break
                self.output.extend(chunk)
                transcript.extend(chunk)
                self.consume(chunk)
        raise AssertionError(f"Did not see {text!r}\n" + "\n".join("".join(row) for row in self.screen))

    def key(self, key, expected):
        start = len(self.output)
        os.write(self.master, key)
        time.sleep(0.2)
        while select.select([self.master], [], [], 0.05)[0]:
            chunk = os.read(self.master, 65536)
            self.output.extend(chunk)
            transcript.extend(chunk)
            self.consume(chunk)
        self.wait(expected, start)

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
        deadline = time.monotonic() + 5
        while self.process.poll() is None and time.monotonic() < deadline:
            if select.select([self.master], [], [], 0.1)[0]:
                try:
                    chunk = os.read(self.master, 65536)
                    transcript.extend(chunk)
                except OSError:
                    break
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
            raise AssertionError("learner did not exit on SIGTERM")
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
        CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
        CREATE INDEX part_session_idx ON part(session_id);
        CREATE INDEX session_project_idx ON session(project_id);
        """)
        now = int(time.time() * 1000)
        db.execute("INSERT INTO project VALUES (?, ?)", ("test", str(root)))
        db.execute("INSERT INTO session VALUES (?, ?, NULL, ?, ?, ?, ?)", ("session-test", "test", str(root), now, now, "Design the terminal learner"))
        for msg_id, role, offset in [("user", "user", -1000), ("message", "assistant", -500)]:
            db.execute("INSERT INTO message VALUES (?, ?, ?, ?)", (msg_id, "session-test", now + offset, json.dumps({"role": role})))
        db.execute("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)", ("user-text", "session-test", "user", now - 1000, now - 1000, json.dumps({"type": "text", "text": "Help me design this terminal learning dashboard."})))
        db.execute("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)", ("assistant-text", "session-test", "message", now - 500, now - 500, json.dumps({"type": "text", "text": "I will compare designs before implementing the learner."})))
        db.execute("INSERT INTO message VALUES (?, ?, ?, ?)", ("synthetic-user", "session-test", now - 600, json.dumps({"role": "user"})))
        db.execute("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)", ("synthetic-echo", "session-test", "synthetic-user", now - 600, now - 600, json.dumps({"type": "text", "synthetic": True, "text": "SYNTHETIC FILE BODY MUST NOT APPEAR"})))

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
        terminal = Terminal(command, 120, 24)
        try:
            terminal.wait("Catalog")
            capabilities = snapshot["catalog"]["capabilities"]
            target_name = capabilities[30]["name"]
            terminal.key(b"\x1b[B" * 30, target_name)
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                if select.select([terminal.master], [], [], 0.1)[0]:
                    chunk = os.read(terminal.master, 65536)
                    terminal.output.extend(chunk)
                    transcript.extend(chunk)
                    terminal.consume(chunk)
            left = "\n".join("".join(row[:58]) for row in terminal.screen[4:-3])
            selected_line = next((line for line in left.splitlines() if "›" in line), "")
            assert target_name[:10] in selected_line, f"Down selected {target_name} but left viewport did not reveal it: {left}"
            terminal.key(b"\x1b[6~", "Catalog")
            deadline = time.monotonic() + 1
            while time.monotonic() < deadline:
                if select.select([terminal.master], [], [], 0.1)[0]:
                    chunk = os.read(terminal.master, 65536)
                    terminal.output.extend(chunk)
                    transcript.extend(chunk)
                    terminal.consume(chunk)
            left = "\n".join("".join(row[:58]) for row in terminal.screen[4:-3])
            selected_line = next((line for line in left.splitlines() if "›" in line), "")
            assert capabilities[42]["name"][:10] in selected_line, f"PageDown did not reveal selected row: {left}"
            terminal.key(b"\x1b[F", "why")
            left = "\n".join("".join(row[:58]) for row in terminal.screen[4:-3])
            assert "why" in left and "architect" not in left, f"End did not scroll catalog: {left}"
            terminal.key(b"\x1b[H", "architect")
            terminal.key(b"q", "\x1b[?1049l")
            terminal.process.wait(timeout=5)
        finally:
            terminal.close()
        print("PASS real left catalog scrolling through Down, PageDown, End, and Home")
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
            terminal.key(b"\r", "EXACT CONTEXT")
            terminal.wait("Help me design this terminal learning dashboard.")
            terminal.wait("TOOL EVENT")
            assert b"SYNTHETIC FILE BODY MUST NOT APPEAR" not in terminal.output
            terminal.key(b"\x1b", "RECENT EXAMPLES")
            terminal.key(b"\x1b", "Catalog")
            terminal.key(b"?", "loads = successful skill tool loads")
            terminal.key(b"\x1b", "pstack learn")
            terminal.resize(80, 24)
            terminal.key(b"\x1b[C", "INVOKE")
            terminal.key(b"\x1b", "Catalog")
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
