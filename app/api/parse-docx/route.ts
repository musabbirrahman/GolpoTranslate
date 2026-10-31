import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const result = await mammoth.extractRawText({ buffer });
    const rawText = (result.value || '').trim();

    return NextResponse.json({ text: rawText });
  } catch (err: unknown) {
    console.error('DOCX parsing error:', err);
    const message =
      err instanceof Error ? err.message : 'Failed to extract text from DOCX file.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
