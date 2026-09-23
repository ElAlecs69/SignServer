import httpx

pdf = b"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 18 Tf 50 100 Td (Demo PDF) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000010 00000 n
0000000066 00000 n
0000000122 00000 n
0000000245 00000 n
0000000476 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
540
%%EOF
"""

with httpx.Client(verify=False, follow_redirects=True) as client:
    login = client.get('https://172.18.117.229:9443/auth/login', params={'email':'admin@demo.test','password':'demo123'})
    print('LOGIN_STATUS', login.status_code)
    print('LOGIN_LOCATION', login.headers.get('location'))
    print('COOKIE_SET', bool(client.cookies.get('session')))
    csrf = client.get('https://172.18.117.229:9443/api/csrf').json()['token']
    print('CSRF_LEN', len(csrf))
    upload = client.post(
        'https://172.18.117.229:9443/api/documents',
        files={'file': ('demo.pdf', pdf, 'application/pdf')},
        headers={'X-CSRF-Token': csrf},
    )
    print('UPLOAD_STATUS', upload.status_code)
    print('UPLOAD_BODY', upload.text)
