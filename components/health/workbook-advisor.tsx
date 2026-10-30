'use client';

import { useId, useState, useTransition, type ChangeEvent } from 'react';
import { FileSpreadsheet, FileText, LoaderCircle, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { deleteSavedAiResultAction } from '@/app/ai/result-actions';
import { generateWorkbookAdviceAction, parseWorkbookAction, signWorkbookUploadAction } from '@/app/health/actions';
import { workbookHasFitnessFields } from '@/lib/personal/fitness-persona';
import type { WorkbookObservation, WorkbookPreview, WorkbookSheetPreview } from '@/lib/workbook/types';
import { FieldLabel, FieldStep, FieldSubHead } from '@/components/field/field';
import { safeAction } from '@/lib/client/safe-action';
import { savedWhen, splitSummary, type AdviceSent, type ShownAdvice } from '@/lib/workbook/shown-advice';
import { UPLOAD_BUCKET, uploadProblem } from '@/lib/storage/upload-rules';
import { createClient } from '@/lib/supabase/client';

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const isPdfName = (name: string | null) => Boolean(name?.toLowerCase().endsWith('.pdf'));

// The first observations are enough to check the file was read correctly; the rest open on request.
const FIRST_OBSERVATIONS = 6;

const UPLOAD_FAILED = 'The upload did not finish. Check your connection and try again.';

/**
 * The file goes straight to Storage; the server reads it from there, then deletes it.
 * Returns what Orbis read, or the message to show instead.
 */
async function uploadAndParse(file: File): Promise<{ preview: WorkbookPreview } | { message: string }> {
  const signed = await safeAction(signWorkbookUploadAction)({ name: file.name, type: file.type, size: file.size });
  if (!signed.success) return { message: signed.message };
  try {
    const { error } = await createClient().storage.from(UPLOAD_BUCKET).uploadToSignedUrl(signed.data.path, signed.data.token, file, { contentType: signed.data.contentType });
    if (error) return { message: UPLOAD_FAILED };
  } catch {
    return { message: UPLOAD_FAILED };
  }
  const result = await safeAction(parseWorkbookAction)({ path: signed.data.path, name: file.name });
  if (!result.success) return { message: result.message };
  return { preview: result.data };
}

/** The file's name and what was read from it, as one string to look for fitness fields in. */
function documentTextOf(preview: WorkbookPreview | null) {
  if (!preview) return '';
  const observed = preview.observations.map((observation) => `${observation.label} ${observation.value}`).join(' ');
  return `${preview.fileName} ${observed}`;
}

/** Everything the consent line says will be sent, in order. */
function disclosureItemsFor(isPdf: boolean, sent: AdviceSent) {
  return [
    isPdf ? 'a bounded PDF preview and up to 24 extracted text snippets' : 'a bounded Excel summary',
    sent.notes ? 'up to 5 relevant saved notes (up to 3,000 characters)' : null,
    sent.profile ? 'my personal profile (name, role and More about me text)' : null,
    sent.persona ? 'my saved fitness persona' : null,
    sent.steps ? 'my daily step summary' : null,
  ].filter((item): item is string => Boolean(item));
}

/** "a, b and c". */
function joinDisclosure(items: string[]) {
  if (items.length <= 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** The button under the first sheet: which hidden sheets it shows, or that it hides them again. */
function sheetsToggleLabel(allSheets: boolean, hiddenSheets: number, sheetCount: number) {
  if (allSheets) return 'Show only the first sheet';
  if (hiddenSheets === 1) return 'Sheet 2';
  if (hiddenSheets === 2) return 'Sheets 2 and 3';
  return `Sheets 2 to ${sheetCount}`;
}

/** The first step: choose a file. */
function PickFile({ inputId, isPending, message, onFile, onBack }: Readonly<{ inputId: string; isPending: boolean; message: string | null; onFile: (file: File) => void; onBack: () => void }>) {
  return (
    <div className="hl-pick">
      <FieldSubHead crumb="Health · ask about a file" title="Ask about a file" lead="Upload a health, finance or activity Excel or PDF file. Orbis shows you what it read before anything is sent for advice." onBack={onBack} backLabel="Back to Health" />
      <label className={`hl-drop ${isPending ? 'busy' : ''}`} htmlFor={inputId}>
        {isPending ? <LoaderCircle className="workbook-spinner" size={18} aria-hidden="true" /> : <Upload size={18} aria-hidden="true" />}
        <strong>{isPending ? 'Reading the file…' : 'Choose an Excel or PDF file'}</strong>
        <span>.xlsx or .pdf · up to 100 MB</span>
      </label>
      <input id={inputId} className="sr-only" name="workbook" type="file" accept=".xlsx,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf" disabled={isPending} onChange={(event) => {
        const selected = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (selected) onFile(selected);
      }} />
      {message && <output className="fd-msg bad">{message}</output>}
      <p className="fd-note">The file is read for this request and isn’t saved to Orbis. Suggestions are informational and aren’t a medical diagnosis.</p>
    </div>
  );
}

/** The chosen file: its name, how much was read, and a way to drop it. */
function FileSummary({ preview, bytes, isPdf, disabled, onClear }: Readonly<{ preview: WorkbookPreview; bytes: number | null; isPdf: boolean; disabled: boolean; onClear: () => void }>) {
  const rows = preview.sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0);
  return (
    <div className="hl-file">
      <span className="hl-file-tile" aria-hidden="true">{isPdf ? <FileText size={18} strokeWidth={1.8} /> : <FileSpreadsheet size={18} strokeWidth={1.8} />}</span>
      <div>
        <strong>{preview.fileName}</strong>
        <small>{rows.toLocaleString('en-IN')} {isPdf ? 'text lines' : 'data rows'} · {preview.sheets.length} {preview.sheets.length === 1 ? 'sheet' : 'sheets'}{bytes !== null ? ` · ${fileSize(bytes)}` : ''}</small>
      </div>
      <button className="fd-round" type="button" onClick={onClear} disabled={disabled} aria-label="Remove this file"><X size={15} strokeWidth={2.2} aria-hidden="true" /></button>
    </div>
  );
}

/** One sheet (or the PDF's text) as Orbis read it: its size, columns and first rows. */
function SheetPreview({ sheet, index, sheetCount }: Readonly<{ sheet: WorkbookSheetPreview; index: number; sheetCount: number }>) {
  return (
    <section className="hl-sheet">
      <FieldLabel>{sheetCount > 1 ? `Sheet ${index + 1} of ${sheetCount} · ` : ''}{sheet.name}</FieldLabel>
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
  );
}

/** What Orbis found or calculated, the first few at once and the rest on request. */
function Observations({ observations, isPdf, showAll, onToggle }: Readonly<{ observations: WorkbookObservation[]; isPdf: boolean; showAll: boolean; onToggle: () => void }>) {
  const shown = showAll ? observations : observations.slice(0, FIRST_OBSERVATIONS);
  const hidden = observations.length - FIRST_OBSERVATIONS;
  return (
    <section className="hl-calc">
      <FieldLabel>{isPdf ? 'What Orbis found in the document' : 'What Orbis calculated'}</FieldLabel>
      {shown.map((observation) => isPdf
        ? <p className="hl-calc-row text" key={observation.id}>{observation.value}</p>
        : <div className="hl-calc-row" key={observation.id}><span>{observation.sheet} · {observation.column}</span><b>{observation.value}</b></div>)}
      {hidden > 0 && (
        <button className="fd-link hl-more" type="button" onClick={onToggle} aria-expanded={showAll}>
          {showAll ? 'Show fewer' : `${hidden} more`}
        </button>
      )}
    </section>
  );
}

type Extra = { checked: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void };

/** The optional context that can go with the file, each shown only when there is something to send. */
function RequestExtras({ hasStepData, savedContextCount, hasSavedPersonalProfile, personaRelevant, steps, notes, profile, persona, disabled }: Readonly<{
  hasStepData: boolean;
  savedContextCount: number;
  hasSavedPersonalProfile: boolean;
  personaRelevant: boolean;
  steps: Extra;
  notes: Extra;
  profile: Extra;
  persona: Extra;
  disabled: boolean;
}>) {
  if (!hasStepData && savedContextCount <= 0 && !hasSavedPersonalProfile && !personaRelevant) return null;
  const noteCount = Math.min(savedContextCount, 5);
  return (
    <section className="hl-opts">
      <FieldLabel>Add to the request</FieldLabel>
      <p className="hl-opts-note">Only what is ticked is sent with the file summary.</p>
      {hasStepData && <label className="hl-opt"><input type="checkbox" checked={steps.checked} onChange={steps.onChange} disabled={disabled} /><span>My <b>Apple Health steps</b>: daily averages, trend and the last 14 days</span></label>}
      {savedContextCount > 0 && <label className="hl-opt"><input type="checkbox" checked={notes.checked} onChange={notes.onChange} disabled={disabled} /><span>Up to <b>{noteCount} relevant saved {noteCount === 1 ? 'note' : 'notes'}</b> from Profile (up to 3,000 characters)</span></label>}
      {hasSavedPersonalProfile && <label className="hl-opt"><input type="checkbox" checked={profile.checked} onChange={profile.onChange} disabled={disabled} /><span>My <b>personal profile</b> and “More about me” details</span></label>}
      {personaRelevant && <label className="hl-opt"><input type="checkbox" checked={persona.checked} onChange={persona.onChange} disabled={disabled} /><span>My saved <b>fitness persona</b> (this file has fitness fields)</span></label>}
    </section>
  );
}

/**
 * "Ask about a file": choose a file, check what Orbis read, pick what else to
 * send, then consent. Advice lives in the Health screen's state, so it survives
 * leaving this view; a new answer replaces it and opens the advice view.
 */
export function WorkbookAsk({ hasStepData = false, savedContextCount = 0, hasSavedFitnessPersona = false, hasSavedPersonalProfile = false, onAdvice, onBack }: Readonly<{ hasStepData?: boolean; savedContextCount?: number; hasSavedFitnessPersona?: boolean; hasSavedPersonalProfile?: boolean; onAdvice: (advice: ShownAdvice) => void; onBack: () => void }>) {
  const fileInputId = useId();
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [includeSavedContext, setIncludeSavedContext] = useState(false);
  const [includeFitnessPersona, setIncludeFitnessPersona] = useState(false);
  const [includePersonalProfile, setIncludePersonalProfile] = useState(false);
  const [includeSteps, setIncludeSteps] = useState(hasStepData);
  const [allSheets, setAllSheets] = useState(false);
  const [allObservations, setAllObservations] = useState(false);
  const [isPending, startTransition] = useTransition();

  function resetChoices() {
    setConsent(false);
    setIncludeSavedContext(false);
    setIncludeFitnessPersona(false);
    setIncludePersonalProfile(false);
    setIncludeSteps(hasStepData);
    setAllSheets(false);
    setAllObservations(false);
  }

  function parseFile(file: File) {
    setMessage(null);
    setPreview(null);
    resetChoices();
    const problem = uploadProblem(file);
    if (problem) {
      setMessage(problem);
      return;
    }
    startTransition(async () => {
      const outcome = await uploadAndParse(file);
      if ('message' in outcome) {
        setMessage(outcome.message);
        return;
      }
      setBytes(file.size);
      setPreview(outcome.preview);
    });
  }

  const isPdf = isPdfName(preview?.fileName ?? null);
  const personaRelevant = Boolean(preview && hasSavedFitnessPersona && workbookHasFitnessFields(preview.sheets, documentTextOf(preview)));
  const sent: AdviceSent = {
    steps: includeSteps && hasStepData,
    notes: includeSavedContext && savedContextCount > 0,
    profile: includePersonalProfile && hasSavedPersonalProfile,
    persona: includeFitnessPersona && personaRelevant,
  };

  function requestAdvice() {
    if (!preview || !consent) return;
    setMessage(null);
    startTransition(async () => {
      const response = await safeAction(generateWorkbookAdviceAction)({ preview, includeSavedContext, includeFitnessPersona, includePersonalProfile, includeSteps: sent.steps, consented: consent });
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
    return <PickFile inputId={fileInputId} isPending={isPending} message={message} onFile={parseFile} onBack={onBack} />;
  }

  const sheets = allSheets ? preview.sheets : preview.sheets.slice(0, 1);
  const hiddenSheets = preview.sheets.length - 1;
  const disclosure = joinDisclosure(disclosureItemsFor(isPdf, sent));
  const toggle = (setter: (value: boolean) => void) => (event: ChangeEvent<HTMLInputElement>) => { setter(event.currentTarget.checked); setConsent(false); };

  return (
    <>
      <FieldSubHead crumb="Health · ask about a file" title="Here is what I read" lead="Check it before anything is sent. The original file isn’t sent for advice or saved, only the summary below." onBack={onBack} backLabel="Back to Health" />

      <div className="hl-read">
      <div className="hl-read-file">
      <FileSummary preview={preview} bytes={bytes} isPdf={isPdf} disabled={isPending} onClear={clearWorkbook} />

      {sheets.map((sheet, index) => <SheetPreview key={`${sheet.name}-${index}`} sheet={sheet} index={index} sheetCount={preview.sheets.length} />)}
      {hiddenSheets > 0 && (
        <button className="fd-link hl-more" type="button" onClick={() => setAllSheets((value) => !value)} aria-expanded={allSheets}>
          {sheetsToggleLabel(allSheets, hiddenSheets, preview.sheets.length)}
        </button>
      )}
      </div>

      <div className="hl-read-send">
      {preview.observations.length > 0 && (
        <Observations observations={preview.observations} isPdf={isPdf} showAll={allObservations} onToggle={() => setAllObservations((value) => !value)} />
      )}

      {preview.observations.length === 0 ? (
        <output className="fd-msg">Orbis needs readable PDF text or at least three numeric values in an Excel column to ground its advice. You can still review this preview or choose another file.</output>
      ) : (
        <>
          <RequestExtras
            hasStepData={hasStepData}
            savedContextCount={savedContextCount}
            hasSavedPersonalProfile={hasSavedPersonalProfile}
            personaRelevant={personaRelevant}
            steps={{ checked: includeSteps, onChange: toggle(setIncludeSteps) }}
            notes={{ checked: includeSavedContext, onChange: toggle(setIncludeSavedContext) }}
            profile={{ checked: includePersonalProfile, onChange: toggle(setIncludePersonalProfile) }}
            persona={{ checked: includeFitnessPersona, onChange: toggle(setIncludeFitnessPersona) }}
            disabled={isPending}
          />

          <label className="fd-consent hl-consent">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.currentTarget.checked)} disabled={isPending} />
            <span>I understand {disclosure} will be sent to an AI provider that does not train on it (Groq, or Claude by Anthropic) for advice. The original file is not sent, and the advice is saved to my account so I can read it again.</span>
          </label>

          <div className="fd-act">
            <button type="button" onClick={requestAdvice} disabled={!consent || isPending}>
              {isPending ? <><LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> Analysing…</> : <><Sparkles size={14} aria-hidden="true" /> Get advice</>}
            </button>
          </div>
          <p className="fd-note tight">{consent ? '' : 'Tick the box above to enable this. '}Suggestions are informational and aren’t a medical diagnosis.</p>
        </>
      )}

      {message && <output className="fd-msg bad">{message}</output>}
      </div>
      </div>
    </>
  );
}

/** The advice itself: a headline, numbered steps with the observations they rest on, and what was sent. */
export function WorkbookAdviceView({ advice, onDeleted, onPlan, onBack }: Readonly<{ advice: ShownAdvice; onDeleted: () => void; onPlan: () => void; onBack: () => void }>) {
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
      <div className="hl-adv">
      <div className="hl-adv-main">
      <section className="fd-focus fd-advice" aria-live="polite">
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
      {message && <output className="fd-msg bad">{message}</output>}
      </div>

      <div className="hl-adv-side">
      <section className="hl-sec">
        <h2 className="hl-h">What was sent</h2>
        <div className="fd-line"><span>{pdf ? 'PDF preview and text snippets, bounded' : 'Excel summary, bounded'}</span><b className="fd-yes">Included</b></div>
        {sent && [
          row('Step summary', sent.steps),
          row('Saved notes', sent.notes),
          row('Personal profile', sent.profile),
          row('Fitness persona', sent.persona),
        ]}
        <div className="fd-line"><span>The file itself</span><b className="empty">Never sent</b></div>
      </section>
      {!sent && <p className="fd-note tight">Which profile details went with this request isn’t stored with saved advice.</p>}
      </div>
      </div>
    </>
  );
}
