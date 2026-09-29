"""
Validators — orphan-key check, totals reconciliation, balance check.
All checks are strict mathematical verifications done in Python.
"""

import numpy as np
import pandas as pd


def check_orphan_keys(
    child_df: pd.DataFrame,
    parent_df: pd.DataFrame,
    fk_column: str,
    pk_column: str,
) -> dict:
    """
    Check for orphan foreign keys — every child FK must reference an existing parent PK.
    
    Returns:
        Dict with 'valid' bool, 'orphan_count', 'orphan_values'.
    """
    parent_ids = set(parent_df[pk_column].dropna().values)
    child_ids = set(child_df[fk_column].dropna().values)
    
    orphans = child_ids - parent_ids
    
    return {
        'valid': len(orphans) == 0,
        'orphan_count': len(orphans),
        'orphan_values': list(orphans)[:20],  # Show max 20
        'parent_count': len(parent_ids),
        'child_references': len(child_ids),
    }


def check_all_orphan_keys(tables: dict[str, pd.DataFrame]) -> dict:
    """
    Check all foreign key relationships in a set of relational tables.
    Assumes standard naming: customer_id, order_id, etc.
    """
    results = {}
    
    # orders.customer_id → customers.customer_id
    if 'orders' in tables and 'customers' in tables:
        if 'customer_id' in tables['orders'].columns and 'customer_id' in tables['customers'].columns:
            results['orders→customers'] = check_orphan_keys(
                tables['orders'], tables['customers'], 'customer_id', 'customer_id'
            )
    
    # order_items.order_id → orders.order_id
    if 'order_items' in tables and 'orders' in tables:
        if 'order_id' in tables['order_items'].columns and 'order_id' in tables['orders'].columns:
            results['order_items→orders'] = check_orphan_keys(
                tables['order_items'], tables['orders'], 'order_id', 'order_id'
            )
    
    all_valid = all(r['valid'] for r in results.values())
    
    return {
        'all_valid': all_valid,
        'checks': results,
    }


def check_order_totals(
    orders_df: pd.DataFrame,
    items_df: pd.DataFrame,
    tolerance: float = 0.01,
) -> dict:
    """
    Verify that order totals equal sum of line items:
    sum(qty * unit_price) - discount + tax = order_total
    
    Args:
        orders_df: Orders DataFrame (must have order_id, discount, tax_amount, order_total).
        items_df: Order items DataFrame (must have order_id, quantity, unit_price).
        tolerance: Floating point tolerance for comparison.
    """
    # Compute expected subtotals from items
    items_totals = items_df.copy()
    items_totals['line_total'] = (items_totals['quantity'] * items_totals['unit_price']).round(2)
    expected_subtotals = items_totals.groupby('order_id')['line_total'].sum().reset_index()
    expected_subtotals.columns = ['order_id', 'expected_subtotal']
    
    # Merge with orders
    check = orders_df[['order_id', 'subtotal', 'discount', 'tax_amount', 'order_total']].copy()
    check = check.merge(expected_subtotals, on='order_id', how='left')
    check['expected_subtotal'] = check['expected_subtotal'].fillna(0)
    
    # Check subtotals match
    check['subtotal_match'] = np.abs(check['subtotal'] - check['expected_subtotal']) <= tolerance
    
    # Check order_total = subtotal - discount + tax
    check['expected_total'] = (check['subtotal'] - check['discount'] + check['tax_amount']).round(2)
    check['total_match'] = np.abs(check['order_total'] - check['expected_total']) <= tolerance
    
    subtotal_mismatches = int((~check['subtotal_match']).sum())
    total_mismatches = int((~check['total_match']).sum())
    
    return {
        'valid': subtotal_mismatches == 0 and total_mismatches == 0,
        'orders_checked': len(check),
        'subtotal_mismatches': subtotal_mismatches,
        'total_mismatches': total_mismatches,
        'sample_failures': check[~(check['subtotal_match'] & check['total_match'])].head(5).to_dict('records') if (subtotal_mismatches + total_mismatches) > 0 else [],
    }


def check_running_balance(
    transactions_df: pd.DataFrame,
    opening_balance: float,
    allow_overdraft: bool = False,
    tolerance: float = 0.01,
) -> dict:
    """
    Verify running balance of a bank statement:
    Balance_t = Balance_{t-1} + Credit_t - Debit_t
    
    Args:
        transactions_df: Must have 'credit', 'debit', 'balance' columns, in order.
        opening_balance: Starting balance.
        allow_overdraft: If False, checks that balance never goes negative.
    """
    if isinstance(transactions_df, list):
        df = pd.DataFrame(transactions_df)
    else:
        df = transactions_df.copy()
    
    expected_balances = []
    current = float(opening_balance)
    
    for _, row in df.iterrows():
        credit = float(row.get('credit', 0) or 0)
        debit = float(row.get('debit', 0) or 0)
        current = round(current + credit - debit, 2)
        expected_balances.append(current)
    
    df['expected_balance'] = expected_balances
    df['balance_match'] = np.abs(df['balance'].astype(float) - df['expected_balance']) <= tolerance
    
    mismatches = int((~df['balance_match']).sum())
    
    # Check overdraft
    overdraft_count = 0
    if not allow_overdraft:
        overdraft_count = int((df['expected_balance'] < -tolerance).sum())
    
    return {
        'valid': mismatches == 0 and (allow_overdraft or overdraft_count == 0),
        'transactions_checked': len(df),
        'balance_mismatches': mismatches,
        'overdraft_violations': overdraft_count,
        'opening_balance': opening_balance,
        'closing_balance': expected_balances[-1] if expected_balances else opening_balance,
    }


def run_relational_validation(tables: dict[str, pd.DataFrame]) -> dict:
    """
    Run all validations on a set of relational tables.
    Returns comprehensive validation report.
    """
    report = {
        'all_valid': True,
        'checks': {},
    }
    
    # 1. Orphan key checks
    orphan_result = check_all_orphan_keys(tables)
    report['checks']['orphan_keys'] = orphan_result
    if not orphan_result['all_valid']:
        report['all_valid'] = False
    
    # 2. Order totals check
    if 'orders' in tables and 'order_items' in tables:
        orders = tables['orders']
        items = tables['order_items']
        
        required_order_cols = {'order_id', 'subtotal', 'discount', 'tax_amount', 'order_total'}
        required_item_cols = {'order_id', 'quantity', 'unit_price'}
        
        if required_order_cols.issubset(orders.columns) and required_item_cols.issubset(items.columns):
            totals_result = check_order_totals(orders, items)
            report['checks']['order_totals'] = totals_result
            if not totals_result['valid']:
                report['all_valid'] = False
    
    return report
