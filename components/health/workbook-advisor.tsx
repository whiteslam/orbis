'use client';

import { useId, useState, useTransition, type ChangeEvent } from 'react';
import { FileSpreadsheet, FileText, LoaderCircle, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { deleteSavedAiResultAction } from '@/app/ai/result-actions';
import { generateWorkbookAdviceAction, parseWorkbookAction } from '@/app/health/actions';
import { workbookHasFitnessFields } from '@/lib/personal/fitness-persona';
import type { SavedWorkbookAdvice } from '@/lib/ai/saved';
import type { WorkbookAdvice, WorkbookObservation, WorkbookPreview } from '@/lib/workbook/types';
import { FieldLabel, FieldStep, FieldSubHead } from '@/components/field/field';
import { safeAction } from '@/lib/client/safe-action';

/** What went into a request made in this session. Saved advice does not record it, so it is null then. */
export type AdviceSent = { goals: boolean; steps: boolean; notes: boolean; profile: boolean; persona: boolean };

// What is on screen: either advice just generated, or advice restored from an earlier session.
// The cited observations travel with it, because the workbook itself is never stored.
export type ShownAdvice = {
  advice: WorkbookAdvice;
  observations: WorkbookObservation[];
  title: string | null;
  savedAt: string | null;
  savedId: string | null;
  sent: AdviceSent | null;
};

export function adviceFromSaved(saved: SavedWorkbookAdvice | null): ShownAdvice | null {
  if (!saved) return null;
  return {
    advice: saved.result,
    observations: saved.context?.observations ?? [],
    title: saved.title,
    savedAt: saved.createdAt,
    savedId: saved.id,
    sent: null,
  };
}

export function savedWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

/** Splits the model's summary into a headline sentence and whatever follows it. */
export function splitSummary(summary: string) {
  const match = summary.match(/^([\s\S]+?[.!?])\s+([\s\S]*)$/);
  if (!match || match[1].length > 120) return { headline: summary, rest: '' };
  return { headline: match[1], rest: match[2].trim() };
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const isPdfName = (name: string | null) => Boolean(name?.toLowerCase().endsWith('.pdf'));

// The first observations are enough to check the file was read correctly; the rest open on request.
const FIRST_OBSERVATIONS = 6;

/**
 * "Ask about a file": choose a file, check what Orbis read, pick what else to
 * send, then consent. Advice lives in the Health screen's state, so it survives
 * leaving this view; a new answer replaces it and opens the advice view.
 */
export function WorkbookAsk({ goalCount = 0, hasStepData = false, savedContextCount = 0, hasSavedFitnessPersona = false, hasSavedPersonalProfile = false, onAdvice, onBack }: { goalCount?: number; hasStepData?: boolean; savedContextCount?: number; hasSavedFitnessPersona?: boolean; hasSavedPersonalProfile?: boolean; onAdvice: (advice: ShownAdvice) => void; onBack: () => void }) {
  const fileInputId = useId();
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [includeSavedContext, setIncludeSavedContext] = useState(false);
  const [includeFitnessPersona, setIncludeFitnessPersona] = useState(false);
  const [includePersonalProfile, setIncludePersonalProfile] = useState(false);
  const [includeGoals, setIncludeGoals] = useState(goalCount > 0);
  const [includeSteps, setIncludeSteps] = useState(hasStepData);
  const [allSheets, setAllSheets] = useState(false);
  const [allObservations, setAllObservations] = useState(false);
  const [isPending, startTransition] = useTransition();

  function resetChoices() {
    setConsent(false);
    setIncludeSavedContext(false);
    setIncludeFitnessPersona(false);
    setIncludePersonalProfile(false);
    setIncludeGoals(goalCount > 0);
    setIncludeSteps(hasStepData);
    setAllSheets(false);
    setAllObservations(false);
  }

  function parseFile(file: File) {
    setMessage(null);
    setPreview(null);
    resetChoices();
    const formData = new FormData();
    formData.set('workbook', file);
    startTransition(async () => {
      const result = await safeAction(parseWorkbookAction)(formData);
      if (!result.success) {
        setMessage(result.message);
        return;
      }
      setBytes(file.size);
      setPreview(result.data);
    });
  }

  const isPdf = isPdfName(preview?.fileName ?? null);
  const documentText = preview ? `${preview.fileName} ${preview.observations.map((observation) => `${observation.label} ${observation.value}`).join(' ')}` : '';
  const personaRelevant = Boolean(preview && hasSavedFitnessPersona && workbookHasFitnessFields(preview.sheets, documentText));
  const sent: AdviceSent = {
    goals: includeGoals && goalCount > 0,
    steps: includeSteps && hasStepData,
    notes: includeSavedContext && savedContextCount > 0,
    profile: includePersonalProfile && hasSavedPersonalProfile,
    persona: includeFitnessPersona && personaRelevant,
  };

  function requestAdvice() {
    if (!preview || !consent) return;
    setMessage(null);
    startTransition(async () => {
      const response = await safeAction(generateWorkbookAdviceAction)({ preview, includeSavedContext, includeFitnessPersona, includePersonalProfile, includeGoals: sent.goals, includeSteps: sent.steps, consented: consent });
      if (!response.success) {
        setMessage(response.message);
        return;
      }
      onAdvice({
        advice: response.data,
        observations: preview.observations,
        title: preview.fileName,
        savedAt: response.saved?.createdAt ?? new Date().toISOString(),
        savedId: response.saved?.id ?? null,
        sent,
      });
    });
  }

  function clearWorkbook() {
    setPreview(null);
    setBytes(null);
    setMessage(null);
    resetChoices();
  }

  if (!preview) {
    return (
      <>
        <FieldSubHead crumb="Health · ask about a file" title="Ask about a file" lead="Upload a health, finance or activity Excel or PDF file. Orbis shows you what it read before anything is sent for advice." onBack={onBack} backLabel="Back to Health" />
        <label className={`hl-drop ${isPending ? 'busy' : ''}`} htmlFor={fileInputId}>
          {isPending ? <LoaderCircle className="workbook-spinner" size={18} aria-hidden="true" /> : <Upload size={18} aria-hidden="true" />}
          <strong>{isPending ? 'Reading the file…' : 'Choose an Excel or PDF file'}</strong>
          <span>.xlsx or .pdf · up to 100 MB</span>
        </label>
        <input id={fileInputId} className="sr-only" name="workbook" type="file" accept=".xlsx,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf" disabled={isPending} onChange={(event) => {
          const selected = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (selected) parseFile(selected);
        }} />
        {message && <p className="fd-msg bad" role="status">{message}</p>}
        <p className="fd-note">The file is read for this request and isn’t saved to Orbis. Suggestions are informational and aren’t a medical diagnosis.</p>
      </>
    );
  }

  const rows = preview.sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0);
  const sheets = allSheets ? preview.sheets : preview.sheets.slice(0, 1);
  const hiddenSheets = preview.sheets.length - 1;
  const observations = allObservations ? preview.observations : preview.observations.slice(0, FIRST_OBSERVATIONS);
  const hiddenObservations = preview.observations.length - FIRST_OBSERVATIONS;
  const disclosureItems = [
    isPdf ? 'a bounded PDF preview and up to 24 extracted text snippets' : 'a bounded Excel summary',
    sent.notes ? 'up to 5 relevant saved notes (up to 3,000 characters)' : null,
    sent.profile ? 'my personal profile (name, role and More about me text)' : null,
    sent.persona ? 'my saved fitness persona' : null,
    sent.goals ? 'my goals and progress' : null,
    sent.steps ? 'my daily step summary' : null,
  ].filter((item): item is string => Boolean(item));
  const disclosure = disclosureItems.length > 1 ? `${disclosureItems.slice(0, -1).join(', ')} and ${disclosureItems[disclosureItems.length - 1]}` : disclosureItems[0];
  const toggle = (setter: (value: boolean) => void) => (event: ChangeEvent<HTMLInputElement>) => { setter(event.currentTarget.checked); setConsent(false); };

  return (
    <>
      <FieldSubHead crumb="Health · ask about a file" title="Here is what I read" lead="Check it before anything is sent. The original file isn’t sent for advice or saved — only the summary below." onBack={onBack} backLabel="Back to Health" />

      <div className="hl-file">
        <span className="hl-file-tile" aria-hidden="true">{isPdf ? <FileText size={18} strokeWidth={1.8} /> : <FileSpreadsheet size={18} strokeWidth={1.8} />}</span>
        <div>
          <strong>{preview.fileName}</strong>
          <small>{rows.toLocaleString('en-IN')} {isPdf ? 'text lines' : 'data rows'} · {preview.sheets.length} {preview.sheets.length === 1 ? 'sheet' : 'sheets'}{bytes !== null ? ` · ${fileSize(bytes)}` : ''}</small>
        </div>
        <button className="fd-round" type="button" onClick={clearWorkbook} disabled={isPending} aria-label="Remove this file"><X size={15} strokeWidth={2.2} aria-hidden="true" /></button>
      </div>

      {sheets.map((sheet, index) => (
        <section className="hl-sheet" key={`${sheet.name}-${index}`}>
          <FieldLabel>{preview.sheets.length > 1 ? `Sheet ${index + 1} of ${preview.sheets.length} · ` : ''}{sheet.name}</FieldLabel>
          <p className="hl-sheet-meta">{sheet.rowCount.toLocaleString('en-IN')} rows · {sheet.columnCount} columns{sheet.columns.length ? ` · ${sheet.columns.join(' · ')}` : ''}</p>
          {sheet.previewRows.length > 0 && (
            <div className="hl-table-wrap">
              <table className="hl-table">
                <thead><tr><th scope="col">Row</th>{sheet.columns.slice(0, 10).map((column, columnIndex) => <th scope="col" key={`${column}-${columnIndex}`}>{column}</th>)}</tr></thead>
                <tbody>{sheet.previewRows.map((row) => <tr key={row.rowNumber}><th scope="row">{row.rowNumber}</th>{row.values.map((value, valueIndex) => <td key={`${row.rowNumber}-${valueIndex}`}>{value || '—'}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      ))}
      {hiddenSheets > 0 && (
        <button className="fd-link hl-more" type="button" onClick={() => setAllSheets((value) => !value)} aria-expanded={allSheets}>
          {allSheets ? 'Show only the first sheet' : hiddenSheets === 1 ? 'Sheet 2' : hiddenSheets === 2 ? 'Sheets 2 and 3' : `Sheets 2 to ${preview.sheets.length}`}
        </button>
      )}

      {preview.observations.length > 0 && (
        <section className="hl-calc">
          <FieldLabel>{isPdf ? 'What Orbis found in the document' : 'What Orbis calculated'}</FieldLabel>
          {observations.map((observation) => isPdf
            ? <p className="hl-calc-row text" key={observation.id}>{observation.value}</p>
            : <div className="hl-calc-row" key={observation.id}><span>{observation.sheet} · {observation.column}</span><b>{observation.value}</b></div>)}
          {hiddenObservations > 0 && (
            <button className="fd-link hl-more" type="button" onClick={() => setAllObservations((value) => !value)} aria-expanded={allObservations}>
              {allObservations ? 'Show fewer' : `${hiddenObservations} more`}
            </button>
          )}
        </section>
      )}

      {preview.observations.length === 0 ? (
        <p className="fd-msg" role="status">Orbis needs readable PDF text or at least three numeric values in an Excel column to ground its advice. You can still review this preview or choose another file.</p>
      ) : (
        <>
          {(goalCount > 0 || hasStepData || savedContextCount > 0 || hasSavedPersonalProfile || personaRelevant) && (
            <section className="hl-opts">
              <FieldLabel>Add to the request</FieldLabel>
              <p className="hl-opts-note">Only what is ticked is sent with the file summary.</p>
              {goalCount > 0 && <label className="hl-opt"><input type="checkbox" checked={includeGoals} onChange={toggle(setIncludeGoals)} disabled={isPending} /><span>My <b>{goalCount} {goalCount === 1 ? 'goal' : 'goals'}</b> — title, progress and target date, to tailor advice and a plan</span></label>}
              {hasStepData && <label className="hl-opt"><input type="checkbox" checked={includeSteps} onChange={toggle(setIncludeSteps)} disabled={isPending} /><span>My <b>Apple Health steps</b> — daily averages, trend and the last 14 days</span></label>}
              {savedContextCount > 0 && <label className="hl-opt"><input type="checkbox" checked={includeSavedContext} onChange={toggle(setIncludeSavedContext)} disabled={isPending} /><span>Up to <b>{Math.min(savedContextCount, 5)} relevant saved {Math.min(savedContextCount, 5) === 1 ? 'note' : 'notes'}</b> from Profile (up to 3,000 characters)</span></label>}
              {hasSavedPersonalProfile && <label className="hl-opt"><input type="checkbox" checked={includePersonalProfile} onChange={toggle(setIncludePersonalProfile)} disabled={isPending} /><span>My <b>personal profile</b> and “More about me” details</span></label>}
              {personaRelevant && <label className="hl-opt"><input type="checkbox" checked={includeFitnessPersona} onChange={toggle(setIncludeFitnessPersona)} disabled={isPending} /><span>My saved <b>fitness persona</b> — this file has fitness fields</span></label>}
            </section>
          )}

          <label className="fd-consent hl-consent">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.currentTarget.checked)} disabled={isPending} />
            <span>I understand {disclosure} will be sent to OpenRouter for advice. The original file is not sent, and the advice is saved to my account so I can read it again.</span>
          </label>

          <div className="fd-act">
            <button type="button" onClick={requestAdvice} disabled={!consent || isPending}>
              {isPending ? <><LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> Analysing…</> : <><Sparkles size={14} aria-hidden="true" /> Get advice</>}
            </button>
          </div>
          <p className="fd-note tight">{consent ? '' : 'Tick the box above to enable this. '}Suggestions are informational and aren’t a medical diagnosis.</p>
        </>
      )}

      {message && <p className="fd-msg bad" role="status">{message}</p>}
    </>
  );
}

/** The advice itself: a headline, numbered steps with the observations they rest on, and what was sent. */
export function WorkbookAdviceView({ advice, onDeleted, onPlan, onBack }: { advice: ShownAdvice; onDeleted: () => void; onPlan: () => void; onBack: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function remove() {
    setMessage(null);
    startTransition(async () => {
      if (advice.savedId) {
        const response = await safeAction(deleteSavedAiResultAction)(advice.savedId);
        if (!response.success) {
          setMessage(response.message);
          return;
        }
      }
      onDeleted();
    });
  }

  const observations = new Map(advice.observations.map((observation) => [observation.id, observation]));
  const summary = splitSummary(advice.advice.summary);
  const steps = advice.advice.advice;
  const pdf = isPdfName(advice.title);
  const sent = advice.sent;
  const row = (label: string, included: boolean) => (
    <div className="fd-line" key={label}><span>{label}</span>{included ? <b className="fd-yes">Included</b> : <b className="empty">Not sent</b>}</div>
  );

  return (
    <>
      <FieldSubHead crumb="Health · advice" onBack={onBack} backLabel="Back to Health" />
      <section className="fd-focus fd-advice" aria-live="polite">
        <p className="fd-kicker">What Orbis sees</p>
        <h1>{summary.headline}</h1>
        {summary.rest && <p>{summary.rest}</p>}
        <p className="fd-src"><Sparkles size={11} aria-hidden="true" />{advice.title ?? 'Saved advice'}{advice.savedAt ? ` · saved ${savedWhen(advice.savedAt)}` : ''}</p>
      </section>

      <FieldLabel>{steps.length === 1 ? '1 step' : `${steps.length} steps`}</FieldLabel>
      {steps.map((item, index) => {
        const evidence = item.evidenceIds.map((id) => observations.get(id)).filter((observation): observation is WorkbookObservation => Boolean(observation));
        return (
          <FieldStep
            key={`${item.title}-${index}`}
            n={index + 1}
            title={item.title}
            foot={evidence.length ? evidence.map((observation) => <span className="hl-ev" key={observation.id}>{pdf ? observation.value : `${observation.sheet} · ${observation.column}: ${observation.value}`}</span>) : undefined}
          >
            {item.action}
          </FieldStep>
        );
      })}

      <p className="fd-note">This reads your file, not your body. Suggestions are informational and aren’t a medical diagnosis.</p>
      {advice.advice.caveats.map((caveat, index) => <p className="fd-note tight" key={`${caveat}-${index}`}>{caveat}</p>)}

      <div className="fd-act">
        <button type="button" onClick={onPlan} disabled={isPending}>Build a plan</button>
        <button className="fd-link alert" type="button" onClick={remove} disabled={isPending}><Trash2 size={13} aria-hidden="true" /> {isPending ? 'Deleting…' : 'Delete'}</button>
      </div>
      {message && <p className="fd-msg bad" role="status">{message}</p>}

      <section className="fd-quiet">
        <h2>What was sent</h2>
        <div className="fd-line"><span>{pdf ? 'PDF preview and text snippets, bounded' : 'Excel summary, bounded'}</span><b className="fd-yes">Included</b></div>
        {sent && [
          row('Your goals', sent.goals),
          row('Step summary', sent.steps),
          row('Saved notes', sent.notes),
          row('Personal profile', sent.profile),
          row('Fitness persona', sent.persona),
        ]}
        <div className="fd-line"><span>The file itself</span><b className="empty">Never sent</b></div>
      </section>
      {!sent && <p className="fd-note tight">Which profile details went with this request isn’t stored with saved advice.</p>}
    </>
  );
}
