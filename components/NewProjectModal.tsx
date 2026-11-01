'use client';

import React, { useState, useRef } from 'react';
import { X, Upload, BookOpen, FileText, Sparkles } from 'lucide-react';
import { SAMPLE_LITERARY_PASSAGES, type SamplePassage } from '@/lib/sample-passages';
import {
  alignParagraphs,
  countWords,
  splitIntoParagraphs,
  splitManuscriptIntoChapters,
  chunkTextByParagraphs,
} from '@/lib/chunker';
import {
  DEFAULT_STYLE_CONTROLS,
  type Chapter,
  type TranslationProject,
  type TranslationStyleControls,
} from '@/lib/types';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProject: (project: TranslationProject, autoStartPipeline: boolean) => void;
  defaultStyleControls: TranslationStyleControls;
  maxWordsPerChunk: number;
}

export default function NewProjectModal({
  isOpen,
  onClose,
  onCreateProject,
  defaultStyleControls,
  maxWordsPerChunk,
}: NewProjectModalProps) {
  const [title, setTitle] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [genre, setGenre] = useState('Literary Fiction');
  const [chapterTitle, setChapterTitle] = useState('Chapter 1');
  const [manuscriptText, setManuscriptText] = useState('');
  const [autoDetectChapters, setAutoDetectChapters] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleLoadSample = (sample: SamplePassage) => {
    setTitle(sample.title);
    setAuthorName(sample.authorName);
    setGenre(sample.genre);
    setChapterTitle(sample.chapterTitle);
    setManuscriptText(sample.text);
    setFormError(null);
    setUploadError(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setFormError(null);
    setIsUploading(true);

    try {
      const fileNameWithoutExt = file.name.replace(/\.(txt|docx)$/i, '');
      if (!title.trim()) {
        setTitle(fileNameWithoutExt);
      }

      if (file.name.toLowerCase().endsWith('.txt')) {
        const text = await file.text();
        setManuscriptText(text);
      } else if (file.name.toLowerCase().endsWith('.docx')) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/parse-docx', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to parse DOCX file');
        }
        setManuscriptText(data.text || '');
      } else {
        throw new Error('Unsupported file format. Please upload a .txt or .docx file.');
      }
    } catch (err: unknown) {
      setUploadError(
        err instanceof Error ? err.message : 'Could not read the uploaded file.'
      );
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSubmit = (autoStartPipeline: boolean) => {
    if (!title.trim()) {
      setFormError('Please provide a project title for your story or novel.');
      return;
    }
    if (!manuscriptText.trim()) {
      setFormError('Please paste an English literary passage or upload a manuscript file.');
      return;
    }

    const now = new Date().toISOString();
    const rawChapters = autoDetectChapters
      ? splitManuscriptIntoChapters(manuscriptText, chapterTitle || 'Chapter 1')
      : [{ title: chapterTitle || 'Chapter 1', content: manuscriptText.trim() }];

    const chapters: Chapter[] = rawChapters.map((raw, idx) => {
      const chunks = chunkTextByParagraphs(raw.content, maxWordsPerChunk);
      return {
        id: `ch-${Date.now()}-${idx + 1}`,
        number: idx + 1,
        title: raw.title || `Chapter ${idx + 1}`,
        originalText: raw.content,
        translatedText: '',
        paragraphs: alignParagraphs(raw.content, ''),
        status: 'pending',
        currentStage: 0,
        stageCompleted: {
          understanding: false,
          voiceAnalysis: false,
          translation: false,
          editing: false,
          verification: false,
        },
        editorialNotes: [],
        editorialChanges: [],
        verificationReport: null,
        chunkCount: Math.max(1, chunks.length),
        completedChunks: 0,
        updatedAt: now,
      };
    });

    const newProject: TranslationProject = {
      id: `proj-${Date.now()}`,
      title: title.trim(),
      authorName: authorName.trim() || 'Original Author',
      genre: genre.trim() || 'Literary Fiction',
      sourceLanguage: 'English',
      targetLanguage: 'Bangla (বাংলা)',
      createdAt: now,
      updatedAt: now,
      styleProfile: null,
      storyContext: null,
      characterMemory: [],
      terminologyMemory: [],
      styleControls: { ...(defaultStyleControls || DEFAULT_STYLE_CONTROLS) },
      chapters,
    };

    onCreateProject(newProject, autoStartPipeline);
  };

  const wordCount = countWords(manuscriptText);
  const paragraphCount = splitIntoParagraphs(manuscriptText).length;
  const detectedChapters = autoDetectChapters
    ? splitManuscriptIntoChapters(manuscriptText, chapterTitle || 'Chapter 1').length
    : 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto"
    >
      <div className="relative w-full max-w-4xl bg-[#FAF8F5] border border-[#E5E0D8] rounded-xl shadow-xl my-8 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#F3EFEA] border-b border-[#E5E0D8]">
          <div>
            <h2
              id="new-project-modal-title"
              className="font-display text-2xl font-semibold text-[#1C1917]"
            >
              Create New Literary Translation Project
            </h2>
            <p className="text-xs text-[#57534E] mt-0.5">
              English to Expressive Literary Bangla (বাংলা) · Multi-Stage Voice & Context Adaptation
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 text-[#57534E] hover:text-[#1C1917] rounded-lg hover:bg-[#E5E0D8]/50 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[78vh] overflow-y-auto">
          {/* Quick Load Literary Passages */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#57534E]">
                Load a Sample Literary Passage to Test Voice Adaptation
              </span>
              <span className="text-xs text-[#78716C]">
                Or paste / upload your own English manuscript below
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {SAMPLE_LITERARY_PASSAGES.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => handleLoadSample(sample)}
                  className="text-left p-3 rounded-lg bg-[#F3EFEA] hover:bg-[#EAE4DC] border border-[#E5E0D8] transition-colors cursor-pointer group"
                >
                  <div className="text-xs font-semibold text-[#1C1917] group-hover:text-[#9A3412] truncate">
                    {sample.title}
                  </div>
                  <div className="text-[11px] text-[#57534E] mt-0.5 truncate">
                    {sample.genre} · {sample.authorName}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Project Metadata Fields */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="project-title-input"
                className="block text-xs font-semibold text-[#1C1917] mb-1.5"
              >
                Story or Novel Title *
              </label>
              <input
                id="project-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., The Clockmaker of Old Calcutta"
                className="w-full px-3.5 py-2 text-sm bg-white border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
              />
            </div>

            <div>
              <label
                htmlFor="author-name-input"
                className="block text-xs font-semibold text-[#1C1917] mb-1.5"
              >
                Original Author
              </label>
              <input
                id="author-name-input"
                type="text"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="e.g., Julian Vance"
                className="w-full px-3.5 py-2 text-sm bg-white border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
              />
            </div>

            <div>
              <label
                htmlFor="genre-select"
                className="block text-xs font-semibold text-[#1C1917] mb-1.5"
              >
                Literary Genre & Tone
              </label>
              <select
                id="genre-select"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
              >
                <option value="Literary & Historical Fiction">Literary & Historical Fiction</option>
                <option value="Contemporary Literary Fiction">Contemporary Literary Fiction</option>
                <option value="Psychological Thriller">Psychological Thriller</option>
                <option value="High Fantasy Adventure">High Fantasy Adventure</option>
                <option value="Contemporary Romance">Contemporary Romance</option>
                <option value="Classic Literature">Classic Literature</option>
                <option value="Mystery & Detective">Mystery & Detective</option>
                <option value="Satire & Comedy">Satire & Comedy</option>
                <option value="Science Fiction">Science Fiction</option>
              </select>
            </div>
          </div>

          {/* Chapter & File Upload Controls */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            <div className="flex items-center gap-4">
              <div>
                <label
                  htmlFor="initial-chapter-title"
                  className="block text-xs font-semibold text-[#1C1917] mb-1"
                >
                  Default Chapter Heading
                </label>
                <input
                  id="initial-chapter-title"
                  type="text"
                  value={chapterTitle}
                  onChange={(e) => setChapterTitle(e.target.value)}
                  placeholder="Chapter 1"
                  className="px-3 py-1.5 text-xs bg-white border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412]"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-[#57534E] mt-5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDetectChapters}
                  onChange={(e) => setAutoDetectChapters(e.target.checked)}
                  className="accent-[#9A3412] rounded"
                />
                <span>Auto-split multiple chapters (&ldquo;Chapter 1&rdquo;, &ldquo;Chapter 2&rdquo;...)</span>
              </label>
            </div>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.docx"
                onChange={handleFileUpload}
                className="hidden"
                id="manuscript-file-upload"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#1C1917] bg-[#F3EFEA] border border-[#D6CFC5] rounded-lg hover:bg-[#EAE4DC] transition-colors cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-[#9A3412]" />
                <span>{isUploading ? 'Reading File...' : 'Upload .TXT or .DOCX'}</span>
              </button>
            </div>
          </div>

          {uploadError && (
            <div className="p-3 text-xs text-[#991B1B] bg-[#FEF2F2] border border-[#FECACA] rounded-lg">
              {uploadError}
            </div>
          )}

          {/* English Source Textarea */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="manuscript-source-textarea"
                className="text-xs font-semibold text-[#1C1917]"
              >
                Original English Passage or Manuscript *
              </label>
              <div className="text-xs text-[#57534E] font-mono-num">
                <span>{wordCount} words</span>
                <span aria-hidden="true"> · </span>
                <span>{paragraphCount} paragraphs</span>
                <span aria-hidden="true"> · </span>
                <span>{detectedChapters} {detectedChapters === 1 ? 'chapter' : 'chapters'}</span>
              </div>
            </div>
            <textarea
              id="manuscript-source-textarea"
              rows={9}
              value={manuscriptText}
              onChange={(e) => setManuscriptText(e.target.value)}
              placeholder="Paste your English story, chapter, or novel excerpt here..."
              className="w-full p-4 text-sm leading-relaxed bg-white border border-[#D6CFC5] rounded-lg focus:outline-none focus:border-[#9A3412] font-sans-ui"
            />
          </div>

          {formError && (
            <div className="p-3 text-xs font-medium text-[#991B1B] bg-[#FEF2F2] border border-[#FECACA] rounded-lg">
              {formError}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-[#F3EFEA] border-t border-[#E5E0D8]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-[#57534E] hover:text-[#1C1917] cursor-pointer"
          >
            Cancel
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleSubmit(false)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#1C1917] bg-white border border-[#D6CFC5] rounded-lg hover:bg-[#FAF8F5] transition-colors cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Create & Open Studio</span>
            </button>

            <button
              type="button"
              onClick={() => handleSubmit(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#9A3412] rounded-lg hover:bg-[#7C2D12] transition-colors cursor-pointer shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Create & Run 5-Stage Adaptive Translation</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
