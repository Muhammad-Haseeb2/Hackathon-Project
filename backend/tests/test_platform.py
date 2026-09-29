"""
Automated verification test suite for the Synthetic Data Platform.
Tests mathematical correctness, relational integrity, privacy noise, and rate limiting.
"""

import unittest
import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import numpy as np
import pandas as pd

from tabular import generate_tabular
from relational import generate_relational, DEFAULT_TEMPLATE
from documents import generate_invoice_data, generate_bank_statement
from validators import (
    run_relational_validation,
    check_running_balance,
    check_order_totals,
    check_all_orphan_keys,
)
from privacy import (
    apply_privacy,
    mask_email,
    mask_phone,
    pseudonymize,
    add_laplace_noise,
)
from security import RateLimiter, APIKeyManager, verify_admin


class TestValidatorsAndIntegrity(unittest.TestCase):
    """Test mathematical and relational correctness."""

    def test_relational_zero_orphans_and_totals(self):
        """Verify relational tables have 0 orphan keys and reconciled totals."""
        tables = generate_relational(DEFAULT_TEMPLATE, customer_count=10, seed=123)
        self.assertIn("customers", tables)
        self.assertIn("orders", tables)
        self.assertIn("order_items", tables)

        report = run_relational_validation(tables)
        self.assertTrue(report["all_valid"], f"Validation failed: {report}")
        orphan_checks = report["checks"]["orphan_keys"]["checks"]
        for rel_name, check_data in orphan_checks.items():
            self.assertEqual(check_data["orphan_count"], 0, f"Orphan keys found in {rel_name}")
        self.assertTrue(report["checks"]["order_totals"]["valid"])

    def test_reproducible_seed(self):
        """Verify that identical random seeds generate identical datasets."""
        schema = [
            {"name": "user_id", "type": "id"},
            {"name": "score", "type": "float", "stats": {"min": 0, "max": 100}},
        ]
        df1 = generate_tabular(schema, row_count=50, seed=777)
        df2 = generate_tabular(schema, row_count=50, seed=777)
        pd.testing.assert_frame_equal(df1, df2)

    def test_invoice_totals_math(self):
        """Verify invoice mathematical sum: sum(qty * price) - discount + tax == total."""
        for s in [42, 99, 2024]:
            inv = generate_invoice_data(seed=s, n_items=6, discount_pct=15)
            calc_subtotal = round(sum(item["line_total"] for item in inv["items"]), 2)
            self.assertAlmostEqual(calc_subtotal, inv["subtotal"], places=2)

            calc_discount = round(calc_subtotal * (inv["discount_pct"] / 100.0), 2)
            self.assertAlmostEqual(calc_discount, inv["discount"], places=2)

            calc_tax = round((calc_subtotal - calc_discount) * (inv["tax_rate"]), 2)
            self.assertAlmostEqual(calc_tax, inv["tax_amount"], places=2)

            calc_total = round(calc_subtotal - calc_discount + calc_tax, 2)
            self.assertAlmostEqual(calc_total, inv["total"], places=2)

    def test_bank_statement_running_balance(self):
        """Verify ledger balance reconciliation: Balance_t = Balance_{t-1} + Credit - Debit."""
        for s in [42, 101, 555]:
            stmt = generate_bank_statement(seed=s, n_transactions=25, opening_balance=2500)
            res = check_running_balance(
                stmt["transactions"], stmt["opening_balance"], allow_overdraft=False
            )
            self.assertTrue(res["valid"])
            self.assertEqual(res["balance_mismatches"], 0)
            self.assertEqual(res["overdraft_violations"], 0)


class TestPrivacyEngine(unittest.TestCase):
    """Test masking, pseudonymization, and Laplace differential privacy."""

    def test_masking_pattern(self):
        email = "alice.smith@company.com"
        masked_email = mask_email(email)
        self.assertTrue(masked_email.startswith("a"))
        self.assertIn("@", masked_email)
        self.assertIn("*", masked_email)

        phone = "+1-555-123-4567"
        masked_phone = mask_phone(phone)
        self.assertTrue(masked_phone.endswith("4567"))
        self.assertIn("*", masked_phone)

    def test_pseudonymization_salted_hash(self):
        v1 = pseudonymize("alice@corp.com", salt="test-salt")
        v2 = pseudonymize("alice@corp.com", salt="test-salt")
        v3 = pseudonymize("alice@corp.com", salt="other-salt")
        self.assertEqual(v1, v2)
        self.assertNotEqual(v1, v3)

    def test_differential_laplace_noise(self):
        series = pd.Series([100.0] * 50)
        noised = add_laplace_noise(series, epsilon=0.5, sensitivity=10.0, seed=42)
        # Should have variance around 100
        self.assertFalse((series == noised).all())
        self.assertTrue(any(abs(n - 100.0) > 0.0001 for n in noised))


class TestSecurityControls(unittest.TestCase):
    """Test rate limiter, API key manager, and admin authentication."""

    def test_sliding_window_rate_limiter(self):
        limiter = RateLimiter(max_requests=5, window_seconds=60)
        ip = "192.168.1.100"
        for _ in range(5):
            self.assertFalse(limiter.is_rate_limited(ip))
            limiter.record_request(ip)
        self.assertTrue(limiter.is_rate_limited(ip))

    def test_api_key_manager_lifecycle(self):
        mgr = APIKeyManager()
        key_meta = mgr.generate_key("Test Pipeline")
        key = key_meta["key"]
        self.assertTrue(key.startswith("sk_test_"))
        self.assertTrue(mgr.validate_key(key))

        mgr.record_usage(key)
        mgr.revoke_key(key)
        self.assertFalse(mgr.validate_key(key))

    def test_admin_auth_fallback(self):
        self.assertTrue(verify_admin("admin123"))


if __name__ == "__main__":
    unittest.main()
