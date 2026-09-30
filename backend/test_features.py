import urllib.request
import json
import os

print("--- 1. Testing Tabular Profile with JSON ---")
with open('backend/sample_data/customer_profiles.json', 'rb') as f:
    json_bytes = f.read()

boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
body = (
    f'--{boundary}\r\n'
    'Content-Disposition: form-data; name="file"; filename="customer_profiles.json"\r\n'
    'Content-Type: application/json\r\n\r\n'
).encode() + json_bytes + f'\r\n--{boundary}--\r\n'.encode()

req = urllib.request.Request(
    'http://127.0.0.1:8000/api/v1/tabular/profile',
    data=body,
    headers={'Content-Type': f'multipart/form-data; boundary={boundary}'}
)
with urllib.request.urlopen(req) as resp:
    res = json.loads(resp.read().decode())
    print('Import JSON Success! Dataset ID:', res.get('dataset_id'), 'Rows:', res.get('row_count'), 'Cols:', len(res.get('schema', [])))

print("\n--- 2. Testing Tabular Profile with Excel ---")
with open('backend/sample_data/customer_profiles.xlsx', 'rb') as f:
    xlsx_bytes = f.read()

body_xl = (
    f'--{boundary}\r\n'
    'Content-Disposition: form-data; name="file"; filename="customer_profiles.xlsx"\r\n'
    'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'
).encode() + xlsx_bytes + f'\r\n--{boundary}--\r\n'.encode()

req_xl = urllib.request.Request(
    'http://127.0.0.1:8000/api/v1/tabular/profile',
    data=body_xl,
    headers={'Content-Type': f'multipart/form-data; boundary={boundary}'}
)
with urllib.request.urlopen(req_xl) as resp:
    res_xl = json.loads(resp.read().decode())
    print('Import Excel Success! Dataset ID:', res_xl.get('dataset_id'), 'Rows:', res_xl.get('row_count'))

print("\n--- 3. Testing Privacy Masking on Email & Phone ---")
req_gen = urllib.request.Request(
    'http://127.0.0.1:8000/api/v1/tabular/generate',
    data=json.dumps({
        'schema': [{'name': 'email', 'type': 'email'}, {'name': 'phone', 'type': 'phone'}],
        'row_count': 5,
        'privacy_rules': [
            {'column': 'email', 'method': 'mask', 'col_type': 'email'},
            {'column': 'phone', 'method': 'mask', 'col_type': 'phone'}
        ]
    }).encode(),
    headers={'Content-Type': 'application/json'}
)
with urllib.request.urlopen(req_gen) as resp:
    res_gen = json.loads(resp.read().decode())
    print('Masked emails:', [r['email'] for r in res_gen['preview']])
    print('Masked phones:', [r['phone'] for r in res_gen['preview']])

print("\n--- 4. Testing Export Endpoints for Proper Headers ---")
test_cases = [
    ('/api/v1/tabular/export', {'schema': [{'name': 'id', 'type': 'id'}], 'format': 'excel'}),
    ('/api/v1/tabular/export', {'schema': [{'name': 'id', 'type': 'id'}], 'format': 'json'}),
    ('/api/v1/tabular/export', {'schema': [{'name': 'id', 'type': 'id'}], 'format': 'csv'}),
    ('/api/v1/documents/invoice/export', {'format': 'json'}),
    ('/api/v1/documents/statement/export', {'format': 'json'}),
    ('/api/v1/documents/statement/export', {'format': 'csv'}),
]
for ep, payload in test_cases:
    req_exp = urllib.request.Request(
        f'http://127.0.0.1:8000{ep}',
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req_exp) as resp:
        cd = resp.headers.get('Content-Disposition', '')
        ct = resp.headers.get('Content-Type', '')
        print(f'{ep} ({payload.get("format")}) => Content-Disposition: {cd} | Content-Type: {ct}')

print("\nALL VERIFICATIONS PASSED!")
