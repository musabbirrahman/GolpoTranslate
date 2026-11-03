import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeAuthorVoice,
  analyzeStoryUnderstanding,
  refineSingleParagraph,
  runLiteraryEditingPass,
  translateChunkFaithfully,
  verifyTranslationAccuracy,
} from '@/lib/gemini-service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { operation } = body;

    switch (operation) {
      case 'stage1_understanding': {
        const result = await analyzeStoryUnderstanding({
          text: body.text || '',
          projectTitle: body.projectTitle || 'Untitled Story',
          genre: body.genre || 'Literary Fiction',
          existingCharacters: body.existingCharacters || [],
          existingTerminology: body.existingTerminology || [],
          existingStoryContext: body.existingStoryContext || null,
        });
        return NextResponse.json(result);
      }

      case 'stage2_voice': {
        const styleProfile = await analyzeAuthorVoice({
          text: body.text || '',
          projectTitle: body.projectTitle || 'Untitled Story',
          authorName: body.authorName || 'Unknown Author',
          genre: body.genre || 'Literary Fiction',
        });
        return NextResponse.json({ styleProfile });
      }

      case 'stage3_translate_chunk': {
        const translatedParagraphs = await translateChunkFaithfully({
          paragraphs: body.paragraphs || [],
          previousContextParagraphs: body.previousContextParagraphs || [],
          styleProfile: body.styleProfile || null,
          storyContext: body.storyContext || null,
          characters: body.characters || [],
          terminology: body.terminology || [],
          styleControls: body.styleControls,
        });
        return NextResponse.json({
          translatedParagraphs,
          discoveredTerms: translatedParagraphs.discoveredTerms ?? [],
        });
      }

      case 'stage4_editing': {
        const result = await runLiteraryEditingPass({
          englishParagraphs: body.englishParagraphs || [],
          banglaParagraphs: body.banglaParagraphs || [],
          styleProfile: body.styleProfile || null,
          characters: body.characters || [],
          terminology: body.terminology || [],
          styleControls: body.styleControls,
        });
        return NextResponse.json(result);
      }

      case 'stage5_verification': {
        const report = await verifyTranslationAccuracy({
          englishParagraphs: body.englishParagraphs || [],
          banglaParagraphs: body.banglaParagraphs || [],
          characters: body.characters || [],
          terminology: body.terminology || [],
        });
        return NextResponse.json({ report });
      }

      case 'refine_paragraph': {
        const result = await refineSingleParagraph({
          englishParagraph: body.englishParagraph || '',
          currentBanglaParagraph: body.currentBanglaParagraph || '',
          previousEnglishParagraph: body.previousEnglishParagraph,
          nextEnglishParagraph: body.nextEnglishParagraph,
          action: body.action || 'more_natural',
          customInstruction: body.customInstruction,
          styleProfile: body.styleProfile || null,
          characters: body.characters || [],
          terminology: body.terminology || [],
          styleControls: body.styleControls,
        });
        return NextResponse.json(result);
      }

      default:
        return NextResponse.json(
          { error: `Unsupported operation: ${String(operation)}` },
          { status: 400 }
        );
    }
  } catch (err: unknown) {
    console.error('GolpoTranslate API error:', err);
    const message =
      err instanceof Error
        ? err.message
        : 'An unexpected error occurred during Gemini processing.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
