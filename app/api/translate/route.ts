import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeAuthorVoice,
  analyzeStoryUnderstanding,
  clearModelExecutionHistory,
  getModelExecutionHistory,
  refineSingleParagraph,
  runLiteraryEditingPass,
  translateChunkFaithfully,
  verifyTranslationAccuracy,
} from '@/lib/gemini-service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { operation } = body;
    const modelOverride =
      typeof body.modelOverride === 'string' && body.modelOverride.trim().length > 0
        ? body.modelOverride.trim()
        : undefined;

    switch (operation) {
      case 'stage1_understanding': {
        const result = await analyzeStoryUnderstanding({
          text: body.text || '',
          projectTitle: body.projectTitle || 'Untitled Story',
          genre: body.genre || 'Literary Fiction',
          existingCharacters: body.existingCharacters || [],
          existingTerminology: body.existingTerminology || [],
          existingStoryContext: body.existingStoryContext || null,
          modelOverride,
        });
        return NextResponse.json(result);
      }

      case 'stage2_voice': {
        const styleProfile = await analyzeAuthorVoice({
          text: body.text || '',
          projectTitle: body.projectTitle || 'Untitled Story',
          authorName: body.authorName || 'Unknown Author',
          genre: body.genre || 'Literary Fiction',
          customNotes:
            typeof body.customNotes === 'string' ? body.customNotes : undefined,
          modelOverride,
        });
        return NextResponse.json({ styleProfile });
      }

      case 'stage3_translate_chunk': {
        const translatedParagraphs = await translateChunkFaithfully({
          paragraphs: body.paragraphs || [],
          previousContextParagraphs: body.previousContextParagraphs || [],
          priorTranslatedPairs: Array.isArray(body.priorTranslatedPairs)
            ? body.priorTranslatedPairs
            : undefined,
          styleProfile: body.styleProfile || null,
          storyContext: body.storyContext || null,
          characters: body.characters || [],
          terminology: body.terminology || [],
          styleControls: body.styleControls,
          modelOverride,
        });
        return NextResponse.json({
          translatedParagraphs,
          discoveredTerms: translatedParagraphs.discoveredTerms ?? [],
        });
      }

      case 'stage4_editing': {
        const result = await runLiteraryEditingPass({
          englishParagraphs: Array.isArray(body.englishParagraphs)
            ? body.englishParagraphs
            : [],
          banglaParagraphs: Array.isArray(body.banglaParagraphs)
            ? body.banglaParagraphs
            : [],
          styleProfile: body.styleProfile || null,
          storyContext: body.storyContext || null,
          characters: body.characters || [],
          terminology: body.terminology || [],
          styleControls: body.styleControls,
          windowSize:
            typeof body.windowSize === 'number' ? body.windowSize : undefined,
          modelOverride,
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
          previousBanglaParagraph: body.previousBanglaParagraph,
          nextBanglaParagraph: body.nextBanglaParagraph,
          storyContext: body.storyContext || null,
          action: body.action || (body.repairIssue ? 'issue_guided_repair' : 'more_natural'),
          customInstruction: body.customInstruction,
          repairIssue: body.repairIssue || null,
          styleProfile: body.styleProfile || null,
          characters: body.characters || [],
          terminology: body.terminology || [],
          styleControls: body.styleControls,
          modelOverride,
        });
        return NextResponse.json(result);
      }

      case 'get_model_telemetry': {
        return NextResponse.json({
          records: getModelExecutionHistory(),
        });
      }

      case 'clear_model_telemetry': {
        clearModelExecutionHistory();
        return NextResponse.json({ cleared: true });
      }

      default:
        return NextResponse.json(
          { error: `Unsupported operation: ${String(operation)}` },
          { status: 400 }
        );
    }
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : 'An unexpected error occurred during Gemini processing.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
