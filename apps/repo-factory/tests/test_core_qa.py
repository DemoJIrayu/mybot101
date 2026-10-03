"""QA pass over ``repo_factory.core`` (manifest -> ``gh repo create`` commands).

``tests/test_core.py`` covers the documented happy paths.  This file goes after
the inputs a hand-edited manifest can realistically contain but the shipped
tests never produce: scalars where lists are expected and vice versa, wrong
element types, a missing ``repositories`` key, names that ``gh`` would read as
command-line options, and a ``template`` value that ends up spliced into a
string the CLI later hands to ``gh``.
"""

from __future__ import annotations

import shlex

import pytest

from repo_factory.core import build_commands


def test_boundary_valid_repository_names_are_accepted():
    """Every name the validator documents as valid must survive unchanged."""
    names = ["a", "0", ".template", "name.with.dots", "snake_case-99"]
    commands = build_commands({"repositories": names})
    assert commands == [f"gh repo create {name} --private" for name in names]


def test_command_template_splits_into_the_expected_argv():
    """Each built command must split back into plain arguments (no shell quoting)."""
    (command,) = build_commands(
        {"repositories": ["r1"]}, template="acme/default", visibility="public"
    )
    assert shlex.split(command) == [
        "gh",
        "repo",
        "create",
        "r1",
        "--public",
        "--template",
        "acme/default",
    ]


def test_repositories_value_that_is_a_string_is_rejected():
    """``"noname-chatbot-api"`` must not become 18 one-character repositories."""
    with pytest.raises((TypeError, ValueError)):
        build_commands({"repositories": "noname-chatbot-api"})


def test_repositories_value_that_is_a_mapping_is_rejected():
    with pytest.raises((TypeError, ValueError)):
        build_commands({"repositories": {"noname-chatbot-api": True}})


def test_non_string_repository_name_is_rejected():
    with pytest.raises((TypeError, ValueError)):
        build_commands({"repositories": [123]})


@pytest.mark.parametrize(
    "payload",
    [
        "acme/default; touch /tmp/pwned",
        "acme/default && touch /tmp/pwned",
        "acme/default | tee /tmp/pwned",
        "acme/default`touch /tmp/pwned`",
        "acme/default$(touch /tmp/pwned)",
        "acme/default\nrm -rf /tmp/pwned",
        "acme/default --public",
        "acme/default'",
        'acme/"default"',
    ],
)
def test_template_with_shell_metacharacters_is_rejected(payload):
    with pytest.raises(ValueError):
        build_commands({"repositories": ["r"]}, template=payload)


def test_repository_name_looking_like_a_flag_is_rejected():
    with pytest.raises(ValueError):
        build_commands({"repositories": ["--clone"]})
