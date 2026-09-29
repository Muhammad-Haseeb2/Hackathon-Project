"""
Relational data generator — parent/child with referential integrity.
Generates linked tables: Customers → Orders → Order Items.
Also supports custom schemas. All math computed in Python.
"""

import io
import uuid
import sqlite3
import zipfile
import numpy as np
import pandas as pd
from faker import Faker
from typing import Optional

from fallbacks import PRODUCT_NAMES, CATEGORIES


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
                # total will be computed from line items
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
                # line_total = qty * unit_price (computed)
            ],
            'primary_key': 'item_id',
            'parent_ratio': {'min': 1, 'max': 4},  # 1-4 items per order
        },
    ],
}


# ── Generator ────────────────────────────────────────────────────────────────

def generate_relational(
    template: Optional[dict] = None,
    customer_count: int = 100,
    seed: Optional[int] = 42,
    locale: str = 'en_US',
) -> dict[str, pd.DataFrame]:
    """
    Generate relational datasets with referential integrity.
    
    Returns dict of table_name -> DataFrame.
    """
    if template is None:
        template = DEFAULT_TEMPLATE

    rng = np.random.default_rng(seed)
    fake = Faker(locale)
    if seed is not None:
        Faker.seed(seed)

    tables = {}
    id_maps = {}  # table_name -> list of primary key values

    for table_def in template['tables']:
        table_name = table_def['name']
        columns = table_def['columns']
        pk = table_def.get('primary_key', f'{table_name}_id')
        parent_ratio = table_def.get('parent_ratio')

        # Determine row count
        if parent_ratio and id_maps:
            # Find the parent table from FK column
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

        # Generate data for each column
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
                data[col_name] = [fake.name() for _ in range(row_count)]
            elif col_type == 'email':
                data[col_name] = [fake.email() for _ in range(row_count)]
            elif col_type == 'phone':
                data[col_name] = [fake.phone_number() for _ in range(row_count)]
            elif col_type == 'address':
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

    # ── Compute order totals from line items (strict math) ──
    if 'order_items' in tables and 'orders' in tables:
        items = tables['order_items']
        orders = tables['orders']

        # Compute line totals
        if 'quantity' in items.columns and 'unit_price' in items.columns:
            items['line_total'] = (items['quantity'] * items['unit_price']).round(2)

        # Aggregate to order level
        if 'order_id' in items.columns and 'line_total' in items.columns:
            order_subtotals = items.groupby('order_id')['line_total'].sum().reset_index()
            order_subtotals.columns = ['order_id', 'subtotal']

            orders = orders.merge(order_subtotals, on='order_id', how='left')
            orders['subtotal'] = orders['subtotal'].fillna(0).round(2)

            # Compute tax and total
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

    # Create tables
    table_defs = {t['name']: t for t in template['tables']}
    
    for table_name, df in tables.items():
        table_def = table_defs.get(table_name, {})
        pk = table_def.get('primary_key', '')
        columns_def = table_def.get('columns', [])

        # Build CREATE TABLE
        col_defs = []
        fk_defs = []

        for col in df.columns:
            # Find column definition
            col_info = next((c for c in columns_def if c['name'] == col), None)
            
            if col_info and col_info.get('type') == 'id':
                col_defs.append(f'  {col} INTEGER PRIMARY KEY')
            elif col_info and col_info.get('type') == 'fk':
                ref = col_info.get('references', '')
                col_defs.append(f'  {col} INTEGER NOT NULL')
                if ref:
                    ref_table, ref_col = ref.split('.')
                    fk_defs.append(f'  FOREIGN KEY ({col}) REFERENCES {ref_table}({ref_col})')
            elif col_info and col_info.get('type') in ('integer',):
                col_defs.append(f'  {col} INTEGER')
            elif col_info and col_info.get('type') in ('float',):
                col_defs.append(f'  {col} REAL')
            else:
                col_defs.append(f'  {col} TEXT')

        # Add computed columns not in original schema
        for col in df.columns:
            if not any(col == c['name'] for c in columns_def):
                if df[col].dtype in ('float64', 'float32'):
                    col_defs.append(f'  {col} REAL')
                elif df[col].dtype in ('int64', 'int32'):
                    col_defs.append(f'  {col} INTEGER')
                else:
                    col_defs.append(f'  {col} TEXT')

        all_defs = col_defs + fk_defs
        create_sql = f'CREATE TABLE {table_name} (\n' + ',\n'.join(all_defs) + '\n);'
        sql_statements.append(create_sql)

        # Build INSERT statements
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

        sql_statements.append('')  # Blank line between tables

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
