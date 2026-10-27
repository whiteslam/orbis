'use server';

// CONTRACT STUB: the signatures below are fixed; the bodies are filled in by
// the server-wiring step. The screens are built against these signatures.

import type {
  ApplicationStatus, CareerInsights, CareerJob, CareerProfile, CareerSettings, CareerSpec, JobState, OfferAdvice, OfferTerms,
} from '@/lib/career/types';
import type {
  ApplicationDetail, CareerHome, CareerSetup, DraftPatch, JobFilters, JobsPage, OwnerMove, ResumeUpload, Result, SendOutcome,
} from '@/lib/career/view';

const NOT_READY = { success: false as const, message: 'This part of Career is still being built.' };

/** Everything the tab and the panel's Overview need in one read. */
export async function loadCareerAction(): Promise<Result<CareerHome>> { return NOT_READY; }

export async function loadSetupAction(): Promise<Result<CareerSetup>> { return NOT_READY; }

export async function listJobsAction(filters: JobFilters): Promise<Result<JobsPage>> { void filters; return NOT_READY; }

export async function jobDetailAction(jobId: string): Promise<Result<ApplicationDetail>> { void jobId; return NOT_READY; }

/** Step 1 of a resume upload: a signed URL the browser uploads the file to (PDF or DOCX, up to 10 MB). */
export async function createResumeUploadAction(file: { name: string; type: string; size: number }): Promise<Result<ResumeUpload>> { void file; return NOT_READY; }

/** Step 2: read the uploaded file, parse it with AI and merge it into the profile. */
export async function processResumeAction(path: string, fileName: string): Promise<Result<CareerProfile>> { void path; void fileName; return NOT_READY; }

export async function saveProfileAction(profile: CareerProfile): Promise<Result<CareerProfile>> { void profile; return NOT_READY; }

export async function saveSpecAction(spec: CareerSpec): Promise<Result<CareerSpec>> { void spec; return NOT_READY; }

/** "Remote senior React roles above 30 LPA, no crypto" → a spec to review (not saved). */
export async function specFromSentenceAction(sentence: string): Promise<Result<CareerSpec>> { void sentence; return NOT_READY; }

export async function saveSettingsAction(patch: Partial<CareerSettings>): Promise<Result<CareerSettings>> { void patch; return NOT_READY; }

/** A job URL (Greenhouse/Lever/Ashby/Recruitee are read from their API) and/or its pasted description. */
export async function pasteJobAction(input: { url?: string; text?: string; title?: string; company?: string }): Promise<Result<{ jobId: string }>> { void input; return NOT_READY; }

export async function setJobStateAction(jobId: string, state: JobState, reason?: string): Promise<Result<CareerJob>> { void jobId; void state; void reason; return NOT_READY; }

/** Re-extract and rescore, optionally with a pasted full description for a thin job. */
export async function rescoreJobAction(jobId: string, description?: string): Promise<Result<CareerJob>> { void jobId; void description; return NOT_READY; }

/** Tailor the resume, cover note and answers for a job, and render the files. */
export async function draftApplicationAction(jobId: string): Promise<Result<ApplicationDetail>> { void jobId; return NOT_READY; }

export async function updateDraftAction(applicationId: string, patch: DraftPatch): Promise<Result<ApplicationDetail>> { void applicationId; void patch; return NOT_READY; }

/** The owner's Send. Never called by anything but a press of Send. */
export async function sendApplicationAction(applicationId: string): Promise<Result<SendOutcome>> { void applicationId; return NOT_READY; }

/** After a link apply or a compose window: the owner confirms it went out. */
export async function markAppliedAction(applicationId: string): Promise<Result<ApplicationDetail>> { void applicationId; return NOT_READY; }

export async function ownerMovesAction(applicationId: string): Promise<Result<OwnerMove[]>> { void applicationId; return NOT_READY; }

export async function moveApplicationAction(applicationId: string, to: ApplicationStatus): Promise<Result<ApplicationDetail>> { void applicationId; void to; return NOT_READY; }

export async function attachReplyAction(eventId: string, applicationId: string): Promise<Result<ApplicationDetail>> { void eventId; void applicationId; return NOT_READY; }

export async function sendFollowUpAction(applicationId: string, text: string): Promise<Result<ApplicationDetail>> { void applicationId; void text; return NOT_READY; }

export async function saveOfferTermsAction(applicationId: string, terms: OfferTerms): Promise<Result<ApplicationDetail>> { void applicationId; void terms; return NOT_READY; }

export async function adviseOfferAction(offerId: string): Promise<Result<OfferAdvice>> { void offerId; return NOT_READY; }

export async function sendOfferReplyAction(offerId: string, text: string): Promise<Result<ApplicationDetail>> { void offerId; void text; return NOT_READY; }

/** Run this owner's search now instead of waiting for the next scheduled run. */
export async function runSearchNowAction(): Promise<Result<{ found: number; scored: number; drafted: number }>> { return NOT_READY; }

export async function insightsAction(): Promise<Result<CareerInsights>> { return NOT_READY; }

/** The tracker as CSV text. */
export async function exportTrackerAction(): Promise<Result<string>> { return NOT_READY; }
