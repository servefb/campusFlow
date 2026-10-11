import os
import shlex
import subprocess
from langchain.tools import tool

@tool
def run_openwiki(command: str) -> str:
    """Run an OpenWiki CLI command to generate or update repository documentation."""
    try:
        # shlex 切分：`--update "带空格的说明"` 才能作为一个参数传进去；
        # 切不开（引号不配对等）就退回朴素 split，只降级不抛
        try:
            args = shlex.split(command)
        except ValueError:
            args = command.split()
        result = subprocess.run(
            ["npx", "openwiki"] + args,
            capture_output=True,
            text=True,
            timeout=600,
            cwd=os.getcwd(),
            shell=True # npx 在 Windows 上同样需要 shell=True 或寻找 npx.cmd
        )
        return (result.stdout or result.stderr)[:8000]
    except Exception as e:  # noqa: BLE001 —— 辅助步骤只降级
        return f"openwiki 命令执行失败：{e!r}"