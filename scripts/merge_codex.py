"""Merge an allowlisted quota snapshot into a review copy. Never commits or pushes."""
import argparse
import datetime as dt
import json
from pathlib import Path
from publish_usage import CODEX_ID, TZ, codex_entries


def merge(usage, snapshot, now):
    result = dict(usage)
    own = codex_entries(snapshot, now)
    if own is None:
        raise ValueError('Invalid quota snapshot')
    result['entries'] = [e for e in usage['entries'] if not (
        e.get('agent_id') == CODEX_ID and (e.get('scope') == 'own' or e.get('provider') in ('codex', 'openai-codex')))] + own
    return result


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('snapshot', type=Path)
    ap.add_argument('--usage', type=Path, default=Path(__file__).resolve().parent.parent / 'data/usage.json')
    ap.add_argument('--output', type=Path, required=True)
    args = ap.parse_args()
    result = merge(json.loads(args.usage.read_text(encoding='utf-8')),
                   json.loads(args.snapshot.read_text(encoding='utf-8')), dt.datetime.now(TZ))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
