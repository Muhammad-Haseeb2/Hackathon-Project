"""
Generate bundled demo datasets with strong built-in relationships.
Run this script to create the CSV files in backend/sample_data/.
"""

import numpy as np
import pandas as pd
from pathlib import Path

SEED = 12345
N = 2000
OUT_DIR = Path(__file__).resolve().parent


def generate_hr_employees(rng: np.random.Generator) -> pd.DataFrame:
    """
    hr_employees.csv — 2,000 rows
    Relationships:
      - years_experience strongly tied to age
      - salary tied to experience, department, and city
      - performance_score mildly correlated with experience
    """
    age = rng.integers(22, 62, size=N)
    # Experience: age minus education finish age (18-24), clipped
    edu_finish = rng.integers(18, 25, size=N)
    years_experience = np.clip(age - edu_finish, 0, 40).astype(int)

    departments = ["Engineering", "Sales", "Marketing", "Finance", "HR", "Operations"]
    dept_probs = [0.30, 0.20, 0.15, 0.15, 0.10, 0.10]
    department = rng.choice(departments, size=N, p=dept_probs)

    cities = ["New York", "San Francisco", "Austin", "Chicago", "Seattle", "Denver"]
    city_probs = [0.25, 0.25, 0.15, 0.15, 0.10, 0.10]
    city = rng.choice(cities, size=N, p=city_probs)

    # Salary: base + experience bonus + department multiplier + city adjustment + noise
    dept_mult = {"Engineering": 1.25, "Finance": 1.15, "Sales": 1.05,
                 "Marketing": 1.00, "Operations": 0.95, "HR": 0.90}
    city_adj = {"San Francisco": 15000, "New York": 12000, "Seattle": 8000,
                "Austin": 3000, "Chicago": 2000, "Denver": 0}

    salary = np.array([
        35000 + yrs * 2500 * dept_mult[d] + city_adj[c] + rng.normal(0, 5000)
        for yrs, d, c in zip(years_experience, department, city)
    ])
    salary = np.clip(salary, 30000, 250000).astype(int)

    # Performance: mild positive correlation with experience + noise
    performance_score = np.clip(
        3.0 + years_experience * 0.05 + rng.normal(0, 0.8, size=N),
        1.0, 5.0,
    ).round(1)

    return pd.DataFrame({
        "age": age,
        "years_experience": years_experience,
        "department": department,
        "city": city,
        "salary": salary,
        "performance_score": performance_score,
    })


def generate_retail_sales(rng: np.random.Generator) -> pd.DataFrame:
    """
    retail_sales.csv — 2,000 rows
    Relationships:
      - unit_price skewed, tied to product_category
      - quantity inversely tied to price
      - revenue = unit_price * quantity * (1 - discount)
      - month with seasonal December peak
    """
    categories = ["Electronics", "Clothing", "Food", "Books", "Home & Garden", "Sports"]
    cat_probs = [0.20, 0.22, 0.18, 0.15, 0.13, 0.12]
    product_category = rng.choice(categories, size=N, p=cat_probs)

    # Price: log-normal, shifted by category
    cat_base_price = {"Electronics": 150, "Clothing": 45, "Food": 12,
                      "Books": 18, "Home & Garden": 65, "Sports": 55}
    cat_price_std = {"Electronics": 0.7, "Clothing": 0.5, "Food": 0.4,
                     "Books": 0.3, "Home & Garden": 0.6, "Sports": 0.5}

    unit_price = np.array([
        round(cat_base_price[c] * np.exp(rng.normal(0, cat_price_std[c])), 2)
        for c in product_category
    ])
    unit_price = np.clip(unit_price, 1.0, 2000.0)

    # Quantity: inversely related to price (people buy more of cheap items)
    quantity = np.clip(
        np.round(20 - np.log1p(unit_price) * 3 + rng.normal(0, 2, size=N)),
        1, 50,
    ).astype(int)

    # Discount: 0-30%
    discount = np.round(rng.beta(2, 8, size=N) * 0.30, 2)

    # Revenue: computed
    revenue = np.round(unit_price * quantity * (1 - discount), 2)

    regions = ["North", "South", "East", "West"]
    region = rng.choice(regions, size=N)

    # Month with December peak: weight December 3x
    month_probs = np.array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3], dtype=float)
    month_probs /= month_probs.sum()
    month = rng.choice(range(1, 13), size=N, p=month_probs)

    return pd.DataFrame({
        "product_category": product_category,
        "unit_price": unit_price,
        "quantity": quantity,
        "discount": discount,
        "revenue": revenue,
        "region": region,
        "month": month,
    })


def generate_patient_vitals(rng: np.random.Generator) -> pd.DataFrame:
    """
    patient_vitals.csv — 2,000 rows
    Relationships:
      - bmi mildly correlated with age
      - blood_pressure tied to age and bmi
      - cholesterol tied to age and bmi
      - smoker is categorical, affects blood_pressure and diagnosis
      - diagnosis tied to the others
    """
    age = rng.integers(18, 85, size=N)

    # BMI: mildly increases with age, plus noise
    bmi = np.clip(
        22 + (age - 30) * 0.05 + rng.normal(0, 4, size=N),
        15.0, 50.0,
    ).round(1)

    smoker_prob = 0.22
    smoker = rng.choice(["Yes", "No"], size=N, p=[smoker_prob, 1 - smoker_prob])

    # Blood pressure (systolic): tied to age, bmi, and smoking
    bp_base = 100 + age * 0.4 + (bmi - 25) * 0.8
    bp_smoke_bonus = np.where(np.array(smoker) == "Yes", 10, 0)
    blood_pressure = np.clip(
        bp_base + bp_smoke_bonus + rng.normal(0, 8, size=N),
        85, 200,
    ).astype(int)

    # Cholesterol: tied to age and bmi
    cholesterol = np.clip(
        150 + age * 0.6 + (bmi - 25) * 2.5 + rng.normal(0, 20, size=N),
        100, 350,
    ).astype(int)

    # Diagnosis: depends on blood_pressure, cholesterol, bmi, smoker
    diagnoses = []
    for bp, chol, b, s in zip(blood_pressure, cholesterol, bmi, smoker):
        risk_score = 0
        if bp > 140:
            risk_score += 2
        if chol > 240:
            risk_score += 2
        if b > 30:
            risk_score += 1
        if s == "Yes":
            risk_score += 1

        if risk_score >= 4:
            diagnoses.append(rng.choice(["Hypertension", "Heart Disease", "Diabetes"]))
        elif risk_score >= 2:
            diagnoses.append(rng.choice(["Pre-hypertension", "High Cholesterol", "Obesity"]))
        else:
            diagnoses.append("Healthy")

    return pd.DataFrame({
        "age": age,
        "bmi": bmi,
        "blood_pressure": blood_pressure,
        "cholesterol": cholesterol,
        "smoker": smoker,
        "diagnosis": np.array(diagnoses),
    })


def main():
    rng = np.random.default_rng(SEED)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    datasets = {
        "hr_employees": generate_hr_employees(rng),
        "retail_sales": generate_retail_sales(rng),
        "patient_vitals": generate_patient_vitals(rng),
    }

    for name, df in datasets.items():
        path = OUT_DIR / f"{name}.csv"
        df.to_csv(path, index=False)
        print(f"[OK] {name}.csv — {len(df)} rows, {len(df.columns)} cols -> {path}")


if __name__ == "__main__":
    main()
