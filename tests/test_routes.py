"""Coverage for routes.py — the plugin's progress store.

Run with: python3 tests/test_routes.py

These exercise the real FastAPI app through a real HTTP client, not mocked
request objects: the point of this file is that saving genuinely round-trips,
and a mock would happily agree with a broken implementation.
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient

import routes

URL = "/api/plugins/strum_fighter/progress"


def client_for(config_dir):
    app = FastAPI()
    routes.setup(app, {"config_dir": str(config_dir)})
    return TestClient(app)


class ProgressStore(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.config_dir = Path(self._tmp.name)
        self.client = client_for(self.config_dir)
        self.store = self.config_dir / "strum_fighter" / "progress.json"

    def tearDown(self):
        self._tmp.cleanup()

    def test_first_run_has_no_history_and_that_is_not_an_error(self):
        r = self.client.get(URL)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {})

    def test_progress_round_trips(self):
        payload = {"v": 2, "chords": {"-1,0,2,2,1,0": {"name": "Am", "box": 3}}}
        put = self.client.put(URL, json=payload)
        self.assertEqual(put.status_code, 200)
        self.assertTrue(put.json()["ok"])
        self.assertEqual(self.client.get(URL).json(), payload)
        # And it is genuinely on disk, not just in memory.
        self.assertEqual(json.loads(self.store.read_text()), payload)

    def test_a_second_save_replaces_the_first(self):
        self.client.put(URL, json={"v": 2, "chords": {"a": 1}})
        self.client.put(URL, json={"v": 2, "chords": {"b": 2}})
        self.assertEqual(self.client.get(URL).json(), {"v": 2, "chords": {"b": 2}})

    def test_a_new_client_sees_what_the_previous_one_saved(self):
        # The case that matters: quit the app, come back, progress is there.
        self.client.put(URL, json={"v": 2, "chords": {"x": 9}})
        fresh = client_for(self.config_dir)
        self.assertEqual(fresh.get(URL).json(), {"v": 2, "chords": {"x": 9}})

    def test_oversized_payloads_are_refused(self):
        big = {"v": 2, "pad": "x" * (routes.MAX_BYTES + 1000)}
        r = self.client.put(URL, json=big)
        self.assertEqual(r.status_code, 413)
        # The refusal must not have clobbered what was already stored.
        self.assertFalse(self.store.exists())

    def test_junk_is_refused_rather_than_stored(self):
        r = self.client.put(URL, content=b"not json at all",
                            headers={"content-type": "application/json"})
        self.assertEqual(r.status_code, 400)
        # A JSON array is valid JSON but not a progress object.
        r = self.client.put(URL, json=[1, 2, 3])
        self.assertEqual(r.status_code, 400)
        r = self.client.put(URL, json="a string")
        self.assertEqual(r.status_code, 400)
        self.assertFalse(self.store.exists())

    def test_a_corrupt_file_reads_as_no_history_rather_than_failing(self):
        # Losing the record is bad; refusing to start the game is worse.
        self.store.parent.mkdir(parents=True, exist_ok=True)
        self.store.write_text("{ truncated")
        self.assertEqual(self.client.get(URL).json(), {})
        # And it can be written over.
        self.client.put(URL, json={"v": 2})
        self.assertEqual(self.client.get(URL).json(), {"v": 2})

    def test_a_file_holding_a_non_object_reads_as_no_history(self):
        self.store.parent.mkdir(parents=True, exist_ok=True)
        self.store.write_text("[1,2,3]")
        self.assertEqual(self.client.get(URL).json(), {})

    def test_the_store_lands_under_the_config_dir_it_was_given(self):
        self.client.put(URL, json={"v": 2})
        self.assertTrue(self.store.exists(), f"expected {self.store} to exist")

    def test_no_temp_files_are_left_behind(self):
        for i in range(5):
            self.client.put(URL, json={"v": 2, "n": i})
        leftovers = [p.name for p in self.store.parent.iterdir() if p.name != "progress.json"]
        self.assertEqual(leftovers, [], f"stray files: {leftovers}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
