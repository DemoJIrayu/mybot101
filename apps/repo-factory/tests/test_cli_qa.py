"""QA pass over the ``python -m repo_factory`` CLI (``repo_factory/__main__.py``).

``tests/test_cli.py`` patches ``load_manifest`` and ``subprocess.run`` away and
only checks the printed lines.  This file drives the real entry point (in
process and as a subprocess), so it also covers:

* dry-run must never spawn a process, not even the ``which("gh")`` probe;
* ``--apply`` order, and stopping at the first failing command;
* ``--apply`` on a machine without ``gh``: non-zero, clear message, nothing run;
* ``--apply`` with a fake ``gh`` on PATH: the argv handed to ``gh``, so a
  template or name can never be re-split by a shell;
* the ``template`` value is attacker-influenceable data (it can come from the
  checked-in manifest): it must be rejected, never executed as shell code;
* malformed manifests (JSON value that is not an object, ``repositories`` that
  is not a list) must fail with a clean message, not an interpreter traceback.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

from repo_factory.__main__ import main

APP_ROOT = Path(__file__).resolve().parent.parent


def write_manifest(directory: Path, payload: object) -> Path:
    path = directory / "repos.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def run_cli(*args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    """Run ``python -m repo_factory <args>`` as a real subprocess."""
    return subprocess.run(
        [sys.executable, "-m", "repo_factory", *args],
        cwd=APP_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def normalize(command: object) -> str:
    """Accept both a shell string and an argv list so the check survives a fix."""
    return command if isinstance(command, str) else " ".join(command)


def test_default_mode_only_prints_and_never_spawns_anything(
    monkeypatch, capsys, tmp_path
):
    manifest = write_manifest(
        tmp_path, {"default_visibility": "private", "repositories": ["r1", "r2"]}
    )

    def must_not_run(*args, **kwargs):
        raise AssertionError(f"dry-run must not execute anything, got {args!r}")

    monkeypatch.setattr(shutil, "which", must_not_run)
    monkeypatch.setattr(subprocess, "run", must_not_run)
    monkeypatch.setattr(sys, "argv", ["repo_factory", "--manifest", str(manifest)])

    assert main() == 0
    assert capsys.readouterr().out.splitlines() == [
        "gh repo create r1 --private",
        "gh repo create r2 --private",
    ]


def test_dry_run_on_the_shipped_manifest_prints_the_three_default_commands():
    """No arguments at all: the checked-in repos.json must drive the output."""
    result = run_cli()

    assert result.returncode == 0
    assert result.stdout.splitlines() == [
        "gh repo create noname-chatbot-api --private",
        "gh repo create noname-chatbot-web --private",
        "gh repo create noname-chatbot-admin --private",
    ]


def test_apply_runs_commands_in_order_and_stops_at_the_first_failure(
    monkeypatch, tmp_path
):
    manifest = write_manifest(
        tmp_path, {"repositories": ["r1", "r2", "r3"]}
    )
    executed = []

    def fake_run(command, **kwargs):
        executed.append(command)
        raise subprocess.CalledProcessError(returncode=3, cmd=command)

    monkeypatch.setattr(shutil, "which", lambda name: "/usr/bin/gh")
    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(
        sys, "argv", ["repo_factory", "--manifest", str(manifest), "--apply"]
    )

    assert main() == 3
    assert [normalize(command) for command in executed] == [
        "gh repo create r1 --private"
    ]


def test_apply_with_fake_gh_passes_one_argv_per_command(tmp_path):
    """A real (fake) ``gh`` on PATH must receive argv, not a shell string."""
    log = tmp_path / "argv.log"
    # pytest's tmp_path lives on /tmp, which is mounted noexec in the QA sandbox,
    # so the fake executable has to be created inside the checkout.
    bin_dir = Path(tempfile.mkdtemp(prefix=".qa-fake-gh-", dir=APP_ROOT))
    try:
        gh = bin_dir / "gh"
        gh.write_text(
            '#!/bin/sh\nfor arg in "$@"; do printf "%s\\n" "$arg"; done >> "$GH_LOG"\n',
            encoding="utf-8",
        )
        gh.chmod(0o755)
        manifest = write_manifest(
            tmp_path, {"default_visibility": "private", "repositories": ["r1", "r2"]}
        )
        env = {**os.environ, "PATH": str(bin_dir), "GH_LOG": str(log)}

        result = run_cli(
            "--manifest",
            str(manifest),
            "--template",
            "acme/default",
            "--apply",
            env=env,
        )
    finally:
        shutil.rmtree(bin_dir, ignore_errors=True)

    assert result.returncode == 0
    assert log.read_text(encoding="utf-8").splitlines() == [
        "repo",
        "create",
        "r1",
        "--private",
        "--template",
        "acme/default",
        "repo",
        "create",
        "r2",
        "--private",
        "--template",
        "acme/default",
    ]


def test_apply_without_gh_fails_non_zero_without_running_anything(tmp_path):
    manifest = write_manifest(tmp_path, {"repositories": ["r1"]})
    empty_bin = tmp_path / "empty-bin"
    empty_bin.mkdir()
    env = {**os.environ, "PATH": str(empty_bin)}

    result = run_cli("--manifest", str(manifest), "--apply", env=env)

    assert result.returncode == 1
    assert "gh" in result.stderr
    assert "not found" in result.stderr
    assert "Executing" not in result.stdout


@pytest.mark.xfail(
    strict=True,
    reason="BUG: a manifest whose JSON value is not an object exits with an "
    "uncaught TypeError traceback instead of a clean error message",
)
def test_manifest_that_is_not_a_json_object_gives_a_clean_error(tmp_path):
    payload = "[]"
    manifest = tmp_path / "repos.json"
    manifest.write_text(payload, encoding="utf-8")

    result = run_cli("--manifest", str(manifest))

    assert result.returncode == 1
    assert "Traceback" not in result.stderr
    assert "Error" in result.stderr


@pytest.mark.xfail(
    strict=True,
    reason="BUG: a non-list repositories value exits with an uncaught TypeError "
    "traceback instead of a clean error message",
)
def test_manifest_with_non_list_repositories_gives_a_clean_error(tmp_path):
    """``"repositories": "noname-chatbot-api"`` must not become 18 junk repos."""
    manifest = write_manifest(tmp_path, {"repositories": "noname-chatbot-api"})

    result = run_cli("--manifest", str(manifest))

    assert result.returncode == 1
    assert "Traceback" not in result.stderr
    assert "Error" in result.stderr
    # no junk repositories, not even the one-character ones
    assert "gh repo create" not in result.stdout


def test_manifest_supplied_template_with_shell_metacharacters_is_rejected(tmp_path):
    """The manifest is editable data; a payload in ``template`` must not run."""
    marker = tmp_path / "PWNED"
    manifest = write_manifest(
        tmp_path,
        {
            "default_visibility": "private",
            "template": f"acme/default; touch {marker}",
            "repositories": ["r1"],
        },
    )

    result = run_cli("--manifest", str(manifest), "--apply")

    assert result.returncode == 1
    assert result.stderr.strip() != ""
    assert "Error" in result.stderr
    assert "gh repo create" not in result.stdout
    assert not marker.exists(), "the template value was executed as shell code"


def test_apply_never_executes_the_template_value(monkeypatch, tmp_path):
    marker = tmp_path / "INJECTED"
    payload = f'acme/default; touch "{marker}"'
    manifest_payload = {
        "default_visibility": "private",
        "template": "",
        "repositories": ["r1"],
    }
    extra_args = ["--template", payload]
    manifest = write_manifest(tmp_path, manifest_payload)

    # Pretend gh is installed (the CLI only checks truthiness) but point it at a
    # path that does not exist, so the only thing that can create the marker is
    # the injected shell code itself.
    monkeypatch.setattr(shutil, "which", lambda name: "/nonexistent/gh")
    monkeypatch.setattr(
        sys,
        "argv",
        ["repo_factory", "--manifest", str(manifest), "--apply", *extra_args],
    )

    result = main()

    assert not marker.exists(), "the template value was executed as shell code"
    assert result != 0
