"""
Relational data generator — parent/child with referential integrity.
Generates linked tables: Customers → Orders → Order Items.
Supports both template-based generation and statistical learning mode:
  - Learns orders per customer distribution
  - Learns items per order distribution
  - Learns item quantity distribution
  - Learns category-specific unit price distributions
All math strictly computed in Python. Zero orphan foreign keys guaranteed.
"""

import io
import uuid
import sqlite3
import zipfile
from pathlib import Path
import numpy as np
import pandas as pd
from faker import Faker
from typing import Optional

from locales import get_safe_faker
from fallbacks import PRODUCT_NAMES, CATEGORIES


# ── Built-in Relational Sample Directory ──────────────────────────────────────
RELATIONAL_SAMPLE_DIR = Path(__file__).resolve().parent / "sample_data" / "relational"


# ── Default Templates ────────────────────────────────────────────────────────

DEFAULT_TEMPLATE = {
    'name': 'E-Commerce',
    'tables': [
        {
            'name': 'customers',
            'columns': [
                {'name': 'customer_id', 'type': 'id'},
                {'name': 'name', 'type': 'name'},
                {'name': 'email', 'type': 'email'},
                {'name': 'phone', 'type': 'phone'},
                {'name': 'city', 'type': 'address'},
                {'name': 'signup_date', 'type': 'datetime', 'stats': {'min': '2020-01-01', 'max': '2024-12-31'}},
            ],
            'primary_key': 'customer_id',
        },
        {
            'name': 'orders',
            'columns': [
                {'name': 'order_id', 'type': 'id'},
                {'name': 'customer_id', 'type': 'fk', 'references': 'customers.customer_id'},
                {'name': 'order_date', 'type': 'datetime', 'stats': {'min': '2023-01-01', 'max': '2024-12-31'}},
                {'name': 'status', 'type': 'categorical', 'stats': {'categories': {'completed': 0.6, 'processing': 0.2, 'shipped': 0.15, 'cancelled': 0.05}}},
                {'name': 'discount', 'type': 'float', 'stats': {'min': 0, 'max': 50, 'mean': 5, 'std': 10}},
                {'name': 'tax_rate', 'type': 'float', 'stats': {'min': 0.05, 'max': 0.12, 'mean': 0.08, 'std': 0.02}},
            ],
            'primary_key': 'order_id',
            'parent_ratio': {'min': 1, 'max': 5},  # 1-5 orders per customer
        },
        {
            'name': 'order_items',
            'columns': [
                {'name': 'item_id', 'type': 'id'},
                {'name': 'order_id', 'type': 'fk', 'references': 'orders.order_id'},
                {'name': 'product_name', 'type': 'product'},
                {'name': 'category', 'type': 'category_pick'},
                {'name': 'quantity', 'type': 'integer', 'stats': {'min': 1, 'max': 10, 'mean': 2, 'std': 2}},
                {'name': 'unit_price', 'type': 'float', 'stats': {'min': 5.0, 'max': 500.0, 'mean': 50, 'std': 60}},
            ],
            'primary_key': 'item_id',
            'parent_ratio': {'min': 1, 'max': 4},  # 1-4 items per order
        },
    ],
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  RELATIONAL STATISTICAL LEARNER (STEP 6)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class RelationalLearnedModel:
    """Stores empirical distributions learned from real relational data."""

    def __init__(self):
        # 1. Orders per customer
        self.orders_per_cust_samples: np.ndarray = np.array([1, 2, 3])
        self.orders_per_cust_stats: dict = {}

        # 2. Items per order
        self.items_per_order_samples: np.ndarray = np.array([1, 2])
        self.items_per_order_stats: dict = {}

        # 3. Quantity distribution
        self.quantity_samples: np.ndarray = np.array([1, 2])
        self.quantity_stats: dict = {}

        # 4. Category and unit price per category
        self.categories: list[str] = []
        self.category_probs: list[float] = []
        self.category_quantiles: dict[str, np.ndarray] = {}  # cat -> 50 quantile points
        self.category_price_stats: dict[str, dict] = {}
        self.products_by_category: dict[str, list[str]] = {}

        # Additional learned distributions
        self.order_status_probs: dict[str, float] = {}
        self.discount_samples: np.ndarray = np.array([0.0])
        self.tax_rate_choices: list[float] = [0.08]
        self.city_probs: dict[str, float] = {}

    def to_summary_dict(self) -> dict:
        return {
            "orders_per_customer": self.orders_per_cust_stats,
            "items_per_order": self.items_per_order_stats,
            "quantity": self.quantity_stats,
            "categories": {
                cat: self.category_price_stats.get(cat, {})
                for cat in self.categories
            },
        }


def learn_relational_distributions(
    customers_df: pd.DataFrame,
    orders_df: pd.DataFrame,
    order_items_df: pd.DataFrame,
) -> RelationalLearnedModel:
    """
    Learn statistical distributions from a set of real relational tables:
      1. number of orders per customer (distribution)
      2. items per order (distribution)
      3. quantity distribution
      4. unit price distribution per product category
    """
    model = RelationalLearnedModel()

    # 1. Number of orders per customer
    if "customer_id" in orders_df.columns:
        orders_per_cust = orders_df.groupby("customer_id").size().values.astype(int)
        if len(orders_per_cust) == 0:
            orders_per_cust = np.array([1])
    else:
        orders_per_cust = np.array([1, 2])

    model.orders_per_cust_samples = orders_per_cust
    model.orders_per_cust_stats = {
        "mean": round(float(np.mean(orders_per_cust)), 2),
        "median": float(np.median(orders_per_cust)),
        "std": round(float(np.std(orders_per_cust)), 2),
        "min": int(np.min(orders_per_cust)),
        "max": int(np.max(orders_per_cust)),
    }

    # 2. Items per order
    if "order_id" in order_items_df.columns:
        items_per_order = order_items_df.groupby("order_id").size().values.astype(int)
        if len(items_per_order) == 0:
            items_per_order = np.array([1])
    else:
        items_per_order = np.array([1, 2])

    model.items_per_order_samples = items_per_order
    model.items_per_order_stats = {
        "mean": round(float(np.mean(items_per_order)), 2),
        "median": float(np.median(items_per_order)),
        "std": round(float(np.std(items_per_order)), 2),
        "min": int(np.min(items_per_order)),
        "max": int(np.max(items_per_order)),
    }

    # 3. Quantity distribution
    if "quantity" in order_items_df.columns:
        q_vals = pd.to_numeric(order_items_df["quantity"], errors="coerce").dropna().values.astype(int)
        if len(q_vals) == 0:
            q_vals = np.array([1])
    else:
        q_vals = np.array([1, 2])

    model.quantity_samples = q_vals
    model.quantity_stats = {
        "mean": round(float(np.mean(q_vals)), 2),
        "median": float(np.median(q_vals)),
        "std": round(float(np.std(q_vals)), 2),
        "min": int(np.min(q_vals)),
        "max": int(np.max(q_vals)),
    }

    # 4. Unit price distribution per product category
    cat_col = "category" if "category" in order_items_df.columns else None
    price_col = "unit_price" if "unit_price" in order_items_df.columns else None

    if cat_col and price_col:
        cat_freq = order_items_df[cat_col].dropna().astype(str).value_counts(normalize=True)
        model.categories = list(cat_freq.index)
        model.category_probs = list(cat_freq.values)

        for cat in model.categories:
            cat_rows = order_items_df[order_items_df[cat_col].astype(str) == cat]
            prices = pd.to_numeric(cat_rows[price_col], errors="coerce").dropna().values.astype(float)
            if len(prices) == 0:
                prices = np.array([50.0])

            # 50 empirical quantile points for smooth interpolation
            quantiles = np.quantile(prices, np.linspace(0.0, 1.0, 50))
            model.category_quantiles[cat] = quantiles
            model.category_price_stats[cat] = {
                "mean": round(float(np.mean(prices)), 2),
                "median": round(float(np.median(prices)), 2),
                "std": round(float(np.std(prices)), 2),
                "min": round(float(np.min(prices)), 2),
                "max": round(float(np.max(prices)), 2),
            }

            if "product_name" in cat_rows.columns:
                prods = list(cat_rows["product_name"].dropna().astype(str).unique())
                model.products_by_category[cat] = prods if prods else ["Item"]
            else:
                model.products_by_category[cat] = [f"{cat} Item"]
    else:
        # Fallback category setup
        model.categories = CATEGORIES
        model.category_probs = [1.0 / len(CATEGORIES)] * len(CATEGORIES)
        for cat in CATEGORIES:
            model.category_quantiles[cat] = np.linspace(10.0, 100.0, 50)
            model.category_price_stats[cat] = {
                "mean": 50.0, "median": 50.0, "std": 20.0, "min": 10.0, "max": 100.0
            }
            model.products_by_category[cat] = [f"{cat} Product"]

    # 5. Order attributes
    if "status" in orders_df.columns:
        stat_freq = orders_df["status"].dropna().astype(str).value_counts(normalize=True)
        model.order_status_probs = {k: float(v) for k, v in stat_freq.items()}
    if "discount" in orders_df.columns:
        d_vals = pd.to_numeric(orders_df["discount"], errors="coerce").dropna().values.astype(float)
        if len(d_vals) > 0:
            model.discount_samples = d_vals
    if "tax_rate" in orders_df.columns:
        tr_vals = pd.to_numeric(orders_df["tax_rate"], errors="coerce").dropna().unique()
        if len(tr_vals) > 0:
            model.tax_rate_choices = [float(x) for x in tr_vals]

    # 6. Customer cities
    if "city" in customers_df.columns:
        city_freq = customers_df["city"].dropna().astype(str).value_counts(normalize=True)
        model.city_probs = {k: float(v) for k, v in city_freq.items()}

    return model


def load_built_in_relational_sample() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load the bundled demo relational CSV files from backend/sample_data/relational/."""
    cust_path = RELATIONAL_SAMPLE_DIR / "customers.csv"
    ord_path = RELATIONAL_SAMPLE_DIR / "orders.csv"
    items_path = RELATIONAL_SAMPLE_DIR / "order_items.csv"

    if not (cust_path.exists() and ord_path.exists() and items_path.exists()):
        # Generate on the fly if not present
        from sample_data.generate_relational_sample import generate_relational_sample
        generate_relational_sample()

    customers_df = pd.read_csv(cust_path)
    orders_df = pd.read_csv(ord_path)
    order_items_df = pd.read_csv(items_path)
    return customers_df, orders_df, order_items_df


def generate_relational_learned(
    model: RelationalLearnedModel,
    customer_count: int = 100,
    seed: Optional[int] = 42,
    locale: str = "en_US",
) -> dict[str, pd.DataFrame]:
    """
    Generate synthetic relational tables using learned statistical distributions:
      - customers: customer_count rows
      - orders: count sampled from learned orders_per_customer distribution
      - order_items: count sampled from learned items_per_order distribution
      - unit_price: sampled from category-specific learned price distributions
      - quantity: sampled from learned quantity distribution
      - strict mathematical calculation of subtotals, tax, and order totals
    """
    rng = np.random.default_rng(seed)
    fake, locale_cfg, pk_provider = get_safe_faker(locale, seed)

    # ── 1. Customers ──
    customer_ids = list(range(1, customer_count + 1))
    cities_list = list(model.city_probs.keys()) if model.city_probs else ["New York", "San Francisco", "Austin", "Chicago"]
    cities_probs = list(model.city_probs.values()) if model.city_probs else [0.25, 0.25, 0.25, 0.25]
    cities_probs = np.array(cities_probs) / sum(cities_probs)

    domains = ["gmail.com", "yahoo.com", "outlook.com", "icloud.com"]
    c_names, c_emails, c_phones, c_cities, c_signups = [], [], [], [], []

    for cid in customer_ids:
        if pk_provider:
            name = pk_provider.name()
            phone = pk_provider.phone_number()
        else:
            name = fake.name()
            phone = fake.phone_number()

        clean_name = name.lower().replace(" ", ".")
        email = f"{clean_name}{cid}@{rng.choice(domains)}"
        city = rng.choice(cities_list, p=cities_probs)
        # Random signup date within last 3 years
        offset_days = int(rng.integers(0, 1100))
        s_date = (pd.Timestamp("2021-01-01") + pd.Timedelta(days=offset_days)).strftime("%Y-%m-%d")

        c_names.append(name)
        c_emails.append(email)
        c_phones.append(phone)
        c_cities.append(city)
        c_signups.append(s_date)

    customers_df = pd.DataFrame({
        "customer_id": customer_ids,
        "name": c_names,
        "email": c_emails,
        "phone": c_phones,
        "city": c_cities,
        "signup_date": c_signups,
    })

    # ── 2. Orders: draw from learned orders per customer distribution ──
    order_ids = []
    order_cust_ids = []
    order_dates = []
    order_statuses = []
    order_discounts = []
    order_tax_rates = []

    statuses = list(model.order_status_probs.keys()) if model.order_status_probs else ["completed", "shipped", "processing", "cancelled"]
    status_weights = list(model.order_status_probs.values()) if model.order_status_probs else [0.65, 0.20, 0.10, 0.05]
    status_weights = np.array(status_weights) / sum(status_weights)

    tax_rates = model.tax_rate_choices if model.tax_rate_choices else [0.08]

    curr_oid = 1
    for cid in customer_ids:
        # Sample number of orders from learned empirical distribution (min 1)
        n_orders = max(1, int(rng.choice(model.orders_per_cust_samples)))
        for _ in range(n_orders):
            order_ids.append(curr_oid)
            order_cust_ids.append(cid)
            offset_d = int(rng.integers(0, 700))
            o_date = (pd.Timestamp("2023-01-01") + pd.Timedelta(days=offset_d)).strftime("%Y-%m-%d")
            order_dates.append(o_date)
            order_statuses.append(rng.choice(statuses, p=status_weights))
            disc = round(float(rng.choice(model.discount_samples)), 2)
            order_discounts.append(disc)
            order_tax_rates.append(float(rng.choice(tax_rates)))
            curr_oid += 1

    # ── 3. Order Items: draw from learned items per order and category distributions ──
    item_ids = []
    item_order_ids = []
    item_products = []
    item_categories = []
    item_quantities = []
    item_unit_prices = []
    item_line_totals = []

    curr_item_id = 1
    order_subtotals = {oid: 0.0 for oid in order_ids}
    q_probs = np.linspace(0.0, 1.0, 50)

    for oid in order_ids:
        # Sample number of items from learned items per order distribution (min 1)
        n_items = max(1, int(rng.choice(model.items_per_order_samples)))
        for _ in range(n_items):
            cat = rng.choice(model.categories, p=model.category_probs)
            prod_choices = model.products_by_category.get(cat, [f"{cat} Item"])
            prod = rng.choice(prod_choices)

            # Quantity from learned distribution
            qty = max(1, int(rng.choice(model.quantity_samples)))

            # Unit price interpolated from category-specific quantile table
            quantiles = model.category_quantiles.get(cat)
            if quantiles is not None:
                u = float(rng.uniform(0.0, 1.0))
                price = round(float(np.interp(u, q_probs, quantiles)), 2)
            else:
                price = 50.0

            line_tot = round(qty * price, 2)

            item_ids.append(curr_item_id)
            item_order_ids.append(oid)
            item_products.append(prod)
            item_categories.append(cat)
            item_quantities.append(qty)
            item_unit_prices.append(price)
            item_line_totals.append(line_tot)

            order_subtotals[oid] += line_tot
            curr_item_id += 1

    order_items_df = pd.DataFrame({
        "item_id": item_ids,
        "order_id": item_order_ids,
        "product_name": item_products,
        "category": item_categories,
        "quantity": item_quantities,
        "unit_price": item_unit_prices,
        "line_total": item_line_totals,
    })

    # ── 4. Reconcile Order Totals strictly in Python ──
    subtotals, tax_amounts, order_totals, final_discounts = [], [], [], []
    for oid, disc, tax_r in zip(order_ids, order_discounts, order_tax_rates):
        sub = round(order_subtotals[oid], 2)
        effective_disc = min(disc, sub)
        tax = round((sub - effective_disc) * tax_r, 2)
        tot = round(sub - effective_disc + tax, 2)

        subtotals.append(sub)
        final_discounts.append(effective_disc)
        tax_amounts.append(tax)
        order_totals.append(tot)

    orders_df = pd.DataFrame({
        "order_id": order_ids,
        "customer_id": order_cust_ids,
        "order_date": order_dates,
        "status": order_statuses,
        "discount": final_discounts,
        "tax_rate": order_tax_rates,
        "subtotal": subtotals,
        "tax_amount": tax_amounts,
        "order_total": order_totals,
    })

    return {
        "customers": customers_df,
        "orders": orders_df,
        "order_items": order_items_df,
    }


def compare_relational_datasets(
    real_tables: dict[str, pd.DataFrame],
    synth_tables: dict[str, pd.DataFrame],
) -> dict:
    """
    Produce a comparison table: real vs synthetic orders-per-customer
    and unit price distributions per category.
    """
    real_orders = real_tables.get("orders")
    synth_orders = synth_tables.get("orders")
    real_items = real_tables.get("order_items")
    synth_items = synth_tables.get("order_items")

    # 1. Orders per customer
    r_opc = real_orders.groupby("customer_id").size().values if real_orders is not None else np.array([])
    s_opc = synth_orders.groupby("customer_id").size().values if synth_orders is not None else np.array([])

    orders_comparison = {
        "real_mean": round(float(np.mean(r_opc)), 2) if len(r_opc) else 0.0,
        "synth_mean": round(float(np.mean(s_opc)), 2) if len(s_opc) else 0.0,
        "real_median": float(np.median(r_opc)) if len(r_opc) else 0.0,
        "synth_median": float(np.median(s_opc)) if len(s_opc) else 0.0,
        "real_std": round(float(np.std(r_opc)), 2) if len(r_opc) else 0.0,
        "synth_std": round(float(np.std(s_opc)), 2) if len(s_opc) else 0.0,
        "real_min": int(np.min(r_opc)) if len(r_opc) else 0,
        "synth_min": int(np.min(s_opc)) if len(s_opc) else 0,
        "real_max": int(np.max(r_opc)) if len(r_opc) else 0,
        "synth_max": int(np.max(s_opc)) if len(s_opc) else 0,
    }

    # 2. Items per order
    r_ipo = real_items.groupby("order_id").size().values if real_items is not None else np.array([])
    s_ipo = synth_items.groupby("order_id").size().values if synth_items is not None else np.array([])

    items_comparison = {
        "real_mean": round(float(np.mean(r_ipo)), 2) if len(r_ipo) else 0.0,
        "synth_mean": round(float(np.mean(s_ipo)), 2) if len(s_ipo) else 0.0,
        "real_median": float(np.median(r_ipo)) if len(r_ipo) else 0.0,
        "synth_median": float(np.median(s_ipo)) if len(s_ipo) else 0.0,
    }

    # 3. Quantity comparison
    r_q = real_items["quantity"].values if real_items is not None and "quantity" in real_items else np.array([])
    s_q = synth_items["quantity"].values if synth_items is not None and "quantity" in synth_items else np.array([])
    qty_comparison = {
        "real_mean": round(float(np.mean(r_q)), 2) if len(r_q) else 0.0,
        "synth_mean": round(float(np.mean(s_q)), 2) if len(s_q) else 0.0,
        "real_median": float(np.median(r_q)) if len(r_q) else 0.0,
        "synth_median": float(np.median(s_q)) if len(s_q) else 0.0,
    }

    # 4. Price distribution by product category
    price_by_category = []
    if real_items is not None and synth_items is not None and "category" in real_items and "unit_price" in real_items:
        categories = list(real_items["category"].dropna().astype(str).unique())
        for cat in categories:
            r_prices = pd.to_numeric(real_items[real_items["category"] == cat]["unit_price"], errors="coerce").dropna().values
            s_prices = pd.to_numeric(synth_items[synth_items["category"] == cat]["unit_price"], errors="coerce").dropna().values

            if len(r_prices) and len(s_prices):
                price_by_category.append({
                    "category": cat,
                    "real_mean": round(float(np.mean(r_prices)), 2),
                    "synth_mean": round(float(np.mean(s_prices)), 2),
                    "real_median": round(float(np.median(r_prices)), 2),
                    "synth_median": round(float(np.median(s_prices)), 2),
                    "real_std": round(float(np.std(r_prices)), 2),
                    "synth_std": round(float(np.std(s_prices)), 2),
                    "real_min": round(float(np.min(r_prices)), 2),
                    "synth_min": round(float(np.min(s_prices)), 2),
                    "real_max": round(float(np.max(r_prices)), 2),
                    "synth_max": round(float(np.max(s_prices)), 2),
                    "diff_mean": round(abs(float(np.mean(s_prices)) - float(np.mean(r_prices))), 2),
                })

    return {
        "orders_per_customer": orders_comparison,
        "items_per_order": items_comparison,
        "quantity": qty_comparison,
        "price_by_category": price_by_category,
    }


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  ORIGINAL TEMPLATE GENERATOR (PRESERVED & EXTENDED)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def generate_relational(
    template: Optional[dict] = None,
    customer_count: int = 100,
    seed: Optional[int] = 42,
    locale: str = 'en_US',
    learned_model: Optional[RelationalLearnedModel] = None,
) -> dict[str, pd.DataFrame]:
    """
    Generate relational datasets with referential integrity.
    If learned_model is provided, uses the learned distributions.
    Otherwise uses the default/custom template.
    
    Returns dict of table_name -> DataFrame.
    """
    if learned_model is not None:
        return generate_relational_learned(
            model=learned_model,
            customer_count=customer_count,
            seed=seed,
            locale=locale,
        )

    if template is None:
        template = DEFAULT_TEMPLATE

    rng = np.random.default_rng(seed)
    fake, locale_cfg, pk_provider = get_safe_faker(locale, seed)

    tables = {}
    id_maps = {}  # table_name -> list of primary key values

    for table_def in template['tables']:
        table_name = table_def['name']
        columns = table_def['columns']
        pk = table_def.get('primary_key', f'{table_name}_id')
        parent_ratio = table_def.get('parent_ratio')

        # Determine row count
        if parent_ratio and id_maps:
            parent_table = None
            fk_col = None
            for col_def in columns:
                if col_def.get('type') == 'fk' and 'references' in col_def:
                    ref = col_def['references']
                    parent_table = ref.split('.')[0]
                    fk_col = col_def['name']
                    break

            if parent_table and parent_table in id_maps:
                parent_ids = id_maps[parent_table]
                row_count = 0
                child_parent_map = []

                for pid in parent_ids:
                    n_children = rng.integers(
                        parent_ratio['min'],
                        parent_ratio['max'] + 1
                    )
                    for _ in range(n_children):
                        child_parent_map.append(pid)
                    row_count += n_children
            else:
                row_count = customer_count
                child_parent_map = None
        else:
            row_count = customer_count
            child_parent_map = None

        data = {}
        for col_def in columns:
            col_name = col_def['name']
            col_type = col_def.get('type', 'text')
            stats = col_def.get('stats', {})

            if col_type == 'id':
                data[col_name] = list(range(1, row_count + 1))
            elif col_type == 'fk':
                if child_parent_map is not None:
                    data[col_name] = child_parent_map
                else:
                    ref = col_def.get('references', '')
                    parent_table = ref.split('.')[0]
                    if parent_table in id_maps:
                        data[col_name] = list(rng.choice(id_maps[parent_table], size=row_count))
                    else:
                        data[col_name] = list(range(1, row_count + 1))
            elif col_type == 'name':
                if pk_provider:
                    data[col_name] = [pk_provider.name() for _ in range(row_count)]
                else:
                    data[col_name] = [fake.name() for _ in range(row_count)]
            elif col_type == 'email':
                if pk_provider:
                    domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'live.com']
                    data[col_name] = [f"{pk_provider.name().lower().replace(' ', '.')}{rng.integers(10, 999)}@{rng.choice(domains)}" for _ in range(row_count)]
                else:
                    data[col_name] = [fake.email() for _ in range(row_count)]
            elif col_type == 'phone':
                if pk_provider:
                    data[col_name] = [pk_provider.phone_number() for _ in range(row_count)]
                else:
                    data[col_name] = [fake.phone_number() for _ in range(row_count)]
            elif col_type == 'address':
                if pk_provider:
                    data[col_name] = [pk_provider.city() for _ in range(row_count)]
                else:
                    data[col_name] = [fake.city() for _ in range(row_count)]
            elif col_type == 'datetime':
                start = pd.Timestamp(stats.get('min', '2020-01-01'))
                end = pd.Timestamp(stats.get('max', '2024-12-31'))
                start_ts = start.value // 10**9
                end_ts = end.value // 10**9
                random_ts = rng.integers(start_ts, end_ts, size=row_count)
                data[col_name] = [pd.Timestamp(ts, unit='s').strftime('%Y-%m-%d') for ts in random_ts]
            elif col_type == 'categorical':
                cats = stats.get('categories', {})
                if cats:
                    labels = list(cats.keys())
                    probs = np.array(list(cats.values()), dtype=float)
                    probs = probs / probs.sum()
                    data[col_name] = list(rng.choice(labels, size=row_count, p=probs))
                else:
                    data[col_name] = list(rng.choice(['A', 'B', 'C'], size=row_count))
            elif col_type == 'integer':
                mean = stats.get('mean', 5)
                std = stats.get('std', 2)
                lo = stats.get('min', 1)
                hi = stats.get('max', 10)
                vals = rng.normal(mean, max(std, 0.1), size=row_count)
                vals = np.clip(vals, lo, hi)
                data[col_name] = [int(round(v)) for v in vals]
            elif col_type == 'float':
                mean = stats.get('mean', 50)
                std = stats.get('std', 25)
                lo = stats.get('min', 0)
                hi = stats.get('max', 100)
                vals = rng.normal(mean, max(std, 0.01), size=row_count)
                vals = np.clip(vals, lo, hi)
                data[col_name] = [round(float(v), 2) for v in vals]
            elif col_type == 'product':
                data[col_name] = list(rng.choice(PRODUCT_NAMES, size=row_count))
            elif col_type == 'category_pick':
                data[col_name] = list(rng.choice(CATEGORIES, size=row_count))
            else:
                data[col_name] = [fake.word() for _ in range(row_count)]

        df = pd.DataFrame(data)
        id_maps[table_name] = df[pk].tolist()
        tables[table_name] = df

    # Compute order totals from line items (strict math)
    if 'order_items' in tables and 'orders' in tables:
        items = tables['order_items']
        orders = tables['orders']

        if 'quantity' in items.columns and 'unit_price' in items.columns:
            items['line_total'] = (items['quantity'] * items['unit_price']).round(2)

        if 'order_id' in items.columns and 'line_total' in items.columns:
            order_subtotals = items.groupby('order_id')['line_total'].sum().reset_index()
            order_subtotals.columns = ['order_id', 'subtotal']

            orders = orders.merge(order_subtotals, on='order_id', how='left')
            orders['subtotal'] = orders['subtotal'].fillna(0).round(2)

            if 'discount' not in orders.columns:
                orders['discount'] = 0
            if 'tax_rate' not in orders.columns:
                orders['tax_rate'] = 0.08

            orders['discount'] = orders['discount'].clip(lower=0).round(2)
            orders['tax_amount'] = ((orders['subtotal'] - orders['discount']) * orders['tax_rate']).round(2)
            orders['order_total'] = (orders['subtotal'] - orders['discount'] + orders['tax_amount']).round(2)

            tables['orders'] = orders
            tables['order_items'] = items

    return tables


# ── SQL Dump ─────────────────────────────────────────────────────────────────

def generate_sql_dump(
    tables: dict[str, pd.DataFrame],
    template: Optional[dict] = None,
) -> str:
    """
    Generate SQL dump with CREATE TABLE + INSERT statements using sqlite3.
    Includes PRIMARY KEY and FOREIGN KEY constraints.
    """
    if template is None:
        template = DEFAULT_TEMPLATE

    conn = sqlite3.connect(':memory:')
    cursor = conn.cursor()
    sql_statements = []

    table_defs = {t['name']: t for t in template['tables']} if template and 'tables' in template else {}

    for table_name, df in tables.items():
        table_def = table_defs.get(table_name, {})
        pk = table_def.get('primary_key', f"{table_name}_id")
        columns_def = table_def.get('columns', [])

        col_defs = []
        fk_defs = []

        for col in df.columns:
            col_info = next((c for c in columns_def if c['name'] == col), None)

            if col_info and col_info.get('type') == 'id':
                col_defs.append(f'  {col} INTEGER PRIMARY KEY')
            elif col_info and col_info.get('type') == 'fk':
                ref = col_info.get('references', '')
                col_defs.append(f'  {col} INTEGER')
                if '.' in ref:
                    p_table, p_col = ref.split('.')
                    fk_defs.append(f'  FOREIGN KEY ({col}) REFERENCES {p_table}({p_col})')
            elif col in ('customer_id', 'order_id', 'item_id') and col == pk:
                col_defs.append(f'  {col} INTEGER PRIMARY KEY')
            elif col == 'customer_id' and table_name == 'orders':
                col_defs.append(f'  {col} INTEGER')
                fk_defs.append(f'  FOREIGN KEY ({col}) REFERENCES customers(customer_id)')
            elif col == 'order_id' and table_name == 'order_items':
                col_defs.append(f'  {col} INTEGER')
                fk_defs.append(f'  FOREIGN KEY ({col}) REFERENCES orders(order_id)')
            else:
                dtype = df[col].dtype
                if pd.api.types.is_float_dtype(dtype):
                    col_defs.append(f'  {col} REAL')
                elif pd.api.types.is_integer_dtype(dtype):
                    col_defs.append(f'  {col} INTEGER')
                else:
                    col_defs.append(f'  {col} TEXT')

        all_defs = col_defs + fk_defs
        create_sql = f'CREATE TABLE {table_name} (\n' + ',\n'.join(all_defs) + '\n);'
        sql_statements.append(create_sql)

        for _, row in df.iterrows():
            cols = ', '.join(df.columns)
            vals = []
            for v in row.values:
                if pd.isna(v):
                    vals.append('NULL')
                elif isinstance(v, (int, np.integer)):
                    vals.append(str(v))
                elif isinstance(v, (float, np.floating)):
                    vals.append(str(round(float(v), 2)))
                else:
                    escaped = str(v).replace("'", "''")
                    vals.append(f"'{escaped}'")
            values_str = ', '.join(vals)
            sql_statements.append(f'INSERT INTO {table_name} ({cols}) VALUES ({values_str});')

        sql_statements.append('')

    conn.close()
    return '\n'.join(sql_statements)


# ── Export as ZIP of CSVs ────────────────────────────────────────────────────

def export_relational_zip(
    tables: dict[str, pd.DataFrame],
    include_sql: bool = True,
    template: Optional[dict] = None,
) -> bytes:
    """Export relational tables as a ZIP of CSVs + optional SQL dump."""
    buffer = io.BytesIO()

    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for table_name, df in tables.items():
            csv_data = df.to_csv(index=False)
            zf.writestr(f'{table_name}.csv', csv_data)

        if include_sql:
            sql_dump = generate_sql_dump(tables, template)
            zf.writestr('schema_and_data.sql', sql_dump)

    buffer.seek(0)
    return buffer.read()
