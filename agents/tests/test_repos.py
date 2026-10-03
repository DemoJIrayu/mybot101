"""Multi-repo support: allowlist, host-side git, PR checkout, safety checks, opening PRs."""

import io
import os
import subprocess
import tarfile
from pathlib import Path

import pytest

from agent_team import cli, github, repos, safety
from agent_team.github import parse_pr
from agent_team.qa import pr_tree
from agent_team.repos import RepoError, Target, get_target, load_targets

ENV = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
       "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}  # fmt: skip


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True,
                          env=ENV).stdout.strip()  # fmt: skip


TOML = """
[repos."DemoJIrayu/Anne-AIChatbot"]
protected = [".github/", "infra/", "deploy/"]

[repos."DemoJIrayu/YourNorst"]
require_branch_protection = false
"""


@pytest.fixture
def repos_file(tmp_path):
    path = tmp_path / "repos.toml"
    path.write_text(TOML)
    return path


# ---- allowlist ------------------------------------------------------------------


def test_only_listed_repos_are_allowed(repos_file):
    assert get_target("DemoJIrayu/Anne-AIChatbot", repos_file).protected == (
        ".github/",
        "infra/",
        "deploy/",
    )
    for spelling in (
        "demojirayu/anne-aichatbot",
        "https://github.com/DemoJIrayu/Anne-AIChatbot.git",
    ):
        assert get_target(spelling, repos_file).name == "DemoJIrayu/Anne-AIChatbot"
    with pytest.raises(RepoError, match="isn't in infra/repos.toml"):
        get_target("someone/else", repos_file)


def test_defaults_and_self_repo(repos_file):
    targets = load_targets(repos_file)
    norst = targets["demojirayu/yournorst"]
    assert norst.protected == (".github/", "infra/") and norst.require_ci
    assert not norst.require_branch_protection
    me = get_target(None, repos_file)
    assert me.is_self and me.local_dir == repos.REPO_ROOT and "agents/" in me.protected
    assert not me.require_ci


def test_bad_names_are_rejected(tmp_path):
    bad = tmp_path / "r.toml"
    bad.write_text('[repos."not-a-repo"]\n')
    with pytest.raises(RepoError, match="owner/repo"):
        load_targets(bad)


def test_shipped_repos_file_is_valid():
    targets = load_targets()
    assert {"demojirayu/anne-aichatbot", "demojirayu/yournorst"} <= set(targets)


# ---- host-side git: a fake GitHub with a PR -------------------------------------


@pytest.fixture
def remote(tmp_path, monkeypatch):
    """A bare 'GitHub' repo with main + refs/pull/3/head, and your clone of it."""
    seed = tmp_path / "seed"
    seed.mkdir()
    git(seed, "init", "-q", "-b", "main")
    (seed / "app.ts").write_text("export const a = 1;\n")
    git(seed, "add", ".")
    git(seed, "commit", "-qm", "init")
    git(seed, "switch", "-qc", "feature")
    (seed / "app.ts").write_text("export const a = 2;\n")
    git(seed, "commit", "-qam", "feature")
    bare = tmp_path / "origin.git"
    git(tmp_path, "clone", "-q", "--bare", str(seed), str(bare))
    git(seed, "push", "-q", str(bare), "feature:refs/pull/3/head")

    monkeypatch.setenv("AGENT_REPOS_DIR", str(tmp_path / "agent-repos"))
    target = Target("DemoJIrayu/Anne-AIChatbot", (".github/",))
    git(tmp_path, "clone", "-q", str(bare), str(target.local_dir))
    return target, bare


def _files(tar_bytes):
    with tarfile.open(fileobj=io.BytesIO(tar_bytes)) as tar:
        return {m.name: tar.extractfile(m).read().decode() for m in tar if m.isfile()}


def test_open_pr_tree_is_the_pr_head(remote):
    target, _ = remote
    pr = parse_pr({"number": 3, "state": "OPEN", "headRefName": "feature", "baseRefName": "main"})
    tree, stat, diff = pr_tree(target, pr)
    assert _files(tree)["app.ts"] == "export const a = 2;\n"
    assert "app.ts" in stat and "+export const a = 2;" in diff


def test_merged_pr_tree_is_current_main(remote):
    target, _ = remote
    pr = parse_pr({"number": 3, "state": "MERGED", "headRefName": "feature", "baseRefName": "main"})
    tree, stat, _ = pr_tree(target, pr)
    assert _files(tree)["app.ts"] == "export const a = 1;\n"  # main, PR not merged in the fake
    assert "app.ts" in stat


def test_archive_has_no_git_metadata(remote):
    target, _ = remote
    names = _files(repos.archive(target, "origin/main"))
    assert names.keys() == {"app.ts"}


def test_open_pull_request_branches_from_base_and_pushes(remote, tmp_path, monkeypatch):
    target, bare = remote
    base_sha = repos.git(target, "rev-parse", "origin/main")
    started_on = git(target.local_dir, "rev-parse", "--abbrev-ref", "HEAD")
    patch = tmp_path / "change.patch"
    patch.write_text(
        "diff --git a/new.ts b/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/new.ts\n"
        "@@ -0,0 +1 @@\n+export const b = 3;\n"
    )
    created = {}
    monkeypatch.setattr(
        github, "create_pr", lambda repo, base, head, title, body: created.update(locals()) or "URL"
    )
    monkeypatch.setattr(repos, "git", lambda t, *a: git(t.local_dir, *a))  # with test identity

    url = cli.open_pull_request(
        target, "lead", "agent(lead): add b", "body", patch, "main", base_sha
    )

    assert url == "URL" and created["repo"] == "DemoJIrayu/Anne-AIChatbot"
    branch = created["head"]
    assert branch.startswith("agent/lead-") and created["base"] == "main"
    pushed = git(bare, "show", f"{branch}:new.ts")
    assert pushed == "export const b = 3;"
    assert git(bare, "rev-parse", f"{branch}~1") == base_sha  # built on what the agents saw
    assert git(target.local_dir, "rev-parse", "--abbrev-ref", "HEAD") == started_on  # restored


# ---- safety preflight ------------------------------------------------------------


class FakeRun:
    def __init__(self, ci=True, protected=True, protection_error="Not Found (HTTP 404)"):
        self.ci, self.protected, self.err = ci, protected, protection_error

    def __call__(self, args):
        if args[0] == "git":
            return subprocess.CompletedProcess(args, 0 if self.ci else 1, "", "")
        ok = self.protected
        return subprocess.CompletedProcess(args, 0 if ok else 1, "", "" if ok else self.err)


def test_preflight_passes_when_ci_and_protection_exist():
    t = Target("o/r", (".github/",))
    assert safety.preflight(t, "main", FakeRun()) == []


def test_preflight_reports_missing_ci_and_protection():
    t = Target("o/r", (".github/",))
    problems = safety.preflight(t, "main", FakeRun(ci=False, protected=False))
    assert len(problems) == 2
    assert safety.REUSABLE_WORKFLOW in problems[0]
    assert "protect-main.sh o/r" in problems[1]


def test_preflight_explains_private_repo_plan_limit():
    t = Target("o/private", (".github/",))
    err = "Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)"
    problems = safety.preflight(t, "main", FakeRun(protected=False, protection_error=err))
    assert "require_branch_protection = false" in problems[0]


def test_preflight_respects_per_repo_switches():
    t = Target("o/r", (".github/",), require_ci=False, require_branch_protection=False)
    assert safety.preflight(t, "main", FakeRun(ci=False, protected=False)) == []


def test_unknown_repo_stops_the_cli_before_any_work(monkeypatch, capsys):
    monkeypatch.setattr(cli, "settings_for", lambda role: (_ for _ in ()).throw(AssertionError))
    code = cli.main(["lead", "--repo", "evil/repo", "do things"])
    assert code == 2 and "isn't in infra/repos.toml" in capsys.readouterr().err


def test_path_is_inside_repo_root():
    assert Path(repos.REPOS_FILE).parent.name == "infra"


def test_options_can_come_before_the_goal(monkeypatch):
    seen = {}
    monkeypatch.setattr(cli, "run_lead", lambda goal, *a: seen.update(goal=goal, repo=a[-1]) or 0)
    assert cli.main(["lead", "--repo", "DemoJIrayu/Anne-AIChatbot", "Scaffold the app"]) == 0
    assert seen == {"goal": "Scaffold the app", "repo": "DemoJIrayu/Anne-AIChatbot"}
