import { NextResponse } from 'next/server';
import { sendTelegramMessage } from '@/utils/sendTelegramMessage';

export async function GET() {
    await sendTelegramMessage('🚀 Привіт із трейдера Фіфсіка!');
    return NextResponse.json({ status: 'sent' });
}
