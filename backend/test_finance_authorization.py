"""Exercise the real route and authorization functions without starting the app/database."""
import ast
import asyncio
from decimal import Decimal, InvalidOperation
from pathlib import Path
import re
import threading
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import Mock


class FinanceAuthorizationTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse(Path(__file__).with_name("main.py").read_text(encoding="utf-8"))
        constants = {"PUBLIC_AUTH", "READ_PATHS", "WRITE_PATHS", "COOKIE_NAME", "LOCAL_AUTH_SOURCE",
                     "SUPER_ADMIN_USERNAME", "SUPER_ADMIN_ROLE", "CHANNEL_USAGE_CATEGORIES"}
        functions = {"handle_api", "authorize_mapping_finance", "authorize_account_finance",
                     "ensure_managed_sub_account", "is_super_admin"}
        nodes = []
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in constants for t in node.targets):
                nodes.append(node)
            if isinstance(node, ast.ClassDef) and node.name == "BackendError":
                nodes.append(node)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in functions:
                node.decorator_list = []
                nodes.append(node)
        self.session = {"authenticated": True, "auth_source": "upstream", "role": "supplier",
                        "username": "parent", "upstream_user_id": 1}
        self.children = [{"id": 10}, {"id": 20}]
        self.effects = []
        def lookup(sql, params):
            return SimpleNamespace(fetchone=lambda: {"upstream_user_id": 10} if params == ("own", 1) else None)
        def settle(target, items, *, payer):
            self.assertEqual(payer["username"], self.session["username"])
            self.effects.append(("settle", target))
            return [{"settlement_amount": "5", "transaction_id": "tx"}]
        self.store = SimpleNamespace(
            lock=threading.RLock(), connection=SimpleNamespace(execute=lookup),
            get_session=lambda token: self.session, touch=lambda session: 3600,
            local_account_is_active=lambda *args: True,
            mapping_account_id=lambda name: {"own": 10, "foreign": 20}[name],
            managed_mapping_ids=lambda parent: {10}, admin_sync_enabled=lambda parent: True,
            channel_summary_for_mapping=lambda name: self.effects.append(("read", name)) or {"userId": 10},
            active_channel_summary_session_for_mapping=lambda name: self.effects.append(("sync", name)) or {},
            save_category_rates=lambda target, rates: self.effects.append(("rates", target)),
            record_settlements=settle,
            settlement_transactions=lambda target, **kwargs: [],
            delete_settlement_transaction=lambda target, tx: self.effects.append(("delete", target)),
        )
        async def upstream(*args, **kwargs):
            return self.children
        async def read_body(request):
            return request.body
        async def refresh(session):
            return None
        def failure(req, rid, error):
            if not hasattr(error, "status"):
                raise error
            return error.status
        self.ns = dict(re=re, uuid=uuid, Decimal=Decimal, InvalidOperation=InvalidOperation,
                       public_profile=lambda session: {**session, "user_id": session["upstream_user_id"], "display_name": session["username"]},
                       store=self.store, check_origin=lambda req: None, client_key=lambda req: "test",
                       authorized_json=upstream, read_body=read_body, refresh_channel_summary=refresh,
                       error_response=failure, success_response=lambda *args: 200,
                       category_rates_payload=lambda target: self.effects.append(("history", target)) or {},
                       settlement_record_payload=lambda row: row, sub_account_settlement_summary=lambda target: {},
                       dollar_amount=str)
        exec("from __future__ import annotations\n" + "\n".join(ast.unparse(n) for n in nodes), self.ns)

    def request(self, path, method="GET"):
        body = {"items": [{"category": "aws", "consumptionAmount": "10"}],
                "rates": {category: "50" for category in self.ns["CHANNEL_USAGE_CATEGORIES"]}}
        req = SimpleNamespace(method=method, cookies={}, query_params={}, body=body)
        return asyncio.run(self.ns["handle_api"](path, req))

    def test_settlement_pagination(self):
        self.store.settlement_transactions = Mock(side_effect=lambda target, limit, offset: [{"id": str(i)} for i in range(23)][offset:offset + limit])
        self.ns["success_response"] = lambda request, rid, data, cookie: data
        def page(value):
            request = SimpleNamespace(method="GET", cookies={}, query_params={"page": value}, body={})
            return asyncio.run(self.ns["handle_api"]("user-mappings/own/settlements", request))
        first, second, last = page("1"), page("2"), page("3")
        self.assertEqual([len(result["items"]) for result in [first, second, last]], [10, 10, 3])
        self.assertTrue(first["hasMore"])
        self.assertFalse(last["hasMore"])
        self.assertEqual(len({item["id"] for result in [first, second, last] for item in result["items"]}), 23)
        for invalid in ["0", "-1", "abc", "1000000"]:
            self.assertEqual(page(invalid), 400)

    def test_foreign_account_denied_on_every_finance_route(self):
        for path, methods in [("user-mappings/foreign/channel-usage", ["GET", "POST"]),
                              ("user-mappings/foreign/category-rates", ["GET", "PUT"]),
                              ("user-mappings/foreign/settlements", ["GET", "POST"]),
                              ("user-mappings/foreign/settlements/tx", ["DELETE"]),
                              ("sub-accounts/20/category-rates", ["GET", "PUT"]),
                              ("sub-accounts/1/category-rates", ["GET", "PUT"])]:
            for method in methods:
                with self.subTest(path=path, method=method):
                    self.assertEqual(self.request(path, method), 404)
                    self.assertEqual(self.effects, [])

    def test_own_child_view_sync_settle_and_rates(self):
        for path, methods in [("user-mappings/own/channel-usage", ["GET", "POST"]),
                              ("user-mappings/own/category-rates", ["GET", "PUT"]),
                              ("user-mappings/own/settlements", ["GET", "POST"]),
                              ("user-mappings/own/settlements/tx", ["DELETE"]),
                              ("sub-accounts/10/category-rates", ["GET", "PUT"])]:
            for method in methods:
                with self.subTest(path=path, method=method):
                    self.assertEqual(self.request(path, method), 200)
        self.assertIn(("settle", 10), self.effects)
        self.assertIn(("rates", 10), self.effects)

    def test_stale_local_ownership_is_denied(self):
        self.children = [{"id": 20}]
        self.assertEqual(self.request("user-mappings/own/settlements", "POST"), 404)
        self.assertEqual(self.effects, [])

    def test_subaccount_cannot_manage_finance(self):
        self.session["role"] = "sub"
        self.assertEqual(self.request("user-mappings/own/channel-usage"), 403)
        self.assertEqual(self.request("user-mappings/own/settlements", "POST"), 403)
        self.assertEqual(self.request("sub-accounts/10/category-rates", "PUT"), 403)
        self.assertEqual(self.effects, [])

    def test_unauthenticated_denied(self):
        self.session = None
        self.assertEqual(self.request("user-mappings/own/settlements", "POST"), 401)
        self.assertEqual(self.effects, [])

    def test_super_admin_can_manage_other_accounts(self):
        self.session.update(auth_source="local", role="super_admin", username="sanyeAdmin", local_account_id=1)
        self.assertEqual(self.request("user-mappings/foreign/channel-usage"), 200)
        self.assertEqual(self.request("user-mappings/foreign/category-rates", "PUT"), 200)
        self.assertEqual(self.request("user-mappings/foreign/settlements", "POST"), 200)
        self.assertIn(("settle", 20), self.effects)


if __name__ == "__main__":
    unittest.main()
