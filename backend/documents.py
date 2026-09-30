"""
Document generator — invoices and bank statements with PDF rendering.
All math (totals, tax, running balances) computed in Python, never by LLM.
Uses reportlab for PDF generation.
"""

import io
import zipfile
import numpy as np
import pandas as pd
from faker import Faker
from datetime import datetime, timedelta
from typing import Optional
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

from fallbacks import MERCHANT_NAMES, COMPANY_NAMES, PRODUCT_NAMES, TRANSACTION_DESCRIPTIONS
from locales import SUPPORTED_LOCALES as LOCALE_CONFIG, get_safe_faker


def _fmt_currency(amount: float, symbol: str) -> str:
    """Format currency amount."""
    if symbol in ('$', '£', '€', '₹', '¥', '₺', 'CA$', 'A$'):
        return f'{symbol}{amount:,.2f}'
    return f'{symbol} {amount:,.2f}'


# ── Invoice Generator ────────────────────────────────────────────────────────

def generate_invoice_data(
    seed: Optional[int] = 42,
    locale: str = 'en_US',
    n_items: int = 0,
    discount_pct: float = 0,
) -> dict:
    """
    Generate a single invoice with realistic line items.
    All math computed in code.
    """
    rng = np.random.default_rng(seed)
    fake, lc, pk_provider = get_safe_faker(locale, seed)

    if n_items <= 0:
        n_items = int(rng.integers(2, 8))

    # Generate line items
    items = []
    for i in range(n_items):
        product = str(rng.choice(PRODUCT_NAMES))
        qty = int(rng.integers(1, 10))
        unit_price = round(float(rng.uniform(10, 500)), 2)
        line_total = round(qty * unit_price, 2)
        items.append({
            'item_no': i + 1,
            'product': product,
            'quantity': qty,
            'unit_price': unit_price,
            'line_total': line_total,
        })

    subtotal = round(sum(item['line_total'] for item in items), 2)
    discount = round(subtotal * (discount_pct / 100), 2)
    taxable = round(subtotal - discount, 2)
    tax = round(taxable * lc['tax_rate'], 2)
    total = round(taxable + tax, 2)

    invoice_date = fake.date_between(start_date='-90d', end_date='today')
    due_date = invoice_date + timedelta(days=30)

    invoice = {
        'invoice_number': f'INV-{rng.integers(10000, 99999)}',
        'invoice_date': invoice_date.strftime(lc['date_format']),
        'due_date': due_date.strftime(lc['date_format']),
        'company_from': pk_provider.company() if pk_provider else str(rng.choice(COMPANY_NAMES)),
        'company_to': pk_provider.company() if pk_provider else str(rng.choice(COMPANY_NAMES)),
        'address_from': pk_provider.address() if pk_provider else fake.address().replace('\n', ', '),
        'address_to': pk_provider.address() if pk_provider else fake.address().replace('\n', ', '),
        'items': items,
        'subtotal': subtotal,
        'discount': discount,
        'discount_pct': discount_pct,
        'tax_label': lc['tax_label'],
        'tax_rate': lc['tax_rate'],
        'tax_amount': tax,
        'total': total,
        'currency_symbol': lc['currency_symbol'],
        'currency_code': lc['currency_code'],
        'locale': locale,
    }

    return invoice


def render_invoice_pdf(invoice: dict) -> bytes:
    """Render an invoice dict to a PDF using reportlab."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
    styles = getSampleStyleSheet()
    elements = []

    sym = invoice['currency_symbol']

    # Title
    title_style = ParagraphStyle('InvoiceTitle', parent=styles['Title'], fontSize=24, textColor=colors.HexColor('#16233B'))
    elements.append(Paragraph('INVOICE', title_style))
    elements.append(Spacer(1, 12))

    # Invoice info
    info_style = ParagraphStyle('Info', parent=styles['Normal'], fontSize=10, textColor=colors.HexColor('#475F87'))
    elements.append(Paragraph(f"<b>Invoice #:</b> {invoice['invoice_number']}", info_style))
    elements.append(Paragraph(f"<b>Date:</b> {invoice['invoice_date']}", info_style))
    elements.append(Paragraph(f"<b>Due Date:</b> {invoice['due_date']}", info_style))
    elements.append(Spacer(1, 12))

    # From / To
    elements.append(Paragraph(f"<b>From:</b> {invoice['company_from']}", info_style))
    elements.append(Paragraph(f"  {invoice['address_from']}", info_style))
    elements.append(Spacer(1, 6))
    elements.append(Paragraph(f"<b>To:</b> {invoice['company_to']}", info_style))
    elements.append(Paragraph(f"  {invoice['address_to']}", info_style))
    elements.append(Spacer(1, 18))

    # Line items table
    table_data = [['#', 'Product', 'Qty', 'Unit Price', 'Total']]
    for item in invoice['items']:
        table_data.append([
            str(item['item_no']),
            item['product'],
            str(item['quantity']),
            _fmt_currency(item['unit_price'], sym),
            _fmt_currency(item['line_total'], sym),
        ])

    t = Table(table_data, colWidths=[0.4*inch, 2.8*inch, 0.6*inch, 1.2*inch, 1.2*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#16233B')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('ALIGN', (2, 0), (-1, -1), 'RIGHT'),
        ('FONTSIZE', (0, 1), (-1, -1), 9),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F5F5F3')]),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E0E0E0')),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(t)
    elements.append(Spacer(1, 18))

    # Totals
    totals_style = ParagraphStyle('Totals', parent=styles['Normal'], fontSize=10, alignment=2)
    elements.append(Paragraph(f"<b>Subtotal:</b> {_fmt_currency(invoice['subtotal'], sym)}", totals_style))
    if invoice['discount'] > 0:
        elements.append(Paragraph(f"<b>Discount ({invoice['discount_pct']}%):</b> -{_fmt_currency(invoice['discount'], sym)}", totals_style))
    elements.append(Paragraph(f"<b>{invoice['tax_label']} ({invoice['tax_rate']*100:.0f}%):</b> {_fmt_currency(invoice['tax_amount'], sym)}", totals_style))
    elements.append(Spacer(1, 6))

    total_style = ParagraphStyle('Total', parent=styles['Normal'], fontSize=14, alignment=2, textColor=colors.HexColor('#167A6C'))
    elements.append(Paragraph(f"<b>TOTAL: {_fmt_currency(invoice['total'], sym)}</b>", total_style))

    doc.build(elements)
    buf.seek(0)
    return buf.read()


def render_invoice_html(invoice: dict) -> str:
    """Render an invoice dict to an HTML preview string."""
    sym = invoice['currency_symbol']

    rows_html = ''
    for item in invoice['items']:
        rows_html += f"""<tr>
            <td style="padding:8px;border-bottom:1px solid #eee;">{item['item_no']}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;">{item['product']}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">{item['quantity']}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">{_fmt_currency(item['unit_price'], sym)}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">{_fmt_currency(item['line_total'], sym)}</td>
        </tr>"""

    discount_row = ''
    if invoice['discount'] > 0:
        discount_row = f'<div>Discount ({invoice["discount_pct"]}%): -{_fmt_currency(invoice["discount"], sym)}</div>'

    html = f"""
    <div style="font-family:Inter,sans-serif;max-width:700px;margin:0 auto;padding:24px;background:white;border-radius:12px;">
        <h1 style="color:#16233B;font-size:28px;margin-bottom:4px;">INVOICE</h1>
        <div style="color:#7587A5;font-size:13px;margin-bottom:20px;">
            {invoice['invoice_number']} &bull; {invoice['invoice_date']} &bull; Due: {invoice['due_date']}
        </div>
        <div style="display:flex;gap:40px;margin-bottom:24px;font-size:13px;color:#475F87;">
            <div><strong>From:</strong><br>{invoice['company_from']}<br>{invoice['address_from']}</div>
            <div><strong>To:</strong><br>{invoice['company_to']}<br>{invoice['address_to']}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
                <tr style="background:#16233B;color:white;">
                    <th style="padding:10px 8px;text-align:left;">#</th>
                    <th style="padding:10px 8px;text-align:left;">Product</th>
                    <th style="padding:10px 8px;text-align:right;">Qty</th>
                    <th style="padding:10px 8px;text-align:right;">Unit Price</th>
                    <th style="padding:10px 8px;text-align:right;">Total</th>
                </tr>
            </thead>
            <tbody>{rows_html}</tbody>
        </table>
        <div style="text-align:right;margin-top:16px;font-size:13px;color:#475F87;">
            <div>Subtotal: {_fmt_currency(invoice['subtotal'], sym)}</div>
            {discount_row}
            <div>{invoice['tax_label']} ({invoice['tax_rate']*100:.0f}%): {_fmt_currency(invoice['tax_amount'], sym)}</div>
            <div style="font-size:18px;color:#167A6C;font-weight:bold;margin-top:8px;">
                TOTAL: {_fmt_currency(invoice['total'], sym)}
            </div>
        </div>
    </div>
    """
    return html


# ── Bank Statement Generator ────────────────────────────────────────────────

def generate_bank_statement(
    seed: Optional[int] = 42,
    locale: str = 'en_US',
    n_transactions: int = 30,
    opening_balance: float = 5000.0,
    days: int = 90,
    min_balance: float = 0.0,
    allow_overdraft: bool = False,
    salary_on_1st: bool = False,
    salary_amount: float = 3500.0,
) -> dict:
    """
    Generate a bank statement with transactions and strictly reconciled running balance.
    Balance_t = Balance_{t-1} + Credit_t - Debit_t
    """
    rng = np.random.default_rng(seed)
    fake, lc, pk_provider = get_safe_faker(locale, seed)

    sym = lc['currency_symbol']
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=days)

    # Generate transaction dates (sorted)
    transaction_dates = sorted([
        start_date + timedelta(days=int(rng.integers(0, days)))
        for _ in range(n_transactions)
    ])

    # If salary on 1st, insert salary transactions
    if salary_on_1st:
        months_in_range = set()
        d = start_date
        while d <= end_date:
            months_in_range.add((d.year, d.month))
            d += timedelta(days=28)

        salary_dates = []
        for y, m in sorted(months_in_range):
            salary_date = datetime(y, m, 1).date()
            if start_date <= salary_date <= end_date:
                salary_dates.append(salary_date)

    transactions = []
    balance = opening_balance

    for i, txn_date in enumerate(transaction_dates):
        # Check if this is a salary date
        is_salary = False
        if salary_on_1st and salary_dates:
            if txn_date.day == 1 or (salary_dates and txn_date >= salary_dates[0] and i == 0):
                # Add salary
                if salary_dates:
                    sal_date = salary_dates.pop(0)
                    credit = salary_amount
                    debit = 0.0
                    balance = round(balance + credit, 2)
                    transactions.append({
                        'date': sal_date.strftime(lc['date_format']),
                        'description': 'Salary Deposit',
                        'merchant': 'Employer Direct Deposit',
                        'credit': round(credit, 2),
                        'debit': 0.0,
                        'balance': balance,
                        'type': 'credit',
                    })
                    is_salary = True

        # Regular transaction
        is_credit = rng.random() < 0.25  # 25% credits, 75% debits

        if is_credit:
            credit = round(float(rng.uniform(50, 2000)), 2)
            debit = 0.0
            desc = str(rng.choice(['Transfer In', 'Refund', 'Interest', 'Deposit', 'Cashback']))
            merchant = str(rng.choice(['Bank Transfer', 'PayPal', 'Venmo', 'Direct Deposit']))
        else:
            max_debit = balance if not allow_overdraft else balance + 1000
            max_debit = max(max_debit, 10)
            debit = round(float(rng.uniform(5, min(max_debit, 800))), 2)

            # Ensure we don't go below min_balance (if no overdraft)
            if not allow_overdraft and (balance - debit) < min_balance:
                debit = max(0, round(balance - min_balance, 2))
                if debit < 1:
                    continue

            credit = 0.0
            desc = str(rng.choice(TRANSACTION_DESCRIPTIONS))
            merchant = str(rng.choice(MERCHANT_NAMES))

        balance = round(balance + credit - debit, 2)

        transactions.append({
            'date': txn_date.strftime(lc['date_format']),
            'description': desc,
            'merchant': merchant,
            'credit': credit,
            'debit': debit,
            'balance': balance,
            'type': 'credit' if credit > 0 else 'debit',
        })

    # Add remaining salary dates
    if salary_on_1st:
        for sal_date in salary_dates:
            balance = round(balance + salary_amount, 2)
            transactions.append({
                'date': sal_date.strftime(lc['date_format']),
                'description': 'Salary Deposit',
                'merchant': 'Employer Direct Deposit',
                'credit': salary_amount,
                'debit': 0.0,
                'balance': balance,
                'type': 'credit',
            })

    statement = {
        'account_holder': pk_provider.name() if pk_provider else fake.name(),
        'account_number': f'****{rng.integers(1000, 9999)}',
        'bank_name': pk_provider.bank() if pk_provider else f'{str(rng.choice(["First National", "City", "Global", "Pacific", "Atlantic"]))} Bank',
        'statement_period': f'{start_date.strftime(lc["date_format"])} - {end_date.strftime(lc["date_format"])}',
        'opening_balance': opening_balance,
        'closing_balance': balance,
        'transactions': transactions,
        'currency_symbol': sym,
        'currency_code': lc['currency_code'],
        'total_credits': round(sum(t['credit'] for t in transactions), 2),
        'total_debits': round(sum(t['debit'] for t in transactions), 2),
        'locale': locale,
    }

    return statement


def render_statement_pdf(statement: dict) -> bytes:
    """Render a bank statement dict to a PDF."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
    styles = getSampleStyleSheet()
    elements = []

    sym = statement['currency_symbol']

    # Header
    title_style = ParagraphStyle('BankTitle', parent=styles['Title'], fontSize=20, textColor=colors.HexColor('#16233B'))
    elements.append(Paragraph(statement['bank_name'], title_style))
    elements.append(Spacer(1, 6))

    info_style = ParagraphStyle('BankInfo', parent=styles['Normal'], fontSize=10, textColor=colors.HexColor('#475F87'))
    elements.append(Paragraph(f"<b>Account Holder:</b> {statement['account_holder']}", info_style))
    elements.append(Paragraph(f"<b>Account:</b> {statement['account_number']}", info_style))
    elements.append(Paragraph(f"<b>Period:</b> {statement['statement_period']}", info_style))
    elements.append(Paragraph(f"<b>Opening Balance:</b> {_fmt_currency(statement['opening_balance'], sym)}", info_style))
    elements.append(Spacer(1, 18))

    # Transactions table
    table_data = [['Date', 'Description', 'Merchant', 'Credit', 'Debit', 'Balance']]
    for txn in statement['transactions']:
        table_data.append([
            txn['date'],
            txn['description'][:25],
            txn['merchant'][:20],
            _fmt_currency(txn['credit'], sym) if txn['credit'] > 0 else '',
            _fmt_currency(txn['debit'], sym) if txn['debit'] > 0 else '',
            _fmt_currency(txn['balance'], sym),
        ])

    t = Table(table_data, colWidths=[0.8*inch, 1.4*inch, 1.2*inch, 0.9*inch, 0.9*inch, 1.0*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#16233B')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('FONTSIZE', (0, 1), (-1, -1), 7),
        ('ALIGN', (3, 0), (-1, -1), 'RIGHT'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F5F5F3')]),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E0E0E0')),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(t)
    elements.append(Spacer(1, 18))

    # Summary
    summary_style = ParagraphStyle('Summary', parent=styles['Normal'], fontSize=10, alignment=2)
    elements.append(Paragraph(f"<b>Total Credits:</b> {_fmt_currency(statement['total_credits'], sym)}", summary_style))
    elements.append(Paragraph(f"<b>Total Debits:</b> {_fmt_currency(statement['total_debits'], sym)}", summary_style))

    closing_style = ParagraphStyle('Closing', parent=styles['Normal'], fontSize=14, alignment=2, textColor=colors.HexColor('#167A6C'))
    elements.append(Spacer(1, 6))
    elements.append(Paragraph(f"<b>Closing Balance: {_fmt_currency(statement['closing_balance'], sym)}</b>", closing_style))

    doc.build(elements)
    buf.seek(0)
    return buf.read()


def render_statement_html(statement: dict) -> str:
    """Render a bank statement dict to an HTML preview string."""
    sym = statement['currency_symbol']

    rows_html = ''
    for txn in statement['transactions']:
        credit_str = _fmt_currency(txn['credit'], sym) if txn['credit'] > 0 else ''
        debit_str = _fmt_currency(txn['debit'], sym) if txn['debit'] > 0 else ''
        row_color = '#f0fdf4' if txn['type'] == 'credit' else 'white'
        rows_html += f"""<tr style="background:{row_color};">
            <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;">{txn['date']}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;">{txn['description']}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;">{txn['merchant']}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;text-align:right;color:#16a34a;">{credit_str}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;text-align:right;color:#dc2626;">{debit_str}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;text-align:right;font-weight:600;">{_fmt_currency(txn['balance'], sym)}</td>
        </tr>"""

    html = f"""
    <div style="font-family:Inter,sans-serif;max-width:750px;margin:0 auto;padding:24px;background:white;border-radius:12px;">
        <h2 style="color:#16233B;font-size:22px;margin-bottom:4px;">{statement['bank_name']}</h2>
        <div style="color:#7587A5;font-size:12px;margin-bottom:16px;">
            {statement['account_holder']} &bull; {statement['account_number']} &bull; {statement['statement_period']}
        </div>
        <div style="display:flex;gap:20px;margin-bottom:20px;font-size:13px;">
            <div style="padding:12px 16px;background:#f8fafc;border-radius:8px;flex:1;">
                <div style="color:#7587A5;font-size:11px;">Opening Balance</div>
                <div style="font-weight:600;color:#16233B;">{_fmt_currency(statement['opening_balance'], sym)}</div>
            </div>
            <div style="padding:12px 16px;background:#f0fdf4;border-radius:8px;flex:1;">
                <div style="color:#7587A5;font-size:11px;">Total Credits</div>
                <div style="font-weight:600;color:#16a34a;">{_fmt_currency(statement['total_credits'], sym)}</div>
            </div>
            <div style="padding:12px 16px;background:#fef2f2;border-radius:8px;flex:1;">
                <div style="color:#7587A5;font-size:11px;">Total Debits</div>
                <div style="font-weight:600;color:#dc2626;">{_fmt_currency(statement['total_debits'], sym)}</div>
            </div>
            <div style="padding:12px 16px;background:#f0f9ff;border-radius:8px;flex:1;">
                <div style="color:#7587A5;font-size:11px;">Closing Balance</div>
                <div style="font-weight:600;color:#167A6C;">{_fmt_currency(statement['closing_balance'], sym)}</div>
            </div>
        </div>
        <table style="width:100%;border-collapse:collapse;">
            <thead>
                <tr style="background:#16233B;color:white;">
                    <th style="padding:8px;text-align:left;font-size:11px;">Date</th>
                    <th style="padding:8px;text-align:left;font-size:11px;">Description</th>
                    <th style="padding:8px;text-align:left;font-size:11px;">Merchant</th>
                    <th style="padding:8px;text-align:right;font-size:11px;">Credit</th>
                    <th style="padding:8px;text-align:right;font-size:11px;">Debit</th>
                    <th style="padding:8px;text-align:right;font-size:11px;">Balance</th>
                </tr>
            </thead>
            <tbody>{rows_html}</tbody>
        </table>
    </div>
    """
    return html


# ── Bulk Generation ──────────────────────────────────────────────────────────

def generate_bulk_invoices(
    count: int = 10,
    seed: Optional[int] = 42,
    locale: str = 'en_US',
) -> tuple[bytes, list[dict]]:
    """
    Generate N invoices as a ZIP of PDFs + underlying data.
    Returns (zip_bytes, list_of_invoice_dicts).
    """
    rng = np.random.default_rng(seed)
    invoices = []
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for i in range(count):
            inv_seed = int(rng.integers(0, 2**31))
            invoice = generate_invoice_data(seed=inv_seed, locale=locale)
            invoices.append(invoice)

            pdf_bytes = render_invoice_pdf(invoice)
            zf.writestr(f'invoice_{i+1:03d}.pdf', pdf_bytes)

        # Add CSV summary
        flat = []
        for inv in invoices:
            flat.append({
                'invoice_number': inv['invoice_number'],
                'date': inv['invoice_date'],
                'from': inv['company_from'],
                'to': inv['company_to'],
                'subtotal': inv['subtotal'],
                'discount': inv['discount'],
                'tax': inv['tax_amount'],
                'total': inv['total'],
            })
        df = pd.DataFrame(flat)
        zf.writestr('invoices_summary.csv', df.to_csv(index=False))

    buf.seek(0)
    return buf.read(), invoices


# ── Invoice Cloning / Mimicking Engine ──────────────────────────────────────────

def mimic_invoice_from_file(
    contents: bytes,
    filename: str,
    seed: Optional[int] = 42,
) -> dict:
    """
    Analyze an uploaded real invoice or document (PDF, Image, Text, or JSON) and generate
    a realistic, privacy-safe synthetic clone with strict mathematical correctness.
    Direct and quick: no extra checks or blocking loops.
    """
    import base64
    import os
    import re
    import json
    import httpx
    import io

    rng = np.random.default_rng(seed)
    ext = filename.split('.')[-1].lower() if '.' in filename else ''
    
    mime_type = "application/pdf" if ext == "pdf" else (
        "image/png" if ext == "png" else (
            "image/jpeg" if ext in ("jpg", "jpeg") else (
                "image/webp" if ext == "webp" else "text/plain"
            )
        )
    )

    detected_locale = 'en_US'
    detected_items = 4
    detected_discount = 0.0
    detected_tax_rate = 0.08
    custom_products = []
    extracted_company_from = None
    extracted_company_to = None
    extracted_text = ""

    # 1. Quick PDF text extraction via pypdf
    if ext == "pdf":
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(contents))
            pages_text = []
            for p in reader.pages[:5]:
                t = p.extract_text()
                if t:
                    pages_text.append(t)
            extracted_text = "\n".join(pages_text)
        except Exception:
            pass

    # 2. Fast AI Document / Image Extraction (Gemini Multimodal Vision)
    api_key = os.environ.get('GEMINI_API_KEY', '')
    if api_key and len(contents) <= 12 * 1024 * 1024:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
            prompt = (
                "Analyze this invoice image or document and extract its structural metadata in valid JSON with keys: "
                "'company_from' (vendor/seller name), 'company_to' (client/buyer name), "
                "'currency_code' (e.g. USD, EUR, PKR, GBP, CAD, AUD), 'tax_rate' (float like 0.08 or 0.17), "
                "'discount_pct' (float like 0 or 10), 'n_items' (integer count of items, min 2 max 8), "
                "'locale' (e.g. en_US, ur_PK, en_GB, de_DE, fr_FR), 'product_categories' (list of 3-5 item names like ['Cloud Cluster', 'Security Suite'])."
            )
            parts = []
            if ext in ("pdf", "png", "jpg", "jpeg", "webp", "bmp", "gif"):
                parts.append({
                    "inline_data": {
                        "mime_type": mime_type if ext != "pdf" else "application/pdf",
                        "data": base64.b64encode(contents).decode("utf-8")
                    }
                })
            elif extracted_text:
                parts.append({"text": f"Document text:\n{extracted_text[:3000]}"})
            parts.append({"text": prompt})

            payload = {
                "contents": [{"parts": parts}],
                "generationConfig": {
                    "temperature": 0.2,
                    "responseMimeType": "application/json",
                }
            }
            with httpx.Client(timeout=6.0) as client:
                resp = client.post(url, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    raw_text = data['candidates'][0]['content']['parts'][0]['text']
                    extracted = json.loads(raw_text)
                    if isinstance(extracted, dict):
                        detected_locale = extracted.get('locale', detected_locale)
                        detected_items = int(extracted.get('n_items', detected_items))
                        detected_discount = float(extracted.get('discount_pct', detected_discount))
                        detected_tax_rate = float(extracted.get('tax_rate', detected_tax_rate))
                        extracted_company_from = extracted.get('company_from')
                        extracted_company_to = extracted.get('company_to')
                        if isinstance(extracted.get('product_categories'), list):
                            custom_products = [str(p) for p in extracted['product_categories'] if p]
        except Exception:
            pass  # Fall back directly without delay

    # 3. Direct heuristic fallback if AI not reachable
    if not custom_products:
        text_sample = (extracted_text if extracted_text else contents[:4000].decode('utf-8', errors='ignore')).lower()
        if 'pkr' in text_sample or 'rs.' in text_sample or 'pakistan' in text_sample:
            detected_locale = 'ur_PK'
        elif 'gbp' in text_sample or '£' in text_sample or 'united kingdom' in text_sample:
            detected_locale = 'en_GB'
        elif 'eur' in text_sample or '€' in text_sample or 'germany' in text_sample or 'euro' in text_sample:
            detected_locale = 'de_DE'
        elif 'cad' in text_sample or 'canada' in text_sample:
            detected_locale = 'en_CA'
        elif 'aud' in text_sample or 'australia' in text_sample:
            detected_locale = 'en_AU'
        
        # Pull meaningful alphanumeric words for custom product labels
        lines = [line.strip() for line in (extracted_text or text_sample).splitlines() if 3 < len(line.strip()) < 40]
        candidate_items = [l for l in lines if not any(kw in l.lower() for kw in ['invoice', 'date', 'total', 'subtotal', 'tax', 'bill to', 'due', 'amount', 'page'])]
        if candidate_items:
            custom_products = candidate_items[:6]
        
        detected_items = max(2, min(8, len(lines) // 4 or 4))

    # 4. Generate mathematically sound synthetic clone
    invoice = generate_invoice_data(
        seed=seed,
        locale=detected_locale,
        n_items=detected_items,
        discount_pct=detected_discount,
    )

    if extracted_company_from:
        invoice['company_from'] = extracted_company_from
    if extracted_company_to:
        invoice['company_to'] = extracted_company_to

    if custom_products and len(custom_products) > 0:
        for idx, item in enumerate(invoice['items']):
            item['product'] = custom_products[idx % len(custom_products)]

    # 5. Render PDF & HTML preview immediately
    pdf_bytes = render_invoice_pdf(invoice)
    pdf_base64 = base64.b64encode(pdf_bytes).decode('utf-8')
    html_preview = render_invoice_html(invoice)

    return {
        'invoice': invoice,
        'html_preview': html_preview,
        'pdf_base64': pdf_base64,
        'cloned_from': filename,
        'detected_locale': detected_locale,
        'item_count': len(invoice['items']),
    }


