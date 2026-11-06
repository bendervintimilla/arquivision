"""Offline regression tests: never import the live SDK or call a provider."""
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

# Disable dotenv before import: tests must not load local credentials.
sys.path.insert(0, str(Path(__file__).resolve().parent))
with patch('dotenv.load_dotenv'), patch.dict('os.environ', {}, clear=True):
    spec = importlib.util.spec_from_file_location('video_app', Path(__file__).with_name('main.py'))
    main = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(main)


class VideoBudgetTests(unittest.TestCase):
    def setUp(self):
        self.client = main.app.test_client()
        self.network = patch('urllib.request.urlopen', side_effect=AssertionError('Network forbidden'))
        self.network.start()
        self.addCleanup(self.network.stop)
        self.provider = patch.object(main, 'get_gemini_client', side_effect=AssertionError('Provider forbidden'))
        self.get_client = self.provider.start()
        self.addCleanup(self.provider.stop)

    def authenticated(self, user_id, budget=(True, 0.0), body=None):
        # Exercise the real route body with a synthetic authenticated principal.
        with main.app.test_request_context('/api/generate-video', method='POST', json=body or {}):
            main.request.user_id = user_id
            with patch.object(main, 'check_user_budget', return_value=budget) as check:
                response, status = main.generate_video.__wrapped__()
                check.assert_called_once_with(user_id)
                return response.get_json(), status

    def test_unauthenticated_remains_401(self):
        response = self.client.post('/api/generate-video', json={})
        self.assertEqual(response.status_code, 401)
        self.get_client.assert_not_called()

    def test_over_budget_returns_429_before_sdk(self):
        data, status = self.authenticated('ordinary-test-user', (False, 25.123))
        self.assertEqual(status, 429)
        self.assertEqual(data['spent_today_usd'], 25.12)
        self.get_client.assert_not_called()

    def test_under_budget_is_contained_before_sdk(self):
        _, status = self.authenticated('ordinary-test-user')
        self.assertEqual(status, 503)
        self.get_client.assert_not_called()

    def test_monitoring_soft_fail_cannot_enable_video(self):
        with patch.object(main, 'SUPABASE_URL', 'https://budget.example.invalid'), \
                main.app.test_request_context('/api/generate-video', method='POST', json={}):
            main.request.user_id = 'ordinary-test-user'
            _, status = main.generate_video.__wrapped__()
        self.assertEqual(status, 503)
        self.get_client.assert_not_called()

    def test_missing_identity_fails_closed(self):
        _, status = self.authenticated(None)
        self.assertEqual(status, 503)
        self.get_client.assert_not_called()

    def test_no_client_controlled_owner_bypass(self):
        _, status = self.authenticated('ordinary-test-user', body={'user_id': main.OWNER_USER_ID})
        self.assertEqual(status, 503)
        self.get_client.assert_not_called()

    def test_owner_validation_still_works_without_provider(self):
        _, status = self.authenticated(main.OWNER_USER_ID)
        self.assertEqual(status, 400)
        self.get_client.assert_not_called()

    def test_owner_success_uses_only_fake_sdk(self):
        google = ModuleType('google')
        genai = ModuleType('google.genai')
        genai.types = SimpleNamespace(Image=Mock(), GenerateVideosConfig=Mock())
        google.genai = genai
        video = SimpleNamespace(video=SimpleNamespace(video_bytes=b'fake-video'))
        operation = SimpleNamespace(name='offline-operation', done=True, error=None,
                                    response=SimpleNamespace(generated_videos=[video]))
        client = Mock()
        client.models.generate_videos.return_value = operation
        with patch.dict(sys.modules, {'google': google, 'google.genai': genai}), \
                patch.object(main, 'get_gemini_client', return_value=client):
            with main.app.test_request_context('/api/generate-video', method='POST', json={'image': 'eA=='}):
                main.request.user_id = main.OWNER_USER_ID
                with patch.object(main, 'check_user_budget', return_value=(True, 0.0)):
                    response = main.generate_video.__wrapped__()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'video': 'data:video/mp4;base64,ZmFrZS12aWRlbw=='})
        client.models.generate_videos.assert_called_once()
        client.operations.get.assert_not_called()


if __name__ == '__main__':
    unittest.main()
