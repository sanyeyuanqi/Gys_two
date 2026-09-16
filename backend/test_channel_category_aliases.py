"""Verify legacy upstream channel categories are canonicalized safely."""

import ast
from decimal import Decimal, InvalidOperation, localcontext
from pathlib import Path
import re
import unittest


class ChannelCategoryAliasTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source_path = Path(__file__).with_name("main.py")
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        constants = {
            "CHANNEL_SUMMARY_TOTAL_CATEGORY",
            "CHANNEL_USAGE_CATEGORIES",
            "CHANNEL_USAGE_CATEGORY_ALIASES",
        }
        functions = {
            "channel_summary_decimal",
            "channel_summary_integer",
            "canonical_channel_usage_category",
            "merge_channel_summary_rows",
            "normalize_channel_summary",
        }
        nodes: list[ast.stmt] = []
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id in constants
                for target in node.targets
            ):
                nodes.append(node)
            if isinstance(node, ast.ClassDef) and node.name == "BackendError":
                nodes.append(node)
            if isinstance(node, ast.FunctionDef) and node.name in functions:
                nodes.append(node)

        namespace = {
            "Decimal": Decimal,
            "InvalidOperation": InvalidOperation,
            "localcontext": localcontext,
            "re": re,
        }
        source = "from __future__ import annotations\n" + "\n".join(
            ast.unparse(node) for node in nodes
        )
        exec(compile(source, str(source_path), "exec"), namespace)
        cls.namespace = namespace

    def test_awsb_is_the_legacy_alias_for_aws(self):
        canonical = self.namespace["canonical_channel_usage_category"]

        self.assertEqual(canonical(" AWSB "), "aws")
        self.assertEqual(canonical("aws"), "aws")
        self.assertEqual(canonical("unknown"), "unknown")

    def test_normalization_merges_aws_and_awsb(self):
        normalize = self.namespace["normalize_channel_summary"]
        result = normalize(
            {
                "count": 5,
                "total_quota": "1500000",
                "categories": [
                    {"category": "awsb", "quota": "500000", "rows": 2, "alive_rows": 1},
                    {"category": "aws", "quota": "1000000", "rows": 3, "alive_rows": 2},
                ],
            }
        )

        self.assertEqual(
            result["categories"],
            [{
                "category": "aws",
                "quota": Decimal("1500000"),
                "rows": 5,
                "alive_rows": 3,
            }],
        )

    def test_existing_snapshot_rows_merge_under_canonical_category(self):
        merge = self.namespace["merge_channel_summary_rows"]
        rows = merge(
            [
                {"category": "awsb", "quota": "500000", "row_count": 2, "alive_rows": 1},
                {"category": "aws", "quota": "1000000", "row_count": 3, "alive_rows": 2},
                {"category": "openai", "quota": "250000", "row_count": 1, "alive_rows": 1},
            ]
        )

        self.assertEqual(rows[0]["category"], "aws")
        self.assertEqual(rows[0]["quota"], Decimal("1500000"))
        self.assertEqual(rows[0]["row_count"], 5)
        self.assertEqual(rows[0]["alive_rows"], 3)
        self.assertEqual(rows[1]["category"], "openai")

    def test_repeated_raw_category_is_still_rejected(self):
        normalize = self.namespace["normalize_channel_summary"]
        with self.assertRaises(self.namespace["BackendError"]):
            normalize(
                {
                    "count": 2,
                    "total_quota": "2",
                    "categories": [
                        {"category": "aws", "quota": "1", "rows": 1, "alive_rows": 1},
                        {"category": "aws", "quota": "1", "rows": 1, "alive_rows": 1},
                    ],
                }
            )


if __name__ == "__main__":
    unittest.main()
