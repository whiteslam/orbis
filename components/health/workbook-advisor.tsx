'use client';

import { useId, useState, useTransition } from 'react';
import { FileSpreadsheet, LoaderCircle, Sparkles, Upload, X } from 'lucide-react';
import { generateWorkbookAdviceAction, parseWorkbookAction } from '@/app/health/actions';
import { workbookHasFitnessFields } from '@/lib/personal/fitness-persona';
import type { WorkbookAdvice, WorkbookPreview } from '@/lib/workbook/types';

export function WorkbookAdvisor({ savedContextCount = 0, hasSavedFitnessPersona = false, hasSavedPersonalProfile = false }: { savedContextCount?: number; hasSavedFitnessPersona?: boolean; hasSavedPersonalProfile?: boolean }) {
  const fileInputId = useId();
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);
  const [advice, setAdvice] = useState<WorkbookAdvice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [includeSavedContext, setIncludeSavedContext] = useState(false);
  const [includeFitnessPersona, setIncludeFitnessPersona] = useState(false);
  const [includePersonalProfile, setIncludePersonalProfile] = useState(false);
  const [isPending, startTransition] = useTransition();

  function parseFile(formData: FormData) {
    setMessage(null);
    setPreview(null);
    setAdvice(null);
    setConsent(false);
    setIncludeSavedContext(false);
    setIncludeFitnessPersona(false);
    setIncludePersonalProfile(false);
    startTransition(async () => {
      const result = await parseWorkbookAction(formData);
      if (!result.success) {
        setMessage(result.message);
        return;
      }
      setPreview(result.data);
    });
  }

  function requestAdvice() {
    if (!preview || !consent) return;
    setMessage(null);
    setAdvice(null);
    startTransition(async () => {
      const result = await generateWorkbookAdviceAction({ preview, includeSavedContext, includeFitnessPersona, includePersonalProfile, consented: consent });
      if (!result.success) {
        setMessage(result.message);
        return;
      }
      setAdvice(result.data);
    });
  }

  function clearWorkbook() {
    setPreview(null);
    setAdvice(null);
    setMessage(null);
    setConsent(false);
    setIncludeSavedContext(false);
    setIncludeFitnessPersona(false);
    setIncludePersonalProfile(false);
  }

  const observations = new Map((preview?.observations ?? []).map((observation) => [observation.id, observation]));
  const isPdf = preview?.fileName.toLowerCase().endsWith('.pdf') ?? false;
  const documentText = preview ? `${preview.fileName} ${preview.observations.map((observation) => `${observation.label} ${observation.value}`).join(' ')}` : '';
  const personaRelevant = Boolean(preview && hasSavedFitnessPersona && workbookHasFitnessFields(preview.sheets, documentText));
  const disclosureItems = [
    isPdf ? 'a bounded PDF preview and up to 24 extracted text snippets' : 'a bounded Excel summary',
    includeSavedContext ? 'up to 5 relevant saved notes (up to 3,000 characters)' : null,
    includePersonalProfile ? 'your personal profile (name, role, and More about me text)' : null,
    includeFitnessPersona ? 'your saved fitness persona' : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <section className="workbook-advisor" aria-labelledby="workbook-title">
      <div className="workbook-heading">
        <div className="workbook-icon"><FileSpreadsheet size={19} /></div>
        <div><h3 id="workbook-title">Ask Orbis about your data</h3><p>Upload a health, finance, or activity Excel or PDF file for a clear preview and data-based suggestions.</p></div>
      </div>

      {!preview ? (
        <div className="workbook-upload-form">
          <label className="workbook-dropzone" htmlFor={fileInputId}>
            <Upload size={19} />
            <strong>Choose an Excel or PDF file</strong>
            <span>.xlsx or .pdf · up to 1.5 MB</span>
          </label>
          <input id={fileInputId} name="workbook" type="file" accept=".xlsx,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf" required disabled={isPending} onChange={(event) => {
            const selected = event.currentTarget.files?.[0];
            if (!selected) return;
            const formData = new FormData();
            formData.set('workbook', selected);
            parseFile(formData);
          }} />
          <p className="workbook-privacy">The workbook is read for this request and isn’t saved to Orbis.</p>
        </div>
      ) : (
        <div className="workbook-preview">
          <div className="workbook-file-row">
            <div><strong>{preview.fileName}</strong><small>{preview.sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0)} data rows · {preview.sheets.length} {preview.sheets.length === 1 ? 'sheet' : 'sheets'}</small></div>
            <button className="workbook-icon-button" type="button" onClick={clearWorkbook} disabled={isPending} aria-label="Remove workbook"><X size={17} /></button>
          </div>

          {preview.sheets.map((sheet, index) => (
            <div className="workbook-sheet" key={`${sheet.name}-${index}`}>
              <div className="workbook-sheet-title"><strong>{sheet.name}</strong><span>{sheet.rowCount} rows · {sheet.columnCount} columns</span></div>
              <p className="workbook-columns"><span>Columns: </span>{sheet.columns.join(' · ')}</p>
              {sheet.previewRows.length > 0 && (
                <div className="workbook-table-wrap">
                  <table className="workbook-table">
                    <thead><tr><th scope="col">Row</th>{sheet.columns.slice(0, 10).map((column, columnIndex) => <th scope="col" key={`${column}-${columnIndex}`}>{column}</th>)}</tr></thead>
                    <tbody>{sheet.previewRows.map((row) => <tr key={row.rowNumber}><th scope="row">{row.rowNumber}</th>{row.values.map((value, valueIndex) => <td key={`${row.rowNumber}-${valueIndex}`}>{value || '—'}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          {preview.observations.length > 0 && (
            <div className="workbook-observations">
              <strong>{isPdf ? 'What Orbis found in the document' : 'What Orbis calculated'}</strong>
              {preview.observations.map((observation) => <p key={observation.id}><span>{observation.sheet} · {observation.column}</span>{observation.value}</p>)}
            </div>
          )}

          {!advice && preview.observations.length === 0 && (
            <p className="workbook-no-observations" role="status">Orbis needs readable PDF text or at least three numeric values in an Excel column to ground its advice. You can still review this preview or choose another file.</p>
          )}

          {!advice && preview.observations.length > 0 && (
            <div className="workbook-consent">
              {savedContextCount > 0 && <label><input type="checkbox" checked={includeSavedContext} onChange={(event) => { setIncludeSavedContext(event.currentTarget.checked); setConsent(false); }} disabled={isPending} /> Include up to {Math.min(savedContextCount, 5)} relevant saved notes from Personal (up to 3,000 characters).</label>}
              {hasSavedPersonalProfile && <label><input type="checkbox" checked={includePersonalProfile} onChange={(event) => { setIncludePersonalProfile(event.currentTarget.checked); setConsent(false); }} disabled={isPending} /> Include my personal profile and “More about me” details for this request.</label>}
              {personaRelevant && <label><input type="checkbox" checked={includeFitnessPersona} onChange={(event) => { setIncludeFitnessPersona(event.currentTarget.checked); setConsent(false); }} disabled={isPending} /> Include my saved fitness persona for this health or fitness workbook.</label>}
              <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.currentTarget.checked)} disabled={isPending} /> I understand {disclosureItems.join(' and ')} will be sent to OpenRouter for advice. The original file is not sent.</label>
              <button className="finance-button primary" type="button" onClick={requestAdvice} disabled={!consent || isPending}>
                {isPending ? <><LoaderCircle className="workbook-spinner" size={15} /> Analyzing…</> : <><Sparkles size={15} /> Get advice</>}
              </button>
            </div>
          )}

          {advice && (
            <div className="workbook-advice" aria-live="polite">
              <div className="workbook-advice-heading"><Sparkles size={17} /><strong>Orbis advice</strong></div>
              <p className="workbook-advice-summary">{advice.summary}</p>
              {advice.advice.map((item, index) => (
                <article className="workbook-advice-item" key={`${item.title}-${index}`}>
                  <strong>{item.title}</strong><p>{item.action}</p>
                  {item.evidenceIds.map((id) => {
                    const observation = observations.get(id);
                    return observation ? <small key={id}>Based on {observation.sheet} · {observation.column}: {observation.value}</small> : null;
                  })}
                </article>
              ))}
              {advice.caveats.map((caveat, index) => <p className="workbook-caveat" key={`${caveat}-${index}`}>{caveat}</p>)}
              <button className="finance-button secondary" type="button" onClick={() => setAdvice(null)}>Ask again</button>
            </div>
          )}
        </div>
      )}

      {message && <p className="finance-notice error workbook-message" role="status">{message}</p>}
      {isPending && !preview && <p className="workbook-progress" role="status"><LoaderCircle className="workbook-spinner" size={15} /> Reading workbook…</p>}
    </section>
  );
}
