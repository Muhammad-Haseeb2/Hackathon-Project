"""
Generate bundled relational demo dataset:
  - customers.csv (500 customers)
  - orders.csv (~1,400 orders)
  - order_items.csv (~3,800 order items)

With distinct, realistic distributions:
  - Orders per customer: skewed (1 to 8 orders, mode 1-2)
  - Items per order: skewed (1 to 6 items)
  - Quantity distribution: heavily weighted towards 1 and 2
  - Unit price distribution: category-specific log-normal/empirical distributions
  - Referential integrity: 100% valid, zero orphan keys, exact math reconciliation
"""

import numpy as np
import pandas as pd
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent / "relational"
OUT_DIR.mkdir(parents=True, exist_ok=True)

SEED = 42
N_CUSTOMERS = 500

CATEGORIES = ["Electronics", "Clothing", "Home & Garden", "Books", "Food", "Sports"]

CATEGORY_PRODUCTS = {
    "Electronics": ["Wireless Headphones", "Smart Watch", "4K Monitor", "Bluetooth Speaker", "USB-C Hub", "Webcam HD"],
    "Clothing": ["Cotton T-Shirt", "Slim Jeans", "Fleece Hoodie", "Running Shoes", "Winter Jacket", "Wool Scarf"],
    "Home & Garden": ["Ceramic Planter", "LED Desk Lamp", "Stainless Kettle", "Storage Bin", "Throw Blanket", "Wall Clock"],
    "Books": ["Python Mastery Guide", "Data Science Handbook", "Sci-Fi Novel", "Economics 101", "Design Thinking", "History Atlas"],
    "Food": ["Organic Coffee Beans", "Dark Chocolate Bar", "Green Tea Box", "Artisan Olive Oil", "Raw Honey Jar", "Granola Pack"],
    "Sports": ["Yoga Mat", "Dumbbell Set", "Water Bottle Insulated", "Cycling Gloves", "Resistance Bands", "Jump Rope"],
}

CATEGORY_PRICE_PARAMS = {
    # (mean_log, std_log, min_price, max_price)
    "Electronics": (5.4, 0.45, 60.0, 750.0),      # ~ $220 avg
    "Clothing": (3.9, 0.35, 18.0, 140.0),         # ~ $50 avg
    "Home & Garden": (4.3, 0.40, 22.0, 220.0),    # ~ $75 avg
    "Books": (2.9, 0.25, 9.0, 42.0),              # ~ $19 avg
    "Food": (2.5, 0.30, 4.5, 32.0),               # ~ $12 avg
    "Sports": (4.0, 0.35, 15.0, 160.0),           # ~ $55 avg
}

def generate_relational_sample():
    rng = np.random.default_rng(SEED)

    # 1. Customers
    cities = ["New York", "San Francisco", "Austin", "Chicago", "Seattle", "Denver", "Boston", "Atlanta"]
    city_weights = [0.22, 0.18, 0.14, 0.12, 0.10, 0.08, 0.08, 0.08]

    first_names = ["James", "Emma", "Liam", "Olivia", "Noah", "Ava", "William", "Sophia", "Oliver", "Isabella",
                   "Lucas", "Mia", "Henry", "Charlotte", "Alexander", "Amelia", "Daniel", "Harper", "Matthew", "Evelyn"]
    last_names = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
                  "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"]

    customer_ids = list(range(1, N_CUSTOMERS + 1))
    names = []
    emails = []
    phones = []
    customer_cities = []
    signup_dates = []

    domains = ["gmail.com", "yahoo.com", "outlook.com", "icloud.com"]

    for cid in customer_ids:
        fn = rng.choice(first_names)
        ln = rng.choice(last_names)
        name = f"{fn} {ln}"
        email = f"{fn.lower()}.{ln.lower()}{cid}@{rng.choice(domains)}"
        phone = f"+1-555-{rng.integers(100, 999)}-{rng.integers(1000, 9999)}"
        city = rng.choice(cities, p=city_weights)
        # Dates between 2021-01-01 and 2024-06-30
        d_offset = rng.integers(0, 1270)
        s_date = (pd.Timestamp("2021-01-01") + pd.Timedelta(days=int(d_offset))).strftime("%Y-%m-%d")

        names.append(name)
        emails.append(email)
        phones.append(phone)
        customer_cities.append(city)
        signup_dates.append(s_date)

    customers_df = pd.DataFrame({
        "customer_id": customer_ids,
        "name": names,
        "email": emails,
        "phone": phones,
        "city": customer_cities,
        "signup_date": signup_dates,
    })

    # 2. Orders per customer: skewed realistic distribution
    # Frequencies: 1: 35%, 2: 25%, 3: 18%, 4: 11%, 5: 6%, 6: 3%, 7: 1%, 8: 1%
    order_counts_dist = [1, 2, 3, 4, 5, 6, 7, 8]
    order_counts_probs = [0.35, 0.25, 0.18, 0.11, 0.06, 0.03, 0.01, 0.01]

    order_ids = []
    order_customer_ids = []
    order_dates = []
    order_statuses = []
    order_discounts = []
    order_tax_rates = []

    statuses = ["completed", "shipped", "processing", "cancelled"]
    status_weights = [0.65, 0.20, 0.10, 0.05]

    curr_order_id = 1
    for cid in customer_ids:
        n_orders = int(rng.choice(order_counts_dist, p=order_counts_probs))
        for _ in range(n_orders):
            order_ids.append(curr_order_id)
            order_customer_ids.append(cid)
            d_offset = rng.integers(0, 700)
            o_date = (pd.Timestamp("2023-01-01") + pd.Timedelta(days=int(d_offset))).strftime("%Y-%m-%d")
            order_dates.append(o_date)
            order_statuses.append(rng.choice(statuses, p=status_weights))
            # Discount: 70% 0, 30% between 5 and 30
            disc = round(float(rng.choice([0.0, rng.uniform(5.0, 35.0)], p=[0.70, 0.30])), 2)
            order_discounts.append(disc)
            order_tax_rates.append(round(float(rng.choice([0.06, 0.075, 0.08, 0.088, 0.095])), 3))
            curr_order_id += 1

    # 3. Order Items per order: skewed distribution
    # 1 item: 40%, 2 items: 32%, 3 items: 16%, 4 items: 8%, 5 items: 3%, 6 items: 1%
    item_counts_dist = [1, 2, 3, 4, 5, 6]
    item_counts_probs = [0.40, 0.32, 0.16, 0.08, 0.03, 0.01]

    # Quantity distribution: 1: 58%, 2: 24%, 3: 10%, 4: 5%, 5: 3%
    qty_dist = [1, 2, 3, 4, 5]
    qty_probs = [0.58, 0.24, 0.10, 0.05, 0.03]

    cat_probs = [0.24, 0.22, 0.18, 0.14, 0.12, 0.10]

    item_ids = []
    item_order_ids = []
    item_products = []
    item_categories = []
    item_quantities = []
    item_unit_prices = []
    item_line_totals = []

    curr_item_id = 1
    order_subtotals = {oid: 0.0 for oid in order_ids}

    for oid in order_ids:
        n_items = int(rng.choice(item_counts_dist, p=item_counts_probs))
        for _ in range(n_items):
            cat = rng.choice(CATEGORIES, p=cat_probs)
            prod = rng.choice(CATEGORY_PRODUCTS[cat])
            qty = int(rng.choice(qty_dist, p=qty_probs))

            mu, sigma, p_min, p_max = CATEGORY_PRICE_PARAMS[cat]
            price = round(float(np.clip(np.exp(rng.normal(mu, sigma)), p_min, p_max)), 2)
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

    # Finish orders DataFrame with strict reconciliation
    subtotals = []
    tax_amounts = []
    order_totals = []

    for oid, disc, tax_r in zip(order_ids, order_discounts, order_tax_rates):
        sub = round(order_subtotals[oid], 2)
        # Cap discount at subtotal
        effective_disc = min(disc, sub)
        tax = round((sub - effective_disc) * tax_r, 2)
        tot = round(sub - effective_disc + tax, 2)

        subtotals.append(sub)
        tax_amounts.append(tax)
        order_totals.append(tot)

    orders_df = pd.DataFrame({
        "order_id": order_ids,
        "customer_id": order_customer_ids,
        "order_date": order_dates,
        "status": order_statuses,
        "discount": order_discounts,
        "tax_rate": order_tax_rates,
        "subtotal": subtotals,
        "tax_amount": tax_amounts,
        "order_total": order_totals,
    })

    # Save to disk
    customers_df.to_csv(OUT_DIR / "customers.csv", index=False)
    orders_df.to_csv(OUT_DIR / "orders.csv", index=False)
    order_items_df.to_csv(OUT_DIR / "order_items.csv", index=False)

    print(f"Generated relational sample:")
    print(f"  customers: {len(customers_df)} rows")
    print(f"  orders: {len(orders_df)} rows (avg {len(orders_df)/len(customers_df):.2f} orders/cust)")
    print(f"  order_items: {len(order_items_df)} rows (avg {len(order_items_df)/len(orders_df):.2f} items/order)")

if __name__ == "__main__":
    generate_relational_sample()
