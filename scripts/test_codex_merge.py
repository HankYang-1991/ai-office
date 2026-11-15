import datetime as dt
import unittest
from publish_usage import codex_entries, previous_codex, TZ
from merge_codex import merge

class QuotaTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime.now(TZ)
        self.snapshot = {'primary': {'remaining_pct': 34, 'reset_at': None}, 'secondary': None,
                         'updated_at': self.now.isoformat(), 'plan': 'PRIVATE', 'provider': 'PRIVATE', 'source': 'PRIVATE'}
    def test_allowlist_and_null(self):
        rows = codex_entries(self.snapshot, self.now)
        self.assertEqual(rows[0]['used'],66)
        self.assertEqual(rows[0]['window'],'primary')
        self.assertFalse(rows[1]['reported'])
        self.assertIsNone(rows[1]['limit'])
        self.assertNotIn('PRIVATE',str(rows))
    def test_failed_read_replaces_old_without_touching_team(self):
        team = {'agent_id':'codex-xiao-zhaowang','provider':'grok-bot','used':1,'share_pct':3}
        old = {'team':{'used_pct':1.6},'entries':[team]+codex_entries(self.snapshot,self.now)}
        result = merge(old,{'primary':None,'secondary':None,'updated_at':None},self.now)
        self.assertEqual(result['entries'][0],team)
        self.assertEqual(result['team'],old['team'])
        self.assertTrue(all(not e['reported'] and not e['connected'] for e in result['entries'][1:]))
        self.assertEqual(len(previous_codex(result,self.now)),2)
    def test_missing_timestamp_not_fabricated(self):
        self.snapshot['updated_at']=None
        row=codex_entries(self.snapshot,self.now)[0]
        self.assertEqual(row['updated_at'],'')
        self.assertTrue(row['stale'])
    def test_previous_does_not_duplicate_team(self):
        old={'entries':[{'agent_id':'codex-xiao-zhaowang','connected':True,'provider':'grok-bot'}]}
        self.assertIsNone(previous_codex(old,self.now))

if __name__=='__main__': unittest.main()
