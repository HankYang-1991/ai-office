#!/usr/bin/env python3
"""發布 data/gemini.json（內容有變才 commit + push）。不呼叫 API。

用法：
  python3 scripts/publish_gemini.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gemini_worker import main

if __name__ == "__main__":
    sys.exit(main(["--publish"]) or 0)
