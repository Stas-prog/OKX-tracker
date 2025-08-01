import { NextResponse } from 'next/server';
import crypto from 'crypto';

const API_KEY = process.env.OKX_API_KEY!;
const API_SECRET = process.env.OKX_API_SECRET!;
const PASSPHRASE = process.env.OKX_API_PASSPHRASE!;
const BASE_URL = 'https://www.okx.com';

function signRequest(timestamp: string, method: string, path: string, body: string) {
    return crypto
        .createHmac('sha256', API_SECRET)
        .update(timestamp + method + path + body)
        .digest('base64');
}

export async function GET() {
    const timestamp = new Date().toISOString();
    const method = 'GET';
    const path = '/api/v5/account/balance';
    const body = '';
    const sign = signRequest(timestamp, method, path, body);

    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
            'OK-ACCESS-KEY': API_KEY,
            'OK-ACCESS-SIGN': sign,
            'OK-ACCESS-TIMESTAMP': timestamp,
            'OK-ACCESS-PASSPHRASE': PASSPHRASE,
            'Content-Type': 'application/json',
        },
    });

    const data = await res.json();
    return NextResponse.json(data);
}
