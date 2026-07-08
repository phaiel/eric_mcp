#!/usr/bin/env python3
"""Call a tool on the Personal OS MCP server (Render).

Usage:
    mcp_call.py <tool-name>                # args = {}
    mcp_call.py <tool-name> '<json>'       # inline JSON args
    echo '<json>' | mcp_call.py <tool-name> -   # args from stdin

Prints the tool's text content to stdout. Exits 1 on tool error.
"""
import json
import os
import subprocess
import sys

BASE = os.environ.get(
    "MCP_BASE", "https://personal-os-mcp.onrender.com/mcp/cmrbfay0e00032eh39ymrpfw7"
)


def api_key() -> str:
    if os.environ.get("MCP_KEY"):
        return os.environ["MCP_KEY"]
    cfg = os.path.expanduser("~/home_niagara_mcp/.cursor/mcp.json")
    with open(cfg) as f:
        return json.load(f)["mcpServers"]["personal-os"]["headers"]["x-api-key"]


def main() -> int:
    tool = sys.argv[1]
    if len(sys.argv) > 2:
        raw = sys.stdin.read() if sys.argv[2] == "-" else sys.argv[2]
    else:
        raw = "{}"
    args = json.loads(raw)

    payload = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool, "arguments": args},
        }
    )
    out = subprocess.run(
        [
            "/usr/bin/curl",
            "-s",
            "--max-time",
            "180",
            "-X",
            "POST",
            BASE,
            "-H",
            f"x-api-key: {api_key()}",
            "-H",
            "Content-Type: application/json",
            "-H",
            "Accept: application/json, text/event-stream",
            "-d",
            payload,
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout

    for line in out.splitlines():
        if line.startswith("data: "):
            d = json.loads(line[6:])
            result = d.get("result", {})
            content = result.get("content", [{}])
            text = content[0].get("text", "") if content else ""
            if result.get("isError"):
                print("TOOL_ERROR:", text[:2000], file=sys.stderr)
                return 1
            # MCP-bridge connectors wrap the upstream MCP result as JSON text;
            # unwrap nested {"content":[{"type":"text","text":...}]} layers.
            while True:
                try:
                    inner = json.loads(text)
                except (json.JSONDecodeError, TypeError):
                    break
                if isinstance(inner, dict) and isinstance(inner.get("content"), list):
                    text = inner["content"][0].get("text", "")
                else:
                    break
            print(text)
            return 0
    print("NO_DATA:", out[:500], file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
