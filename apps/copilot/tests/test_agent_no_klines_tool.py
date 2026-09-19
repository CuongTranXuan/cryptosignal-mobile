"""Ensure pydantic-ai agent is built without get_klines (OmniRoute custom-tool hotfix)."""

import ast
from pathlib import Path


def test_agent_module_does_not_register_get_klines_tool():
    src = Path(__file__).resolve().parents[1] / "src" / "cryptosignal_copilot" / "agent.py"
    tree = ast.parse(src.read_text())
    tool_plain_fns = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for dec in node.decorator_list:
                if "tool_plain" in ast.unparse(dec):
                    tool_plain_fns.append(node.name)
    assert tool_plain_fns == [], (
        f"expected no @agent.tool_plain tools (OmniRoute custom reject); found {tool_plain_fns}"
    )
    # Live function body must not define get_klines (comments may still cite the name).
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            for child in ast.walk(node):
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) and child.name == "get_klines":
                    raise AssertionError("get_klines function still defined")
