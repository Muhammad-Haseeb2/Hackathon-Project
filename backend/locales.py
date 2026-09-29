"""
Locale and currency configuration module.
Provides rich multilingual and multi-currency support for:
- Tabular generator
- Relational generator
- Document generator (Invoices and Bank Statements)

Includes safe Faker wrapper with fallback and dedicated Pakistani data generator
for ur_PK (names, addresses, phone numbers, PKR currency).
"""

import re
from typing import Optional, Any
import numpy as np
from faker import Faker

# ── Supported Locales Specification ──

SUPPORTED_LOCALES = {
    'en_US': {
        'code': 'en_US',
        'name': 'English (United States)',
        'country': 'United States',
        'flag': '🇺🇸',
        'currency_code': 'USD',
        'currency_symbol': '$',
        'tax_label': 'Sales Tax',
        'tax_rate': 0.08,
        'date_format': '%m/%d/%Y',
        'faker_locale': 'en_US',
    },
    'en_GB': {
        'code': 'en_GB',
        'name': 'English (United Kingdom)',
        'country': 'United Kingdom',
        'flag': '🇬🇧',
        'currency_code': 'GBP',
        'currency_symbol': '£',
        'tax_label': 'VAT',
        'tax_rate': 0.20,
        'date_format': '%d/%m/%Y',
        'faker_locale': 'en_GB',
    },
    'ur_PK': {
        'code': 'ur_PK',
        'name': 'Pakistan (PKR)',
        'country': 'Pakistan',
        'flag': '🇵🇰',
        'currency_code': 'PKR',
        'currency_symbol': 'Rs.',
        'tax_label': 'GST',
        'tax_rate': 0.17,
        'date_format': '%d/%m/%Y',
        'faker_locale': 'en_US',
        'custom_pakistan': True,
    },
    'de_DE': {
        'code': 'de_DE',
        'name': 'German (Germany)',
        'country': 'Germany',
        'flag': '🇩🇪',
        'currency_code': 'EUR',
        'currency_symbol': '€',
        'tax_label': 'MwSt',
        'tax_rate': 0.19,
        'date_format': '%d.%m.%Y',
        'faker_locale': 'de_DE',
    },
    'fr_FR': {
        'code': 'fr_FR',
        'name': 'French (France)',
        'country': 'France',
        'flag': '🇫🇷',
        'currency_code': 'EUR',
        'currency_symbol': '€',
        'tax_label': 'TVA',
        'tax_rate': 0.20,
        'date_format': '%d/%m/%Y',
        'faker_locale': 'fr_FR',
    },
    'es_ES': {
        'code': 'es_ES',
        'name': 'Spanish (Spain)',
        'country': 'Spain',
        'flag': '🇪🇸',
        'currency_code': 'EUR',
        'currency_symbol': '€',
        'tax_label': 'IVA',
        'tax_rate': 0.21,
        'date_format': '%d/%m/%Y',
        'faker_locale': 'es_ES',
    },
    'it_IT': {
        'code': 'it_IT',
        'name': 'Italian (Italy)',
        'country': 'Italy',
        'flag': '🇮🇹',
        'currency_code': 'EUR',
        'currency_symbol': '€',
        'tax_label': 'IVA',
        'tax_rate': 0.22,
        'date_format': '%d/%m/%Y',
        'faker_locale': 'it_IT',
    },
    'en_CA': {
        'code': 'en_CA',
        'name': 'English (Canada)',
        'country': 'Canada',
        'flag': '🇨🇦',
        'currency_code': 'CAD',
        'currency_symbol': 'CA$',
        'tax_label': 'HST/GST',
        'tax_rate': 0.13,
        'date_format': '%Y-%m-%d',
        'faker_locale': 'en_CA',
    },
    'en_AU': {
        'code': 'en_AU',
        'name': 'English (Australia)',
        'country': 'Australia',
        'flag': '🇦🇺',
        'currency_code': 'AUD',
        'currency_symbol': 'A$',
        'tax_label': 'GST',
        'tax_rate': 0.10,
        'date_format': '%d/%m/%Y',
        'faker_locale': 'en_AU',
    },
    'hi_IN': {
        'code': 'hi_IN',
        'name': 'India (INR)',
        'country': 'India',
        'flag': '🇮🇳',
        'currency_code': 'INR',
        'currency_symbol': '₹',
        'tax_label': 'GST',
        'tax_rate': 0.18,
        'date_format': '%d/%m/%Y',
        'faker_locale': 'hi_IN',
    },
    'ar_SA': {
        'code': 'ar_SA',
        'name': 'Arabic (Saudi Arabia)',
        'country': 'Saudi Arabia',
        'flag': '🇸🇦',
        'currency_code': 'SAR',
        'currency_symbol': '﷼',
        'tax_label': 'VAT',
        'tax_rate': 0.15,
        'date_format': '%d/%m/%Y',
        'faker_locale': 'ar_SA',
    },
    'ar_AE': {
        'code': 'ar_AE',
        'name': 'Arabic (UAE)',
        'country': 'United Arab Emirates',
        'flag': '🇦🇪',
        'currency_code': 'AED',
        'currency_symbol': 'AED',
        'tax_label': 'VAT',
        'tax_rate': 0.05,
        'date_format': '%d/%m/%Y',
        'faker_locale': 'ar_AA' if 'ar_AA' in Faker.__dict__ else 'en_US',
    },
    'ja_JP': {
        'code': 'ja_JP',
        'name': 'Japanese (Japan)',
        'country': 'Japan',
        'flag': '🇯🇵',
        'currency_code': 'JPY',
        'currency_symbol': '¥',
        'tax_label': 'Consumption Tax',
        'tax_rate': 0.10,
        'date_format': '%Y/%m/%d',
        'faker_locale': 'ja_JP',
    },
    'zh_CN': {
        'code': 'zh_CN',
        'name': 'Chinese (China)',
        'country': 'China',
        'flag': '🇨🇳',
        'currency_code': 'CNY',
        'currency_symbol': '¥',
        'tax_label': 'VAT',
        'tax_rate': 0.13,
        'date_format': '%Y-%m-%d',
        'faker_locale': 'zh_CN',
    },
    'tr_TR': {
        'code': 'tr_TR',
        'name': 'Turkish (Turkey)',
        'country': 'Turkey',
        'flag': '🇹🇷',
        'currency_code': 'TRY',
        'currency_symbol': '₺',
        'tax_label': 'KDV',
        'tax_rate': 0.20,
        'date_format': '%d.%m.%Y',
        'faker_locale': 'tr_TR',
    },
    'pt_BR': {
        'code': 'pt_BR',
        'name': 'Portuguese (Brazil)',
        'country': 'Brazil',
        'flag': '🇧🇷',
        'currency_code': 'BRL',
        'currency_symbol': 'R$',
        'tax_label': 'ICMS',
        'tax_rate': 0.17,
        'date_format': '%d/%m/%Y',
        'faker_locale': 'pt_BR',
    },
    'nl_NL': {
        'code': 'nl_NL',
        'name': 'Dutch (Netherlands)',
        'country': 'Netherlands',
        'flag': '🇳🇱',
        'currency_code': 'EUR',
        'currency_symbol': '€',
        'tax_label': 'BTW',
        'tax_rate': 0.21,
        'date_format': '%d-%m-%Y',
        'faker_locale': 'nl_NL',
    },
}

DEFAULT_LOCALE = 'en_US'


# ── Pakistani Data Datasets ──

PAKISTAN_FIRST_NAMES = [
    'Muhammad', 'Ahmed', 'Ali', 'Usman', 'Bilal', 'Hamza', 'Umar', 'Hassan',
    'Hussain', 'Tariq', 'Zain', 'Shahbaz', 'Kamran', 'Imran', 'Waqas', 'Asif',
    'Babar', 'Fakhar', 'Shaheen', 'Naseem', 'Haris', 'Shadab', 'Rizwan',
    'Fatima', 'Ayesha', 'Zainab', 'Maryam', 'Sana', 'Hira', 'Sadia', 'Noor',
    'Mahnoor', 'Sidra', 'Khadija', 'Alizeh', 'Anum', 'Amna', 'Iqra', 'Rabia'
]

PAKISTAN_LAST_NAMES = [
    'Khan', 'Malik', 'Chaudhry', 'Butt', 'Qureshi', 'Siddiqui', 'Sheikh',
    'Shah', 'Ansari', 'Abbasi', 'Mughal', 'Raja', 'Bhatti', 'Gill', 'Akhtar',
    'Farooq', 'Rehman', 'Javed', 'Mirza', 'Baig', 'Dar', 'Wani', 'Niazi'
]

PAKISTAN_CITIES = [
    'Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad',
    'Multan', 'Peshawar', 'Quetta', 'Sialkot', 'Gujranwala', 'Hyderabad'
]

PAKISTAN_AREAS = [
    'DHA Phase 5', 'DHA Phase 6', 'Gulberg III', 'Model Town', 'F-7/2',
    'F-8/3', 'G-11/1', 'Blue Area', 'Clifton Block 2', 'Bahria Town Phase 4',
    'Saddar', 'Cantt', 'Satellite Town', 'Civil Lines', 'Johar Town'
]

PAKISTAN_BANKS = [
    'Habib Bank Limited (HBL)', 'Meezan Bank', 'United Bank Limited (UBL)',
    'MCB Bank', 'Allied Bank Limited (ABL)', 'Bank Alfalah',
    'Standard Chartered Bank Pakistan', 'Faysal Bank', 'Askari Bank'
]

PAKISTAN_COMPANIES = [
    'Systems Limited', 'Engro Corporation', 'Lucky Cement', 'Habib Metro',
    'Fatima Fertilizer', 'Jazz (PMCL)', 'Telenor Pakistan', 'Zong CMPak',
    'Packages Limited', 'Interloop Limited', 'FrieslandCampina Engro'
]


class PakistanDataProvider:
    """Provides authentic Pakistani synthetic data for names, addresses, and phones."""

    def __init__(self, rng: np.random.Generator):
        self.rng = rng

    def name(self) -> str:
        first = self.rng.choice(PAKISTAN_FIRST_NAMES)
        last = self.rng.choice(PAKISTAN_LAST_NAMES)
        return f"{first} {last}"

    def address(self) -> str:
        house_num = self.rng.integers(1, 250)
        street_num = self.rng.integers(1, 40)
        area = self.rng.choice(PAKISTAN_AREAS)
        city = self.rng.choice(PAKISTAN_CITIES)
        return f"House {house_num}, Street {street_num}, {area}, {city}"

    def city(self) -> str:
        return str(self.rng.choice(PAKISTAN_CITIES))

    def phone_number(self) -> str:
        # Pakistani mobile prefixes: 0300, 0321, 0333, 0345, 0312
        prefix = self.rng.choice(['300', '301', '321', '333', '345', '312', '315'])
        suffix = self.rng.integers(1000000, 9999999)
        return f"+92 {prefix} {suffix}"

    def company(self) -> str:
        return str(self.rng.choice(PAKISTAN_COMPANIES))

    def bank(self) -> str:
        return str(self.rng.choice(PAKISTAN_BANKS))


def get_locale_config(locale_code: str) -> dict:
    """Get the configuration for a locale code, falling back to en_US."""
    return SUPPORTED_LOCALES.get(locale_code, SUPPORTED_LOCALES[DEFAULT_LOCALE])


def get_safe_faker(locale_code: str, seed: Optional[int] = None) -> tuple[Faker, dict, Optional[PakistanDataProvider]]:
    """
    Safely instantiate Faker without crashing on unsupported locales (e.g. ur_PK).
    Seeds the instance deterministically with seed_instance(seed).

    Returns:
        (faker_instance, locale_config, pakistan_provider_or_none)
    """
    config = get_locale_config(locale_code)
    faker_locale = config.get('faker_locale', 'en_US')

    try:
        fake = Faker(faker_locale)
    except Exception:
        fake = Faker('en_US')

    if seed is not None:
        Faker.seed(seed)
        try:
            fake.seed_instance(seed)
        except Exception:
            pass

    rng = np.random.default_rng(seed)
    pk_provider = None
    if config.get('custom_pakistan') or locale_code.lower().startswith('ur'):
        pk_provider = PakistanDataProvider(rng)

    return fake, config, pk_provider
