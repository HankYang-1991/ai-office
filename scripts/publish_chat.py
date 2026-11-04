#!/usr/bin/env python3
"""把全員群聊的真實對話寫進 data/chat.json，再 commit + push（網站每 30 秒讀一次）。

Hank 在 Grok Bot 發話 → 澳洲企鵝轉給被點名的夥伴 → 把夥伴的真實回覆用這支腳本發布。

用法（建議用 apply 一次寫完整輪，只產生一個 commit）：
  python3 scripts/publish_chat.py apply --file round.json
  python3 scripts/publish_chat.py new-round --title "週會" --user "大家這週進度如何？"   # 印出 round id
  python3 scripts/publish_chat.py add --round r3 --from "大主人-電機專案經理" --text "..."
  echo "多行回覆" | python3 scripts/publish_chat.py add --round r3 --from "codex -小沼王" --text -
  python3 scripts/publish_chat.py add --round r3 --from grok-bot --text-file reply.txt
  python3 scripts/publish_chat.py close --round r3
  python3 scripts/publish_chat.py note --text "群聊已接上真實 AI"         # 單獨一則系統訊息（自成一輪）

apply 檔案格式（單一輪；"round" 有給就把訊息附加到既有那一輪）：
  {"title": "自我介紹", "round": null, "started_at": "2026-11-04T16:40:00+08:00",
   "done": true,
   "messages": [
     {"from": "user",                 "text": "請大家自我介紹"},
     {"from": "大主人-電機專案經理",   "text": "...", "at": "2026-11-04T16:41:00+08:00"},
     {"from": "system",               "text": "小主人目前離線"}]}
  也接受 {"rounds": [ ...多輪... ]}。from 可填 user / Hank / system / agent id / 夥伴顯示名稱（開頭比對，忽略空白與 emoji）。
  at 沒給時用現在時間（台北時間 +08:00）；done 預設 true。

選項（放在子命令後面）：--no-push 只寫檔；--dry-run 只印出結果不寫檔。
推送需要環境變數 AI_OFFICE_GITHUB_TOKEN。最多保留最近 50 輪。
"""
import argparse, datetime as dt, json, os, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import publish_usage as pu  # 共用 norm / map_name / load_agents / git / TZ

REPO = pu.REPO
CHAT = REPO / "data" / "chat.json"
MAX_ROUNDS = 50
MAX_TEXT = 12000
USER_NAMES = {"user", "hank", "你", "hankyang"}
SYSTEM_NAMES = {"system", "系統"}


def now_iso():
    return dt.datetime.now(pu.TZ).replace(microsecond=0).isoformat()


def norm_time(v, what):
    if v in (None, ""):
        return now_iso()
    t = pu.parse_time(v)
    if t is None:
        pu.die(f"{what} 不是含時區的 ISO 8601 時間：{v!r}")
    return t.astimezone(pu.TZ).replace(microsecond=0).isoformat()


def resolve_from(name, agents):
    if not isinstance(name, str) or not name.strip():
        pu.die(f"from 不能是空的：{name!r}")
    s = name.strip()
    low = pu.norm(s)
    if low in USER_NAMES or s.lower() in USER_NAMES:
        return "user"
    if low in SYSTEM_NAMES or s.lower() in SYSTEM_NAMES:
        return "system"
    ids = {a["id"] for a in agents}
    if s in ids:
        return s
    aid = pu.map_name(s, agents)
    if aid is None:
        pu.die(f"對不到 Agent 的名稱「{s}」；可用 agent id：{', '.join(sorted(ids))}，或在 publish_usage.py 的 ALIASES 加別名")
    return aid


def clean_text(t):
    if not isinstance(t, str):
        pu.die("text 必須是字串")
    t = t.replace("\r\n", "\n").strip()
    if not t:
        pu.die("text 不能是空的")
    if len(t) > MAX_TEXT:
        t = t[:MAX_TEXT] + "…（已截斷）"
    return t


def load_chat():
    if CHAT.exists():
        try:
            d = json.loads(CHAT.read_text(encoding="utf-8"))
            if isinstance(d, dict) and isinstance(d.get("rounds"), list):
                d.setdefault("seq", max([rnum(r.get("id")) for r in d["rounds"]] + [0]))
                return d
        except Exception as e:
            pu.die(f"{CHAT} 不是有效 JSON：{e}")
    return dict(schema_version=1, is_demo=False, updated_at=now_iso(), seq=0, rounds=[])


def rnum(rid):
    m = re.fullmatch(r"r(\d+)", str(rid or ""))
    return int(m.group(1)) if m else 0


def find_round(chat, rid):
    for r in chat["rounds"]:
        if r.get("id") == rid:
            return r
    pu.die(f"找不到 round「{rid}」（可能已超過最近 {MAX_ROUNDS} 輪被移除）")


def new_round(chat, title, started_at=None):
    chat["seq"] = max(chat.get("seq", 0), max([rnum(r.get("id")) for r in chat["rounds"]] + [0])) + 1
    r = dict(id=f"r{chat['seq']}", title=(title or "群聊").strip()[:80], started_at=norm_time(started_at, "started_at"),
             messages=[], done=False)
    chat["rounds"].append(r)
    return r


def add_msg(r, frm, text, at, agents):
    m = {"from": resolve_from(frm, agents), "text": clean_text(text), "at": norm_time(at, "at")}
    if m["from"] not in ("user", "system") and frm.strip() != m["from"]:
        m["name"] = frm.strip()[:60]  # 原始顯示名稱
    r["messages"].append(m)
    return m


def apply_round(chat, obj, agents):
    if not isinstance(obj, dict):
        pu.die("每一輪必須是 JSON 物件")
    msgs = obj.get("messages")
    if not isinstance(msgs, list) or not msgs:
        pu.die("messages 必須是非空陣列")
    r = find_round(chat, obj["round"]) if obj.get("round") else new_round(chat, obj.get("title"), obj.get("started_at"))
    if obj.get("round") and obj.get("title"):
        r["title"] = str(obj["title"]).strip()[:80]
    for i, m in enumerate(msgs):
        if not isinstance(m, dict):
            pu.die(f"messages[{i}] 必須是物件")
        add_msg(r, m.get("from"), m.get("text"), m.get("at"), agents)
    r["done"] = bool(obj.get("done", True))
    return r


def main():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--no-push", action="store_true")
    common.add_argument("--dry-run", action="store_true")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("new-round", parents=[common]); p.add_argument("--title", required=True); p.add_argument("--user", help="Hank 的發言（第一則訊息）")
    p = sub.add_parser("add", parents=[common]); p.add_argument("--round", required=True); p.add_argument("--from", dest="frm", required=True)
    g = p.add_mutually_exclusive_group(required=True); g.add_argument("--text", help="訊息內容，- 代表 stdin"); g.add_argument("--text-file")
    p.add_argument("--at")
    p = sub.add_parser("close", parents=[common]); p.add_argument("--round", required=True)
    p = sub.add_parser("apply", parents=[common]); p.add_argument("--file", required=True, help="round JSON 檔，- 代表 stdin")
    p = sub.add_parser("note", parents=[common]); p.add_argument("--text", required=True); p.add_argument("--title", default="系統公告")
    a = ap.parse_args()

    push = not (a.no_push or a.dry_run)
    if push:
        if not os.environ.get("AI_OFFICE_GITHUB_TOKEN"):
            pu.die("沒有設定 AI_OFFICE_GITHUB_TOKEN")
        pu.git("pull", "--rebase", "--quiet", "origin", "main")
    agents = pu.load_agents()
    chat = load_chat()

    if a.cmd == "new-round":
        r = new_round(chat, a.title)
        if a.user:
            add_msg(r, "user", a.user, None, agents)
        summary = f"new round {r['id']}: {r['title']}"
    elif a.cmd == "add":
        r = find_round(chat, a.round)
        if a.text_file:
            text = Path(a.text_file).read_text(encoding="utf-8")
        else:
            text = sys.stdin.read() if a.text == "-" else a.text
        m = add_msg(r, a.frm, text, a.at, agents)
        summary = f"{r['id']} +{m['from']}"
    elif a.cmd == "close":
        r = find_round(chat, a.round)
        r["done"] = True
        summary = f"close {r['id']}"
    elif a.cmd == "note":
        r = new_round(chat, a.title)
        add_msg(r, "system", a.text, None, agents)
        r["done"] = True
        summary = f"note {r['id']}"
    else:  # apply
        try:
            raw = sys.stdin.read() if a.file == "-" else Path(a.file).read_text(encoding="utf-8")
            obj = json.loads(raw)
        except Exception as e:
            pu.die(f"讀不到 apply 檔案：{e}")
        items = obj["rounds"] if isinstance(obj, dict) and isinstance(obj.get("rounds"), list) else obj if isinstance(obj, list) else [obj]
        done = [apply_round(chat, o, agents) for o in items]
        r = done[-1]
        summary = "apply " + ", ".join(f"{x['id']}（{len(x['messages'])} 則）" for x in done)

    chat["rounds"] = chat["rounds"][-MAX_ROUNDS:]
    chat["updated_at"] = now_iso()
    chat["is_demo"] = False
    chat.setdefault("schema_version", 1)
    out = json.dumps(chat, ensure_ascii=False, indent=2) + "\n"
    if a.dry_run:
        print(out)
        print(r["id"])
        return
    CHAT.write_text(out, encoding="utf-8")
    if not push:
        print(r["id"])
        print(f"已寫入 {CHAT}（未 push）：{summary}", file=sys.stderr)
        return
    pu.git("add", "data/chat.json")
    pu.git("commit", "--quiet", "-m", f"chat: {summary} — {r['title']}"[:120])
    res = pu.git("push", "--quiet", "origin", "HEAD:main", check=False)
    if res.returncode != 0:
        pu.git("pull", "--rebase", "--quiet", "origin", "main")
        pu.git("push", "--quiet", "origin", "HEAD:main")
    sha = pu.git("rev-parse", "--short", "HEAD").stdout.strip()
    print(r["id"])
    print(f"已推送 {sha}：{summary}", file=sys.stderr)


if __name__ == "__main__":
    main()
