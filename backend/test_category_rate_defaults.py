"""Verify unset category rates use the product default without starting the app."""

import ast
from decimal import Decimal, InvalidOperation
from pathlib import Path
import threading
from types import SimpleNamespace
import unittest


class CategoryRateDefaultTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source_path = Path(__file__).with_name("main.py")
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        nodes: list[ast.stmt] = []
        category_rates_method: ast.FunctionDef | None = None

        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name)
                and target.id in {
                    "CHANNEL_USAGE_CATEGORIES",
                    "DEFAULT_CATEGORY_RATE_PERCENT",
                }
                for target in node.targets
            ):
                nodes.append(node)
            if isinstance(node, ast.ClassDef) and node.name == "SessionStore":
                category_rates_method = next(
                    item
                    for item in node.body
                    if isinstance(item, ast.FunctionDef)
                    and item.name == "category_rates"
                )

        if category_rates_method is None:
            raise AssertionError("SessionStore.category_rates was not found")

        nodes.append(
            ast.ClassDef(
                name="SessionStore",
                bases=[],
                keywords=[],
                body=[category_rates_method],
                decorator_list=[],
            )
        )
        namespace = {
            "Decimal": Decimal,
            "InvalidOperation": InvalidOperation,
        }
        module = ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[]))
        exec(compile(module, str(source_path), "exec"), namespace)
        cls.namespace = namespace

    def store_with_rows(self, rows):
        store = object.__new__(self.namespace["SessionStore"])
        store.lock = threading.RLock()
        store.connection = SimpleNamespace(
            execute=lambda *args: SimpleNamespace(fetchall=lambda: rows)
        )
        return store

    def test_unset_categories_default_to_zero_percent(self):
        rates = self.store_with_rows([]).category_rates(2725)

        self.assertEqual(set(rates), set(self.namespace["CHANNEL_USAGE_CATEGORIES"]))
        self.assertTrue(all(rate == Decimal(0) for rate in rates.values()))

    def test_saved_rate_is_preserved_while_other_categories_default_to_zero(self):
        rates = self.store_with_rows(
            [{"category": "aws", "rate_percent": "37.5"}]
        ).category_rates(2725)

        self.assertEqual(rates["aws"], Decimal("37.5"))
        self.assertEqual(rates["openai"], Decimal(0))

    def test_invalid_saved_rate_falls_back_to_zero(self):
        rates = self.store_with_rows(
            [{"category": "aws", "rate_percent": "not-a-number"}]
        ).category_rates(2725)

        self.assertEqual(rates["aws"], Decimal(0))


if __name__ == "__main__":
    unittest.main()
